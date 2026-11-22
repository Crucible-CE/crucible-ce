// Cloud notes: one quiet line, only for contributors and administrators in
// the platform shell, dismissible, never in player, guest, presenter or
// projector views, exports or emails.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CloudSeam } from "./cloud-seam";
import { CloudNotesProvider } from "./cloud-notes-provider";
import { CloudCallToAction } from "./cloud-cta";
import { CLOUD_NOTE_KEYS, CLOUD_NOTES, CLOUD_NOTES_OFF, cloudNoteLink, cloudTrialUrl, isRoadmapNote, roleSeesCloudNotes } from "@/lib/cloud/notes";

const SRC = path.resolve(__dirname, "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CloudSeam", () => {
  it("renders nothing without the platform provider (play, join, present pages)", () => {
    const { container } = render(<CloudSeam feature="ai-grading" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the organization turned notes off or the viewer is not staff", () => {
    const { container } = render(
      <CloudNotesProvider state={CLOUD_NOTES_OFF}>
        <CloudSeam feature="ai-grading" />
      </CloudNotesProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one plain sentence and a link to the matching Cloud card", () => {
    render(
      <CloudNotesProvider state={{ enabled: true, dismissed: [], trial: false }}>
        <CloudSeam feature="aar-drafting" />
      </CloudNotesProvider>,
    );
    const note = screen.getByTestId("cloud-note");
    expect(note).toHaveTextContent(CLOUD_NOTES["aar-drafting"].text);
    const link = screen.getByRole("link", { name: "Coming soon in Cloud" });
    expect(link).toHaveAttribute("href", "/cloud#ai-aar-draft");
    // A note is never a control: one link and one dismiss button, nothing disabled.
    expect(note.querySelectorAll("button")).toHaveLength(1);
    expect(note.querySelector("[disabled]")).toBeNull();
  });

  it("reads Try free for 1 week when a trial link is set", () => {
    render(
      <CloudNotesProvider state={{ enabled: true, dismissed: [], trial: true }}>
        <CloudSeam feature="crisissim-generate" />
      </CloudNotesProvider>,
    );
    expect(screen.getByRole("link", { name: "Try free for 1 week" })).toHaveAttribute("href", "/cloud#ai-crisis-sim");
  });

  it("reads Coming soon in Cloud on a roadmap note, even with a trial link", () => {
    render(
      <CloudNotesProvider state={{ enabled: true, dismissed: [], trial: true }}>
        <CloudSeam feature="transcript-matching" />
      </CloudNotesProvider>,
    );
    expect(screen.getByRole("link", { name: "Coming soon in Cloud" })).toHaveAttribute("href", "/cloud#ai-transcript");
  });

  it("stays hidden once dismissed, and saves the dismissal on the server", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <CloudNotesProvider state={{ enabled: true, dismissed: ["ai-grading"], trial: false }}>
        <CloudSeam feature="ai-grading" />
        <CloudSeam feature="sop-analysis" />
      </CloudNotesProvider>,
    );
    expect(screen.getAllByTestId("cloud-note")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss this note" }));
    expect(screen.queryByTestId("cloud-note")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/cloud-notes", expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "sop-analysis" }) }));
    rerender(
      <CloudNotesProvider state={{ enabled: true, dismissed: ["ai-grading"], trial: false }}>
        <CloudSeam feature="sop-analysis" />
      </CloudNotesProvider>,
    );
    expect(screen.queryByTestId("cloud-note")).toBeNull();
  });
});

describe("Cloud note rules", () => {
  it("has the fifteen notes, each one sentence with no dashes, linking to a card on the Cloud page", () => {
    expect(CLOUD_NOTE_KEYS).toHaveLength(15);
    const cloudPage = readFileSync(path.join(SRC, "app", "(platform)", "cloud", "page.tsx"), "utf8");
    for (const k of CLOUD_NOTE_KEYS) {
      const t = CLOUD_NOTES[k].text;
      expect(t).toMatch(/^Cloud [^.]+\.$/);
      expect(t).not.toMatch(/[\u2013\u2014]/);
      expect(cloudNoteLink(k, false).href).toMatch(/^\/cloud#[a-z-]+$/);
      expect(cloudPage).toContain(`id: "${CLOUD_NOTES[k].anchor}"`);
    }
  });

  it("marks the steps Cloud does not have yet as roadmap", () => {
    expect(CLOUD_NOTE_KEYS.filter(isRoadmapNote).sort()).toEqual(["ai-grading-deliverables", "strategic-injects", "transcript-matching"]);
    expect(cloudNoteLink("strategic-injects", true).label).toBe("Coming soon in Cloud");
    expect(cloudNoteLink("ai-grading", true).label).toBe("Try free for 1 week");
  });

  it("is for administrators and contributors only", () => {
    expect(roleSeesCloudNotes("administrator")).toBe(true);
    expect(roleSeesCloudNotes("contributor")).toBe(true);
    expect(roleSeesCloudNotes("reader")).toBe(false);
    expect(roleSeesCloudNotes(undefined)).toBe(false);
  });

  it("is placed at every note key in the app", () => {
    const placed = new Set<string>();
    for (const f of walk(SRC)) for (const m of readFileSync(f, "utf8").matchAll(/<CloudSeam feature="([a-z-]+)"/g)) placed.add(m[1]);
    expect([...placed].sort()).toEqual([...CLOUD_NOTE_KEYS].sort());
  });

  it("never appears in player, guest, presenter or projector views, exports or emails", () => {
    const forbidden = [
      ...walk(path.join(SRC, "app", "play")),
      ...walk(path.join(SRC, "app", "join")),
      ...walk(path.join(SRC, "app", "present")),
      ...walk(path.join(SRC, "lib", "exercise", "exports")),
      ...walk(path.join(SRC, "lib", "email")),
      path.join(SRC, "components", "exercise", "play-view.tsx"),
      path.join(SRC, "components", "documents", "presenter.tsx"),
      path.join(SRC, "components", "hotwash", "hotwash-board.tsx"),
      path.join(SRC, "components", "hotwash", "feedback-form.tsx"),
      path.join(SRC, "lib", "exercise", "aar", "pdf.tsx"),
      path.join(SRC, "lib", "exercise", "aar", "docx.ts"),
      path.join(SRC, "lib", "exercise", "aar", "bundle.ts"),
      path.join(SRC, "lib", "exercise", "program", "pdf.tsx"),
      path.join(SRC, "lib", "exercise", "improvement", "reminders.ts"),
      path.join(SRC, "lib", "exercise", "email.ts"),
      ...["crisissim", "document", "strategic"].map((m) => path.join(SRC, "lib", "exercise", "modes", m, "ui", "player.tsx")),
    ];
    const hits = forbidden.filter((f) => /cloud-seam|CloudSeam|cloud\/notes/.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
    expect(hits).toEqual([]);
  });

  it("is provided only by the platform layout", () => {
    const providers = walk(SRC)
      .filter((f) => /<CloudNotesProvider\b/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(providers).toEqual(["app/(platform)/layout.tsx"]);
  });
});

describe("CLOUD_TRIAL_URL", () => {
  it("is used only when it is an http(s) link", () => {
    expect(cloudTrialUrl({})).toBeNull();
    expect(cloudTrialUrl({ CLOUD_TRIAL_URL: "  " })).toBeNull();
    expect(cloudTrialUrl({ CLOUD_TRIAL_URL: "javascript:alert(1)" })).toBeNull();
    expect(cloudTrialUrl({ CLOUD_TRIAL_URL: "not a url" })).toBeNull();
    expect(cloudTrialUrl({ CLOUD_TRIAL_URL: "https://cloud.example.test/trial" })).toBe("https://cloud.example.test/trial");
  });

  it("shows Coming soon without a link, and the trial button with one", () => {
    const { rerender } = render(<CloudCallToAction trialUrl={null} />);
    expect(screen.getByTestId("cloud-coming-soon")).toHaveTextContent("Free 1 week trial coming soon");
    expect(screen.getByText("Crucible Cloud is not open yet. The trial starts when it launches.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<CloudCallToAction trialUrl="https://cloud.example.test/trial" />);
    const a = screen.getByRole("link", { name: /Try Crucible Cloud free for 1 week/ });
    expect(a).toHaveAttribute("href", "https://cloud.example.test/trial");
    expect(screen.queryByTestId("cloud-coming-soon")).toBeNull();
  });
});
