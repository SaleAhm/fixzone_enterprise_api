# Dependency Security and Lint Gate Stabilization

Date: 2026-08-29

## Scope

This tranche covers local-only backend dependency-security remediation and lint-gate stabilization. No production access, deployment, migration execution, service change, production data change, frontend edit, or enterprise foundation flag enablement occurred.

## Critical dependency finding

`npm audit` reported a critical production dependency path:

```text
firebase-admin@13.10.0
-> @firebase/database-compat@2.1.4
-> @firebase/database@1.1.3
-> faye-websocket@0.11.4
-> websocket-driver@0.7.4
```

The vulnerable package was `websocket-driver` with advisories:

| Advisory | Severity | Affected range | Fixed version |
| --- | --- | --- | --- |
| GHSA-mp7j-qc5w-4988, resource limit bypass via message compression | Moderate | `<0.7.5` | `0.7.5` |
| GHSA-xv26-6w52-cph6, message corruption via protocol length headers | Critical | `<0.7.5` | `0.7.5` |

`websocket-driver` is in the production dependency tree because `firebase-admin` is a direct production dependency. Repository source inspection found no Nest runtime import of `firebase-admin`, no `admin.database()` or `getDatabase()` call, and no Firebase Realtime Database use. Current Firebase Admin use is limited to `scripts/seed-firebase-provider.ts`, which uses Firebase Auth and Firestore for a seed/maintenance workflow.

## Remediation

Selected remediation: supported transitive dependency lockfile refresh.

`faye-websocket@0.11.4` declares `websocket-driver@>=0.5.1`, and npm metadata shows patched `websocket-driver@0.7.5` is available. Running `npm update websocket-driver` advanced only `websocket-driver` from `0.7.4` to `0.7.5` in `package-lock.json`. No package override, audit suppression, forced audit fix, or Firebase Admin major upgrade was used.

Firebase Admin major version `14.3.0` exists and requires Node `>=22`; it is a larger direct-dependency upgrade and was not necessary to remove the critical `websocket-driver` path.

## Lint baseline

The previous canonical command, `npm run lint`, executed `eslint "{src,apps,libs,test}/**/*.ts" --fix`, so a validation gate could mutate files. This tranche splits linting into:

| Script | Behavior |
| --- | --- |
| `npm run lint` | Compatibility alias for non-mutating validation |
| `npm run lint:check` | Non-mutating ESLint validation |
| `npm run lint:fix` | Explicit developer-invoked autofix |

Measured non-mutating baseline:

| Rule | Count |
| --- | ---: |
| `@typescript-eslint/no-unsafe-member-access` | 306 |
| `@typescript-eslint/no-unsafe-argument` | 155 |
| `@typescript-eslint/no-unsafe-assignment` | 74 |
| `@typescript-eslint/no-unsafe-call` | 47 |
| `@typescript-eslint/no-unsafe-return` | 36 |
| `@typescript-eslint/no-redundant-type-constituents` | 9 |
| `@typescript-eslint/no-base-to-string` | 6 |
| `@typescript-eslint/require-await` | 6 |
| `prettier/prettier` | 3 |
| `@typescript-eslint/no-misused-promises` | 1 |
| `@typescript-eslint/no-unnecessary-type-assertion` | 1 |

Area breakdown:

| Area | Findings |
| --- | ---: |
| `test` | 355 |
| `src` | 289 |

Total: 489 errors and 155 warnings. A non-mutating `--fix-dry-run` measurement retained the same counts, so the baseline is predominantly type-safety debt rather than simple formatting debt. Generated files are not included by the lint glob.

After narrowly fixing lint findings in files changed since `a8c310b76c2d20925a371d96b036338feb5814ae`, the current whole-repository non-mutating lint result is 432 errors and 123 warnings:

| Rule | Count |
| --- | ---: |
| `@typescript-eslint/no-unsafe-member-access` | 258 |
| `@typescript-eslint/no-unsafe-argument` | 123 |
| `@typescript-eslint/no-unsafe-assignment` | 74 |
| `@typescript-eslint/no-unsafe-call` | 39 |
| `@typescript-eslint/no-unsafe-return` | 36 |
| `@typescript-eslint/no-redundant-type-constituents` | 8 |
| `@typescript-eslint/no-base-to-string` | 6 |
| `@typescript-eslint/require-await` | 6 |
| `prettier/prettier` | 3 |
| `@typescript-eslint/no-misused-promises` | 1 |
| `@typescript-eslint/no-unnecessary-type-assertion` | 1 |

Current area breakdown:

| Area | Findings |
| --- | ---: |
| `src` | 288 |
| `test` | 267 |

## Phased lint-debt plan

1. Fix the three `prettier/prettier` errors and any low-risk redundant type constituents or unnecessary assertions in small scoped commits.
2. Address `require-await`, `no-base-to-string`, and `no-misused-promises` findings where they indicate real async/control-flow defects.
3. Stabilize test helper typing to reduce the 355 test-area unsafe member, assignment, call, return, and argument findings without weakening type-safety rules.
4. Stabilize production `src` DTO, Prisma result, auth, report, and workflow typing in bounded module tranches, keeping each tranche covered by focused and full regression tests.
5. Keep `lint:check` non-mutating for CI/release gates and use `lint:fix` only as an intentional developer cleanup command.
