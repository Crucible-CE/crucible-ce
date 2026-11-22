// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ATTACK_TECHNIQUES,
  getTechnique,
  getTechniqueFullName,
  isValidTechniqueId,
  normalizeTechniqueId,
} from "./mitre";
import { THREAT_ACTORS, actorStatusLabel, getThreatActor, findThreatActor, isCurrentActor, listThreatActors, threatActorSchema } from "./threat-actors";
import { initialAccessOf, resolveScenarioReference, techniqueRefs, topTechniques } from "./scenario-reference";
import { cleanTechniqueIds, searchTechniques } from "./mitre";
import { REPLAYS, getReplay, listReplays, replaySchema } from "./replays";
import { INDUSTRY_TEMPLATES, industryTemplateSchema } from "./industries";
import { COMMON_SCENARIOS, FOG_EVENTS, SCENARIO_SEEDS, commonScenarioSchema, fogEventSchema, scenarioSeedSchema } from "./fog";
import { SCENARIO_DOMAIN_KEYS, SCENARIO_DOMAINS, showsCyberScaffolding } from "./domains";
import { CAPABILITY_FRAMEWORKS, capabilitySchema, listCapabilities } from "./capabilities";
import { CONTROLS, FRAMEWORKS, controlSchema, defaultCadence, getControl, listControls } from "./frameworks";
import { REGULATORY_CLOCK_PRESETS, computeClockDeadline, regulatoryClockPresetSchema } from "./regulatory-clocks";
import { PRESSURE_ARTIFACTS, listPlaceholders, pressureArtifactTemplateSchema, renderPressureArtifact } from "./pressure-artifacts";

function dupes(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => (seen.has(v) ? true : (seen.add(v), false)));
}

describe("mitre catalog", () => {
  it("has unique ids and parents for every sub-technique", () => {
    expect(ATTACK_TECHNIQUES.length).toBeGreaterThan(600);
    expect(dupes(ATTACK_TECHNIQUES.map((t) => t.id))).toEqual([]);
    for (const t of ATTACK_TECHNIQUES) {
      if (t.isSubtechnique) expect(getTechnique(t.parentId!)).toBeDefined();
    }
  });

  it("normalizes ids", () => {
    expect(normalizeTechniqueId(" t1059.001 ")).toBe("T1059.001");
    expect(normalizeTechniqueId("T1059/001")).toBe("T1059.001");
    expect(normalizeTechniqueId("1059")).toBeNull();
    expect(isValidTechniqueId("t1566.004")).toBe(true);
    expect(isValidTechniqueId("T9999")).toBe(false);
    expect(getTechniqueFullName("T1059.001")).toBe("Command and Scripting Interpreter: PowerShell");
  });
});

describe("threat actors", () => {
  it("validate against the schema with unique keys", () => {
    for (const a of THREAT_ACTORS) threatActorSchema.parse(a);
    expect(dupes(THREAT_ACTORS.map((a) => a.key))).toEqual([]);
  });

  it("use only valid ATT&CK technique ids, at least 5 each", () => {
    for (const a of THREAT_ACTORS) {
      expect(a.techniques.length, a.key).toBeGreaterThanOrEqual(5);
      const invalid = a.techniques.filter((id) => !isValidTechniqueId(id));
      expect(invalid, a.key).toEqual([]);
      expect(dupes(a.techniques), a.key).toEqual([]);
    }
  });

  it("includes the extended actor set and resolves legacy keys", () => {
    for (const key of ["salt-typhoon", "kimsuky", "muddywater", "insider-threat", "ransomware-cartel", "lapsus", "apt1"]) {
      expect(getThreatActor(key), key).toBeDefined();
    }
    for (const key of ["akira", "qilin", "shinyhunters", "storm-0501"]) {
      const a = getThreatActor(key);
      expect(a, key).toBeDefined();
      expect(a!.techniques.filter((id) => !isValidTechniqueId(id)), key).toEqual([]);
    }
    const spider = getThreatActor("scattered-spider")!;
    for (const t of ["T1656", "T1484.002", "T1098.005", "T1219"]) expect(spider.techniques, t).toContain(t);
    for (const key of ["lockbit", "ransomhub", "ransomware-cartel", "akira", "qilin"]) {
      expect(getThreatActor(key)!.techniques, key).toEqual(expect.arrayContaining(["T1219", "T1003.003"]));
    }
    expect(getThreatActor("oilrig")?.key).toBe("apt34");
    expect(getThreatActor("carbanak")?.key).toBe("fin7");
    expect(findThreatActor("Anunak")?.key).toBe("fin7");
    expect(getThreatActor("unc2452")?.key).toBe("apt29");
    expect(findThreatActor("Cozy Bear")?.key).toBe("apt29");
  });
});

