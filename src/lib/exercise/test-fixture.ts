// A tiny Crisis Sim template written straight to the database, for
// integration tests and the Playwright seed. Two teams, two injects, a
// question per team with hidden quality, one regulatory clock effect.
//
// Takes the Prisma client as a parameter so e2e helpers can pass their own.

import type { PrismaClient } from "@prisma/client";

export const FIXTURE_TEAMS = ["Executive", "Technical"] as const;

function variants(text: string) {
  return {
    optimal: { narrativeMd: `${text} The team has early warning and a working plan.`, artifacts: [] },
    degrading: { narrativeMd: `${text} The first steps were slow and pressure is building.`, artifacts: [] },
    critical: { narrativeMd: `${text} The incident is spreading and the press has the story.`, artifacts: [] },
  };
}

const allPaths = (q: "great" | "good" | "neutral" | "bad") => ({ optimal: q, degrading: q, critical: q });

function question(team: string, stem: string) {
  return {
    team,
    stem,
    decisionOwner: team === "Executive" ? "Chief executive" : "IT lead",
    options: [
      { id: "a", text: "Isolate the affected systems now." },
      { id: "b", text: "Gather more information first." },
      { id: "c", text: "Wait and watch." },
    ],
  };
}

const quality = {
  Executive: { a: allPaths("great"), b: allPaths("neutral"), c: allPaths("bad") },
  Technical: { a: allPaths("great"), b: allPaths("good"), c: allPaths("bad") },
};

export async function createCrisisTemplateFixture(
  client: PrismaClient,
  opts: { title?: string; status?: string; createdById?: string | null; plannedDelayMin?: number | null } = {},
): Promise<string> {
  const t = await client.exerciseTemplate.create({
    data: {
      mode: "crisissim",
      title: opts.title ?? "Fixture ransomware drill",
      summary: "Two injects for tests.",
      status: opts.status ?? "published",
      createdById: opts.createdById ?? null,
      config: {
        schemaVersion: 1,
        teams: [...FIXTURE_TEAMS],
        targetDurationMin: 30,
        // Friday 17:30: new exercises get a scenario start, so the clock does not block STARTEX.
        scenarioAnchor: { weekday: 5, time: "17:30" },
        executiveBriefMd: "A ransomware crew hit the file servers. You lead the response.",
        regulatoryClocks: [{ key: "sec_8k", label: "SEC Form 8-K Item 1.05", businessDays: 4 }],
      },
      objectives: [
        { key: "contain", text: "Decide on containment within the first hour.", capabilityKeys: ["RS.MA"] },
        { key: "notify", text: "Make notification decisions on time.", capabilityKeys: ["RS.CO"] },
      ],
    },
    select: { id: true },
  });
  const injects = [
    { title: "Ransomware on file servers", offset: 0, objectiveKeys: ["contain"], stem: "What is your first move on the encrypted servers?" },
    { title: "Reporter calls", offset: 360, objectiveKeys: ["notify"], stem: "A reporter asks for comment. What do you say?" },
  ];
  for (const [i, inj] of injects.entries()) {
    await client.templateInject.create({
      data: {
        templateId: t.id,
        nodeId: `n${i + 1}`,
        seq: i + 1,
        title: inj.title,
        scenarioOffsetMin: inj.offset,
        plannedDelayMin: opts.plannedDelayMin === undefined ? 5 : opts.plannedDelayMin,
        targetTeams: [],
        objectiveKeys: inj.objectiveKeys,
        expectedActions: ["Isolate affected hosts", "Brief the executive team"],
        content: {
          schemaVersion: 1,
          variants: variants(`${inj.title}.`),
          questions: FIXTURE_TEAMS.map((team) => question(team, inj.stem)),
        },
        secret: {
          schemaVersion: 1,
          quality,
          followUps: {},
          clockEffects: i === 0 ? { Executive: { a: [{ key: "sec_8k", action: "trigger" }] } } : {},
        },
      },
    });
  }
  return t.id;
}
