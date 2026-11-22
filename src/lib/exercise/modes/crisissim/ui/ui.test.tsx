// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SafeMarkdown } from "./markdown";
import { PlayerView } from "./player";
import { ControlView } from "./control";
import { DebriefView } from "./debrief";
import type { CsState } from "./types";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("SafeMarkdown", () => {
  it("renders raw HTML as text and never loads images or links", () => {
    const { container } = render(
      <SafeMarkdown text={'<script>alert(1)</script> **bold** ![x](https://evil.example/p.png) [site](https://evil.example)\n\n<img src=x onerror=alert(1)>'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.textContent).toContain("[x]");
    expect(container.textContent).not.toContain("evil.example/p.png");
  });

  it("renders lists", () => {
    const { container } = render(<SafeMarkdown text={"- one\n- two"} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});

const now = new Date("2026-03-07T03:00:00Z").toISOString();

function state(over: Partial<CsState> = {}): CsState {
  return {
    exercise: { id: "ex", title: "Drill", status: "live", scenarioStartAt: "2026-03-07T02:00:00Z", startedAt: now, isPractice: false },
    now,
    teams: [{ id: "t1", name: "Legal" }],
    me: { participantId: "p1", displayName: "Ana", teamId: "t1", roles: ["player"], isGuest: false },
    viewer: { isControl: false, isDriver: false },
    roster: [{ id: "p1", displayName: "Ana", title: null, teamId: "t1", roles: ["player"], online: true }],
    path: { key: "degrading", label: "Under strain" },
    config: { holdAfterClose: false, revealSplit: true, revealBest: false, targetDurationMin: 30 },
    clocks: [],
    injects: [
      {
        id: "i1",
        seq: 1,
        status: "open",
        title: "Discovery",
        scenarioTime: "2026-03-07T02:10:00Z",
        targetTeamIds: [],
        openedAt: now,
        closesAt: new Date(Date.parse(now) + 5 * 60_000).toISOString(),
        closedAt: null,
        playedOnPath: "degrading",
        narrativeMd: "Files are **encrypted**.",
        consequenceText: null,
        outcomes: [],
        artifacts: [{ id: "p1", kind: "ransom_note", title: "Ransom note", content: "Pay now." }],
        question: {
          team: "Legal",
          teamId: "t1",
          stem: "Do we notify now?",
          options: [
            { id: "a", text: "Notify" },
            { id: "b", text: "Wait" },
          ],
          decisionOwner: "General counsel",
          discussionPrompt: "What would you need to know?",
          type: "standard",
        },
        deliverable: null,
        myDeliverable: null,
        myVote: null,
        progress: { voted: 0, required: 1 },
      },
    ],
    current: "i1",
    debrief: null,
    ...over,
  };
}

const props = (s: CsState, respond = vi.fn(async () => ({ ok: true })), act = vi.fn(async () => ({ ok: true }))) => ({
  exerciseId: "ex",
  state: s,
  isGuest: false,
  respond,
  act,
  refresh: vi.fn(),
});

describe("PlayerView", () => {
  it("shows the question with the decision owner line and submits a vote with a comment", async () => {
    const respond = vi.fn(async () => ({ ok: true }));
    render(<PlayerView {...props(state(), respond)} />);
    expect(screen.getByText("General counsel decides. Your team recommends.")).toBeTruthy();
    expect(screen.getByText("Not scored.")).toBeTruthy();
    // The shell owns the header: no path label or countdown here.
    expect(screen.queryByText("Under strain")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Notify/ }));
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Clock risk" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit vote" }));
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith("i1", "vote", { optionId: "a", comment: "Clock risk" }));
  });

  it("tells the decision maker they decide", () => {
    const s = state();
    s.injects[0] = { ...s.injects[0], question: { ...s.injects[0].question!, iDecide: true } };
    render(<PlayerView {...props(s)} />);
    expect(screen.getByText("You decide for Legal. Your team recommends.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit decision" })).toBeTruthy();
  });

  it("labels follow-ups and withholds updates for other teams", () => {
    const s = state();
    s.injects[0] = { ...s.injects[0], outcomes: [{ team: "Legal", text: "Counsel was engaged." }] };
    const { unmount } = render(<PlayerView {...props(s)} />);
    expect(screen.getByText("Since your last decision")).toBeTruthy();
    unmount();
    const other = state();
    other.injects[0] = { ...other.injects[0], forMyTeam: false, narrativeMd: "", question: null };
    render(<PlayerView {...props(other)} />);
    expect(screen.getByText("This update is for other teams.")).toBeTruthy();
  });

  it("shows the team split and decision after close, without the intended option", () => {
    const s = state();
    s.injects[0] = {
      ...s.injects[0],
      status: "closed",
      myVote: { optionId: "b", comment: null },
      reveal: { distribution: { Legal: { a: 2, b: 1 } }, decisions: { Legal: { optionId: "a", source: "owner" } } },
    };
    render(<PlayerView {...props(s)} />);
    expect(screen.getByText("Waiting for the next update.")).toBeTruthy();
    expect(screen.getByText("Your vote")).toBeTruthy();
    expect(screen.getByText("Decision owner: A. Notify")).toBeTruthy();
    expect(screen.queryByText("Intended best")).toBeNull();
  });

  it("shows a tie as no decision and the intended option when revealed", () => {
    const s = state();
    s.injects[0] = {
      ...s.injects[0],
      status: "closed",
      myVote: null,
      reveal: { distribution: { Legal: { a: 1, b: 1 } }, decisions: { Legal: { optionId: null, source: "tie" } }, best: { Legal: "a" } },
    };
    render(<PlayerView {...props(s)} />);
    expect(screen.getByText("No decision. The recommendations were tied.")).toBeTruthy();
    expect(screen.getByText("Intended best")).toBeTruthy();
    expect(screen.getByText("No vote.")).toBeTruthy();
  });
});