describe("threat actor status", () => {
  const status = (k: string) => getThreatActor(k)!.status;

  it("follows the October 2026 threat brief", () => {
    for (const k of ["conti", "darkside", "revil", "hive", "blackcat", "ransomhub"]) expect(status(k), k).toBe("defunct");
    for (const k of ["black-basta", "wizard-spider", "lockbit", "scattered-spider"]) expect(status(k), k).toBe("disrupted");
    for (const k of ["akira", "clop", "fin7", "shinyhunters", "qilin", "storm-0501", "handala"]) expect(status(k), k).toBe("active");
    expect(status("lapsus")).toBe("rebranded");
    expect(getThreatActor("lockbit")!.statusNote).toMatch(/LockBit 5[.]0/);
    expect(getThreatActor("shinyhunters")!.statusNote).toMatch(/2026/);
    expect(getThreatActor("conti")!.summary).toMatch(/Wizard Spider/);
  });

  it("gives every actor a status date and a note when it is not active", () => {
    for (const a of THREAT_ACTORS) {
      expect(a.statusAsOf, a.key).toMatch(/^[0-9]{4}-[0-9]{2}/);
      if (a.status !== "active") expect(a.statusNote, a.key).toBeTruthy();
    }
    expect(actorStatusLabel(getThreatActor("hive")!)).toBe("Defunct as of 2023-01-26");
    expect(actorStatusLabel(getThreatActor("akira")!)).toBe("Active");
  });

  it("hides defunct and rebranded actors from pickers unless asked or picked", () => {
    const keys = listThreatActors().map((a) => a.key);
    expect(keys).toContain("lockbit");
    expect(keys).toContain("handala");
    expect(keys).not.toContain("hive");
    expect(keys).not.toContain("lapsus");
    expect(listThreatActors({ keepKey: "hive" }).map((a) => a.key)).toContain("hive");
    expect(listThreatActors({ includeDefunct: true }).length).toBe(THREAT_ACTORS.length);
    expect(THREAT_ACTORS.filter(isCurrentActor).length).toBe(keys.length);
  });

  it("merges Carbanak into FIN7 and adds Handala with catalog techniques", () => {
    expect(THREAT_ACTORS.some((a) => a.key === "carbanak")).toBe(false);
    const h = getThreatActor("handala")!;
    expect(h.techniques).toContain("T1072");
    expect(h.techniques.every(isValidTechniqueId)).toBe(true);
    expect(h.notableIncidents.join(" ")).toMatch(/Stryker/);
  });
});

describe("scenario reference", () => {
  it("resolves keys and shapes techniques from the catalog", () => {
    const ref = resolveScenarioReference({ threatActorKey: "qilin", replayKey: "synnovis-2024", industryKey: "healthcare-provider" });
    expect(ref.actor?.name).toBe("Qilin");
    expect(ref.replay?.actorKey).toBe("qilin");
    expect(ref.industry?.orgName).toBe("North Valley Care Network");
    expect(topTechniques(ref.actor!, 10)).toHaveLength(10);
    expect(initialAccessOf(ref.actor!).map((t) => t.id)).toEqual(expect.arrayContaining(["T1133", "T1078"]));
    expect(resolveScenarioReference({ threatActorKey: "nope" }).actor).toBeNull();
    expect(techniqueRefs(["T1486", "bad", "t1486"])).toEqual([{ id: "T1486", name: "Data Encrypted for Impact" }]);
  });

  it("cleans and searches ATT&CK tags with the catalog", () => {
    expect(cleanTechniqueIds(["t1059/001", "T9999", 5, "T1059.001"])).toEqual(["T1059.001"]);
    expect(cleanTechniqueIds("T1486")).toEqual([]);
    expect(cleanTechniqueIds(Array.from({ length: 20 }, (_, i) => `T10${String(i + 10)}`).concat(["T1486"])).length).toBeLessThanOrEqual(10);
    expect(searchTechniques("T1486")[0].id).toBe("T1486");
    expect(searchTechniques("powershell").map((t) => t.id)).toContain("T1059.001");
    expect(searchTechniques("  ")).toEqual([]);
  });
});

