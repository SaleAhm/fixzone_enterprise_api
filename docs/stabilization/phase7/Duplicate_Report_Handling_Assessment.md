# Duplicate Report Handling Assessment

Date: 2026-07-16

## Current status

Explicit duplicate report detection and candidate warning are not implemented as a formal workflow.

## Recommended conservative future approach

Use deterministic candidate detection based on:

- same reporter;
- same organization;
- normalized category;
- nearby coordinates where available;
- normalized location text;
- normalized title/description tokens;
- short creation window;
- non-terminal existing report status.

The first version should warn and allow an intentional continue action. It should not merge, delete, or silently reject reports.

## Phase 7B-C decision

No duplicate-report implementation was added. This remains a missing feature, not a regression proven during this tranche.

