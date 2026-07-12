# Duplicate Detection and Clustering Design

Date: 2026-07-12

## 1. Current Verified State

No production duplicate report detection service, model, API, or admin comparison workflow was found. Prior documents identify duplicate handling as a future gap.

## 2. Initial Detection Signals

Use conservative signals:

- geographic proximity;
- category;
- normalized title and description;
- time window;
- linked operational registry item;
- active/open status;
- image similarity only as a future extension.

Initial classifications:

- `POSSIBLE_DUPLICATE`
- `PROBABLE_DUPLICATE`
- `NOT_DUPLICATE`

## 3. Safety Rules

- Do not automatically delete reports.
- Do not automatically merge citizen submissions.
- Preserve every citizen report and timeline.
- Admin decisions must be audited.
- Citizens should be notified only after a responsible workflow is approved.

## 4. Proposed Admin Workflow

1. View duplicate candidates.
2. Compare report details, category, location, timeline, evidence, and citizen-safe summary.
3. Select primary incident or reject candidate.
4. Link related reports.
5. Audit decision.
6. Notify affected users where policy allows.

## 5. Tests Required

- nearby same-category reports;
- unrelated nearby reports;
- same description far away;
- tenant isolation;
- time-window boundaries;
- manual rejection of duplicate suggestion;
- archived/closed report handling.