describe("replays", () => {
  it("each has asOf, at least one source, and valid techniques", () => {
    expect(REPLAYS.length).toBe(9);
    for (const r of REPLAYS) {
      replaySchema.parse(r);
      expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.sources.length, r.key).toBeGreaterThanOrEqual(1);
      expect(r.techniques.filter((id) => !isValidTechniqueId(id)), r.key).toEqual([]);
      if (r.actorKey) expect(getThreatActor(r.actorKey), r.key).toBeDefined();
    }
    expect(dupes(REPLAYS.map((r) => r.key))).toEqual([]);
  });

  it("has no provisional replay and keeps listReplays filtering provisional ones", () => {
    expect(REPLAYS.filter((r) => r.provisional)).toEqual([]);
    expect(listReplays().length).toBe(REPLAYS.length);
    expect(listReplays({ includeProvisional: true }).length).toBe(REPLAYS.length);
  });

  it("states the confirmed Stryker facts and marks uncertain numbers unknown", () => {
    const r = getReplay("stryker-2026")!;
    expect(r.provisional).toBe(false);
    expect(r.actorKey).toBe("handala");
    expect(r.summary).toMatch(/Intune/);
    expect(r.summary).toMatch(/no ransomware/);
    expect(r.techniques).not.toContain("T1486");
    expect(r.timeline.at(-1)?.date).toBe("2026-04-09");
    expect(r.impact).toMatch(/unknown/);
    expect(r.sources.some((s) => s.url.includes("sec.gov"))).toBe(true);
    for (const s of r.sources) expect(s.date, s.url).toBeTruthy();
  });

  it("adds Synnovis and Storm-0501 with sources", () => {
    expect(getReplay("synnovis-2024")!.actorKey).toBe("qilin");
    expect(getReplay("storm-0501-2025")!.actorKey).toBe("storm-0501");
    expect(getReplay("storm-0501-2025")!.sources[0].url).toMatch(/microsoft[.]com/);
  });

  it("has the Snowflake 2024 replay with public sources", () => {
    const r = getReplay("snowflake-2024")!;
    expect(r.provisional).toBe(false);
    expect(r.asOf).toBe("2026-10-01");
    expect(r.sources.map((x) => x.url).join(" ")).toMatch(/cloud\.google\.com/);
    expect(r.sources.map((x) => x.url).join(" ")).toMatch(/snowflake\.com/);
  });
});

describe("industries", () => {
  it("has 12 templates with no duplicate keys or org names", () => {
    expect(INDUSTRY_TEMPLATES.length).toBe(12);
    for (const t of INDUSTRY_TEMPLATES) industryTemplateSchema.parse(t);
    expect(dupes(INDUSTRY_TEMPLATES.map((t) => t.key))).toEqual([]);
    expect(dupes(INDUSTRY_TEMPLATES.map((t) => t.orgName))).toEqual([]);
  });

  it("suggests only known actors", () => {
    for (const t of INDUSTRY_TEMPLATES) {
      for (const k of t.suggestedActorKeys ?? []) expect(getThreatActor(k), `${t.key}:${k}`).toBeDefined();
    }
  });
});

