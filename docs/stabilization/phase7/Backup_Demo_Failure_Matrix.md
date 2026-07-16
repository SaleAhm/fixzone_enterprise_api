# Backup and Demo Failure Matrix

Date: 2026-07-16

## Classification key

- A: Production runtime defect
- B: Fixture collision
- C: Database contamination
- D: Rate-limit contamination
- E: Filesystem path or permission defect
- F: Stale artifact state
- G: Non-idempotent workflow
- H: Improper cleanup
- I: Validation or error-mapping defect
- J: Environment/configuration dependency
- K: Concurrent-operation race
- L: Historical issue not currently reproducible

| Workflow | Finding | Evidence | Classification | Status |
| --- | --- | --- | --- | --- |
| Backup creation | Filename collision possible within same second | Source review and repeated-create regression target | A, G, K | Fixed |
| Backup cleanup in tests | Metadata cleanup did not remove generated files | Test lifecycle review | H | Fixed in test cleanup |
| Backup missing directory | Service creates `backups` recursively | Source review | L | No defect reproduced |
| Backup listing metadata | Unreadable file metadata is sanitized with `unreadable: true` | Source review | L | Existing graceful behavior |
| Demo generation | Static demo provider IDs collided on repeated generation | Focused repeated-generation test returned HTTP 500 before fix | A, G, K | Fixed |
| Demo generation | Phone values were not batch-scoped | Source review during repeated-generation failure | A, G, K | Fixed |
| Demo purge | Purge deletes tagged demo notifications, reports, users, organizations | Source/test review | L | No defect reproduced |
| Demo existing data | Multiple demo batches are allowed until purge | Source/test review | Expected behavior | Preserved |

## Exact failures reproduced

- Demo repeated generation returned HTTP 500 before provider ID batch-scoping.

## Exact failures not reproduced after fixes

- Backup creation HTTP 500.
- Demo generation HTTP 500.
- Stale artifact failure after repeated sequential focused and full regression runs.

