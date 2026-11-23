# Importing the official GS1 GPC dataset

**Status: BLOCKED on data.** The official GS1 GPC dataset was never supplied to this project, so no
real classification exists. The importer is built and tested only with synthetic rows. Until a real
dataset is imported, products show "Not classified" and the classification search reports
"no official dataset imported" — XR never invents GPC codes or presents internal categories as GPC.

## How to import (when you have the official file)

1. Download the GPC data from GS1 (the "GPC as a flat file/XLSX/JSON" publication for the version you
   choose). Convert it to **one JSON row per Brick** with exactly these keys:
   `segmentCode, segmentTitle, familyCode, familyTitle, classCode, classTitle, brickCode, brickTitle`.
   (A converter for GS1's own file layout has **not** been written: its layout was never available here.)
2. Dry-run (no writes) as an Owner:
   `POST /gpc/import {"versionName":"2026-05","source":"GS1 GPC …","rows":[…],"dryRun":true}`
   — returns validation errors and counts. Rules enforced: no missing columns, no duplicate Brick codes,
   each Class has exactly one Family, each Family exactly one Segment.
3. Real import: same body without `dryRun`. It is all-or-nothing, creates a new immutable version, makes it
   the active one, and keeps the previous version's rows (historical product mappings stay valid). A rejected
   attempt is recorded as `REJECTED` and never activated. Re-importing the same `versionName` is refused.
4. Request bodies up to 20 MiB are accepted for this route when authenticated (a full dataset exceeds the 1 MiB default).
5. Classify products from **Products → open a product → Official classification**.