describe("ControlView", () => {
  function controlState() {
    const s = state({
      viewer: { isControl: true, isDriver: true },
      score: { cumulative: 1.5, teamScores: {}, thresholds: { optimal: 4, degrading: -3 } },
    });
    s.injects[0] = {
      ...s.injects[0],
      question: null,
      questions: [s.injects[0].question!],
      control: {
        quality: { Legal: { a: { optimal: "great", degrading: "good", critical: "neutral" }, b: { optimal: "bad", degrading: "bad", critical: "bad" } } },
        clockEffects: {},
        rationales: { Legal: { a: "Notice is due." } },
        deliverableCriteria: [],
        required: ["p1"],
        votes: [{ participantId: "p1", teamId: "t1", optionId: "a", comment: null, abstain: false, quality: null }],
        decisions: { Legal: { optionId: "a", source: "majority" } },
        waitingOn: [],
        deliverables: [],
        summary: null,
      },
    };
    return s;
  }

  it("leaves Close and extend to the shell, uses no-fault labels, and hides names until asked", async () => {
    render(<ControlView {...props(controlState())} />);
    expect(screen.queryByRole("button", { name: /Close now/ })).toBeNull();
    expect(screen.getAllByText("Intended").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Off plan").length).toBeGreaterThan(0);
    expect(screen.queryByText("Great")).toBeNull();
    expect(screen.getByText("Notice is due.")).toBeTruthy();
    expect(screen.getByText(/Team majority: A\. Notify/)).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Person" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Show names" }));
    await vi.waitFor(() => expect(screen.getByRole("columnheader", { name: "Person" })).toBeTruthy());
  });

  it("changes reveal settings through act()", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    render(<ControlView {...props(controlState(), undefined, act)} />);
    fireEvent.click(screen.getByRole("switch", { name: /Show the intended option/ }));
    await vi.waitFor(() => expect(act).toHaveBeenCalledWith("config", { config: { revealBest: true } }));
  });
});

describe("DebriefView", () => {
  it("draws the path arc and lists key decisions, clocks and moves", () => {
    const decision = {
      injectId: "i1",
      seq: 1,
      title: "Discovery",
      scenarioTime: "2026-03-07T02:10:00Z",
      team: "Legal",
      questionType: "materiality",
      stem: "Do we notify now?",
      decisionOwner: "General counsel",
      source: "owner" as const,
      decision: { optionId: "b", text: "Wait", rationale: "Waiting misses the deadline." },
      split: [
        { optionId: "a", text: "Notify", votes: 2 },
        { optionId: "b", text: "Wait", votes: 1 },
      ],
      noVotes: 1,
      best: { optionId: "a", text: "Notify", rationale: "Notice is due." },
      clockChanges: [],
    };
    const s = state({
      exercise: { ...state().exercise, status: "ended" },
      debrief: {
        initialPath: "optimal",
        finalPath: "degrading",
        arc: [{ injectId: "i1", seq: 1, title: "Discovery", pathAtClose: "optimal", newPath: "degrading" }],
        keyDecisions: [decision],
        moves: [{ injectId: "i1", seq: 1, title: "Discovery", from: "optimal", to: "degrading", decisions: [decision] }],
        clocks: [
          { key: "sec_8k", label: "SEC 8-K", status: "running", outcome: "open", triggeredAt: "2026-03-07T02:10:00Z", deadlineAt: "2026-03-12T02:10:00Z", metAt: null },
        ],
        deliverables: [],
        noVoteCount: 1,
        voteCount: 2,
      },
    });
    const { container } = render(<DebriefView {...props(s)} />);
    expect(container.querySelector("svg polyline")).not.toBeNull();
    expect(screen.getByText("2 votes, 1 no vote.")).toBeTruthy();
    expect(screen.getByText("Key decisions")).toBeTruthy();
    expect(screen.getAllByText("Notice is due.").length).toBeGreaterThan(0);
    expect(screen.getByText("Open at ENDEX")).toBeTruthy();
    expect(screen.getByText(/Due T\+5d 10m, Thu 02:10 UTC/)).toBeTruthy();
  });
});
