# Taxonomy snapshot

## What this is

The occupation and skill taxonomy that `init` imports into Postgres at boot, with no network access. It is a gzipped JSONL snapshot built by `scripts/taxonomy/build.ts`:

- `manifest.json`: format, version (`onet-31.0-<hash>`), sources, and the sha256, size and row count of each data file.
- `occupations.jsonl.gz`, `skills.jsonl.gz`, `occupation_skills.jsonl.gz`, `relations.jsonl.gz`: the data.

The committed snapshot is **O\*NET-only** (O\*NET 31.0, about 1,016 occupations). ESCO needs a download link sent by email, so it is not included yet; adding it later changes the snapshot version and `init` re-imports on the next boot.

## Attribution

This product includes information from the O\*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license (https://creativecommons.org/licenses/by/4.0/). O\*NET® is a trademark of USDOL/ETA. Pathwise has modified all or some of this information (selected fields only, importance scores normalized to 0–1). USDOL/ETA has not approved, endorsed, or tested these modifications.

This service uses the ESCO classification of the European Commission (ESCO v1.2.1, https://esco.ec.europa.eu). (Applies once an ESCO export is included in the snapshot; the current snapshot contains no ESCO data.)

## Rebuilding

O\*NET-only: `pnpm taxonomy:build` (downloads the pinned O\*NET zip and verifies its sha256).

With ESCO: at https://esco.ec.europa.eu/en/use-esco/download, choose v1.2.1, "classification", English, CSV (the link arrives by email) and unzip it. Optionally save the ESCO–O\*NET crosswalk from the portal as CSV. Run `pnpm taxonomy:build --esco <dir> [--crosswalk <file>]`.

A new O\*NET release means updating `ONET` (URL, version, sha256) in `scripts/taxonomy/build.ts` and the attribution text together.
