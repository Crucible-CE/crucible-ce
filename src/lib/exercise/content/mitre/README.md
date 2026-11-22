# ATT&CK Enterprise catalog

`catalog.generated.ts` holds every non-deprecated, non-revoked ATT&CK Enterprise technique and sub-technique: ID, name, and tactic IDs. Nothing else (no descriptions, platforms, or detection text).

## Source

- Upstream data: MITRE ATT&CK Enterprise STIX bundle, `https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json`.
- Last regenerated 2026-03-22.
- 691 techniques: 216 parent techniques and 475 sub-techniques.

## How it was generated

1. Read every technique from the STIX bundle as described under Regenerating.
2. Kept `id`, `name`, and `tactics` per row. `isSubtechnique` and `parentId` are derived at load time in `index.ts` from the ID (`T1059.001` has parent `T1059`).
3. Wrote one tuple per row: `[id, name, "TA0001,TA0003"]`.

## Regenerating

To refresh from upstream, fetch the STIX bundle and, for each `attack-pattern` object that is not `revoked` and not `x_mitre_deprecated`:

- take the `external_id` from the `mitre-attack` external reference,
- map each `kill_chain_phases[].phase_name` (kill chain `mitre-attack`) to its tactic ID (`initial-access` to `TA0001`, and so on, see `ATTACK_TACTICS` in `index.ts`),
- sort by technique number then sub-technique number,
- emit the same tuple format.

A generator script for this repo belongs in `scripts/` and is not part of `src/content`. After regenerating, run the content tests: every threat actor, replay, and common scenario technique ID must still resolve.

ATT&CK is a registered trademark of The MITRE Corporation. ATT&CK content is used under the ATT&CK terms of use.