describe("fog, seeds, common scenarios", () => {
  it("validate and reference known actors and techniques", () => {
    for (const f of FOG_EVENTS) fogEventSchema.parse(f);
    for (const s of SCENARIO_SEEDS) scenarioSeedSchema.parse(s);
    expect(SCENARIO_SEEDS.length).toBe(20);
    for (const c of COMMON_SCENARIOS) {
      commonScenarioSchema.parse(c);
      for (const k of c.actorKeys) expect(getThreatActor(k), `${c.key}:${k}`).toBeDefined();
      expect(c.techniques.filter((id) => !isValidTechniqueId(id)), c.key).toEqual([]);
    }
    expect(dupes(FOG_EVENTS.map((f) => f.key))).toEqual([]);
    expect(dupes(SCENARIO_SEEDS.map((s) => s.key))).toEqual([]);
    expect(dupes(COMMON_SCENARIOS.map((s) => s.key))).toEqual([]);
  });
});

describe("domains", () => {
  it("has a default adversary for every crisis type", () => {
    for (const key of SCENARIO_DOMAIN_KEYS) {
      const d = SCENARIO_DOMAINS[key];
      for (const crisis of d.crisisTypes) {
        const adv = d.defaultAdversaryByCrisis[crisis];
        expect(adv, `${key}:${crisis}`).toBeDefined();
        expect(d.adversaryProfiles, `${key}:${crisis}`).toContain(adv);
        expect(d.crisisDescriptions[crisis], `${key}:${crisis}`).toBeDefined();
      }
    }
    expect(SCENARIO_DOMAINS.cyber.crisisTypes).toContain("Identity Provider Compromise");
    expect(SCENARIO_DOMAINS.cyber.defaultAdversaryByCrisis["Zero-Day Exploit"]).toBe("Nation-state espionage group");
    expect(SCENARIO_DOMAINS.financial.defaultAdversaryByCrisis["Ransomware Payment Decision"]).toMatch(/ransomware/i);
    expect(SCENARIO_DOMAINS.financial.defaultAdversaryByCrisis["OFAC Sanctions Screening Hit"]).toMatch(/counterparty/i);
    expect(showsCyberScaffolding("cyber")).toBe(true);
    expect(showsCyberScaffolding("legal")).toBe(false);
  });
});

describe("capabilities", () => {
  it("has 32 FEMA core capabilities", () => {
    const fema = listCapabilities("fema");
    expect(fema.length).toBe(32);
    expect(dupes(fema.map((c) => c.key))).toEqual([]);
  });

  it("has 6 NIST CSF functions and 22 categories", () => {
    const csf = listCapabilities("nist-csf");
    expect(csf.filter((c) => !c.parentKey).map((c) => c.key)).toEqual(["GV", "ID", "PR", "DE", "RS", "RC"]);
    expect(csf.filter((c) => c.parentKey).length).toBe(22);
    expect(dupes(csf.map((c) => c.key))).toEqual([]);
  });

  it("validates every capability and has unique seq per framework", () => {
    for (const f of CAPABILITY_FRAMEWORKS) {
      const list = listCapabilities(f.id);
      for (const c of list) capabilitySchema.parse(c);
      expect(dupes(list.map((c) => String(c.seq)))).toEqual([]);
    }
    expect(listCapabilities("unknown")).toEqual([]);
  });
});

describe("framework controls", () => {
  it("has unique control ids per framework", () => {
    for (const f of FRAMEWORKS) {
      const ids = listControls(f.id).map((c) => c.controlId);
      expect(ids.length, f.id).toBeGreaterThan(0);
      expect(dupes(ids), f.id).toEqual([]);
    }
    for (const c of CONTROLS) controlSchema.parse(c);
  });

  it("includes the key exercise controls", () => {
    expect(getControl("pci-dss", "12.10.2")?.testCadence?.months).toBe(12);
    expect(getControl("hipaa", "164.308(a)(7)(ii)(D)")).toBeDefined();
    expect(getControl("soc2", "CC7.4")).toBeDefined();
    expect(getControl("iso-22301", "8.5")).toBeDefined();
    expect(getControl("iso-27001", "A.5.30")).toBeDefined();
    expect(getControl("sec", "8-K 1.05")).toBeDefined();
    expect(getControl("nydfs", "500.16")).toBeDefined();
    expect(getControl("gdpr", "Art.34")).toBeDefined();
    for (const id of ["DE.AE-02", "DE.AE-06", "PR.DS-11", "PR.AA-05"]) expect(getControl("nist-csf", id), id).toBeDefined();
  });

  it("uses known frameworks in defaultCadence", () => {
    const ids = new Set(FRAMEWORKS.map((f) => f.id));
    for (const k of Object.keys(defaultCadence)) expect(ids.has(k as never), k).toBe(true);
  });

  it("keeps summaries to one plain sentence", () => {
    for (const c of CONTROLS) {
      expect(c.summary, c.controlId).toMatch(/\.$/);
      expect(c.summary.replace(/\.$/, "").includes(". "), c.controlId).toBe(false);
    }
  });
});

describe("regulatory clocks", () => {
  it("validates presets with unique keys", () => {
    for (const p of REGULATORY_CLOCK_PRESETS) regulatoryClockPresetSchema.parse(p);
    expect(dupes(REGULATORY_CLOCK_PRESETS.map((p) => p.key))).toEqual([]);
    for (const k of ["sec_8k", "gdpr_72h", "nydfs_72h", "hipaa_60d", "pci_brand", "insurer_notice", "state_ag", "cisa_72h", "nerc_cip_008", "nerc_cip_008_attempt", "doe_oe417_1h", "doe_oe417_6h"]) {
      expect(REGULATORY_CLOCK_PRESETS.some((p) => p.key === k), k).toBe(true);
    }
  });

  it("counts SEC business days over a weekend", () => {
    // Thursday 2026-10-01 12:00 UTC + 4 business days = Wednesday 2026-10-07 12:00 UTC.
    const d = computeClockDeadline({ businessDays: 4 }, new Date("2026-10-01T12:00:00Z"));
    expect(d.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    const h = computeClockDeadline({ durationHours: 72 }, new Date("2026-10-01T12:00:00Z"));
    expect(h.toISOString()).toBe("2026-10-04T12:00:00.000Z");
  });
});

describe("pressure artifacts", () => {
  it("validates and renders required placeholders", () => {
    expect(dupes(PRESSURE_ARTIFACTS.map((a) => a.key))).toEqual([]);
    for (const a of PRESSURE_ARTIFACTS) {
      pressureArtifactTemplateSchema.parse(a);
      const out = renderPressureArtifact(a.template, {
        orgName: "Example Org",
        incidentSummary: "a ransomware attack",
        time: "09:14",
      });
      expect(listPlaceholders(out), a.key).toEqual([]);
    }
  });
});

describe("log excerpt artifacts", () => {
  it("use only RFC 5737 public addresses and .example domains", () => {
    const logs = PRESSURE_ARTIFACTS.filter((a) => a.kind === "log_excerpt");
    expect(logs.map((a) => a.key)).toEqual(expect.arrayContaining(["entra-signin-log", "okta-system-log", "edr-alert", "vcenter-event"]));
    for (const a of logs) {
      const out = renderPressureArtifact(a.template, { orgName: "Example Org", incidentSummary: "an intrusion", time: "02:00" });
      const ips = out.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
      for (const ip of ips) {
        expect(/^(192\.0\.2|198\.51\.100|203\.0\.113|10)\./.test(ip), `${a.key} ${ip}`).toBe(true);
      }
      expect(out, a.key).not.toMatch(/\{\{/);
    }
  });
});

describe("fog additions", () => {
  it("adds bridge monitoring, EDR tampering and re-entry, and identity takeover techniques", () => {
    for (const k of ["attacker-on-bridge", "edr-tampered", "re-entry-after-eviction"]) expect(FOG_EVENTS.some((f) => f.key === k), k).toBe(true);
    const c = COMMON_SCENARIOS.find((x) => x.key === "cloud-identity-takeover")!;
    expect(c.techniques).toEqual(expect.arrayContaining(["T1621", "T1556.006", "T1484.002", "T1098.001"]));
    expect(c.techniques).not.toContain("T1071.001");
  });
});
