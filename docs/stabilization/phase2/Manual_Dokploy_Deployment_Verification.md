# Manual Dokploy Deployment Verification

SecureZone Platform / FixZone Maintenance Services  
Manual Dokploy Evidence Checklist  
Date: 2026-07-11

```text
Verification status: PENDING MANUAL DOKPLOY UI INSPECTION
Deployment decision: NOT READY FOR DEPLOYMENT
```

## 1. Verification status

This document is a manual evidence checklist for read-only Dokploy UI inspection.

It covers:

- `FixZone-API` for `api.securezonegroup.com`;
- `FixZone-Web` for `fixzone.securezonegroup.com`.

Known context:

| Area | Value |
| --- | --- |
| Dokploy project | `SecureZone-Infrastructure` |
| Backend application | `FixZone-API` |
| Backend pushed branch | `phase-4-platform-expansion` |
| Backend pushed HEAD | `a755b7b78d0be793e30035da18e7ac66c1996733` |
| Flutter application | `FixZone-Web` |
| Flutter pushed branch | `phase-4-platform-expansion` |
| Flutter pushed HEAD | `ab67d683dc7e31ddbeaf73d9db27b7aaaad4bf0b` |

Purpose:

- establish the Git repository connected to each application;
- establish the configured deployment branch;
- establish build method and deployment source;
- confirm automatic deployment or webhook status;
- record latest deployed revision and deployment timestamp;
- determine whether the July 11, 2026 pushes triggered deployment;
- determine whether each application is ready for a controlled redeployment.

Completing this checklist does not deploy anything and does not authorize deployment.

## 2. Safety rules

The person performing this manual inspection must not click or change:

- Deploy;
- Redeploy;
- Restart;
- Rebuild;
- Save;
- Update;
- Apply;
- repository selection;
- branch selection;
- Git provider;
- build method;
- environment variables;
- domains;
- SSL settings;
- ports;
- mounts;
- networks;
- health checks;
- resource limits;
- commands;
- auto-deploy or webhook settings.

Do not reconnect GitHub.

Do not inspect, copy, export, or reveal secret values.

Do not copy into this document or screenshots:

- passwords;
- API keys;
- tokens;
- database URLs;
- private keys;
- webhook secrets;
- full environment-variable values;
- private certificate material.

If an environment-variable page must be opened to confirm that a section exists, mask or crop values before storing evidence. Prefer avoiding secret pages entirely unless required by the release owner.

## 3. Backend inspection table: `FixZone-API`

Domain:

```text
api.securezonegroup.com
```

Expected pushed HEAD:

```text
a755b7b78d0be793e30035da18e7ac66c1996733
```

| Field | Recorded value | Evidence |
| --- | --- | --- |
| Dokploy project |  |  |
| Application name |  |  |
| Domain | `api.securezonegroup.com` |  |
| Git provider |  |  |
| Repository owner/name |  |  |
| Configured branch |  |  |
| Build method |  |  |
| Build directory/context |  |  |
| Dockerfile or configuration path |  |  |
| Auto-deploy enabled |  |  |
| Webhook enabled |  |  |
| Current application status |  |  |
| Latest deployment status |  |  |
| Latest deployment timestamp |  |  |
| Deployment ID |  |  |
| Deployed commit hash |  |  |
| Deployed commit message |  |  |
| Push triggered deployment |  |  |
| Matches pushed HEAD `a755b7b` |  |  |
| Screenshot or evidence reference |  |  |

Backend classification after inspection:

```text
PENDING
```

## 4. Flutter inspection table: `FixZone-Web`

Domain:

```text
fixzone.securezonegroup.com
```

Expected pushed HEAD:

```text
ab67d683dc7e31ddbeaf73d9db27b7aaaad4bf0b
```

| Field | Recorded value | Evidence |
| --- | --- | --- |
| Dokploy project |  |  |
| Application name |  |  |
| Domain | `fixzone.securezonegroup.com` |  |
| Git provider |  |  |
| Repository owner/name |  |  |
| Configured branch |  |  |
| Build method |  |  |
| Build directory/context |  |  |
| Dockerfile or configuration path |  |  |
| Auto-deploy enabled |  |  |
| Webhook enabled |  |  |
| Current application status |  |  |
| Latest deployment status |  |  |
| Latest deployment timestamp |  |  |
| Deployment ID |  |  |
| Deployed commit hash |  |  |
| Deployed commit message |  |  |
| Push triggered deployment |  |  |
| Matches pushed HEAD `ab67d68` |  |  |
| Screenshot or evidence reference |  |  |

Flutter classification after inspection:

```text
PENDING
```

## 5. Manual UI navigation guidance

Use the actual labels presented by Dokploy where visible. Do not invent UI values.

Read-only sequence:

1. Sign in to Dokploy.
2. Open project `SecureZone-Infrastructure`.
3. Open `FixZone-API`.
4. Inspect its General, Source, Git, Build, Deployments, and Settings pages as available.
5. Record the configured repository and branch.
6. Record build type and source paths.
7. Record auto-deploy or webhook state without toggling anything.
8. Open deployment history.
9. Record the latest deployment timestamp, status, ID, commit hash, and message.
10. Check for any deployment after the July 11, 2026 source push.
11. Repeat steps 3-10 for `FixZone-Web`.
12. Leave every page without saving or applying changes.

Important:

- If Dokploy labels differ from the names above, record the exact visible label.
- If a field is hidden, unavailable, or requires opening a risky edit screen, mark it `Not visible from read-only inspection`.
- Do not click any action button.

## 6. Evidence capture guidance

Capture screenshots of:

- application overview;
- repository/source and configured branch;
- build method;
- auto-deploy/webhook setting;
- latest deployment details;
- deployment history around July 11, 2026.

Each screenshot should avoid exposing:

- passwords;
- API keys;
- tokens;
- database URLs;
- private keys;
- full environment-variable values;
- webhook secret values.

Recommended evidence reference format:

```text
screenshots/dokploy/<application>/<YYYY-MM-DD>-<short-description>.png
```

Examples:

```text
screenshots/dokploy/fixzone-api/2026-07-11-source-branch.png
screenshots/dokploy/fixzone-web/2026-07-11-deployment-history.png
```

Do not store screenshots containing secrets.

## 7. Classification rules

For each application, use one of:

```text
A. TRACKS PHASE-4-PLATFORM-EXPANSION
B. TRACKS A DIFFERENT BRANCH
C. DEPLOYMENT SOURCE OR BRANCH CANNOT BE VERIFIED
D. UNEXPECTED AUTOMATIC DEPLOYMENT DETECTED
```

Classification guidance:

- Use `A` only if repository and branch are visible and exactly match the expected repository and `phase-4-platform-expansion`.
- Use `B` if the application tracks `main`, `master`, `deploy`, or another branch.
- Use `C` if the configured repository or branch cannot be verified without unsafe actions.
- Use `D` if deployment history shows a deployment occurred after the July 11, 2026 source push without an explicit deployment instruction.

## 8. Readiness decision rules

The final manual decision may be:

```text
READY FOR CONTROLLED DEPLOYMENT
```

only when:

- both applications connect to the expected repositories;
- both applications track `phase-4-platform-expansion`;
- auto-deploy behavior is understood;
- no unexpected deployment occurred;
- latest deployment history is recorded;
- deployed revisions are known;
- no unresolved configuration ambiguity remains.

Otherwise retain:

```text
NOT READY FOR DEPLOYMENT
```

If either application receives classification `B`, `C`, or `D`, the overall decision remains `NOT READY FOR DEPLOYMENT` until reviewed by the release owner.

## 9. Deployment comparison table

| Application | Configured branch | Deployed revision | Pushed revision | Match | Auto-deploy | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| FixZone-API |  |  | `a755b7b` |  |  |  |
| FixZone-Web |  |  | `ab67d68` |  |  |  |

## 10. Manual evidence sign-off

| Sign-off item | Value |
| --- | --- |
| Inspector name |  |
| Inspection date/time |  |
| Dokploy project inspected |  |
| Backend evidence complete |  |
| Flutter evidence complete |  |
| Secrets excluded from screenshots |  |
| No Dokploy settings changed |  |
| No deploy/redeploy/restart/rebuild clicked |  |
| Final manual classification |  |
| Final manual decision |  |

## 11. Final authorization boundary

```text
Completing this document does not authorize deployment.

A separate explicit deployment instruction is required after the manual
Dokploy evidence has been reviewed and the decision has changed to
READY FOR CONTROLLED DEPLOYMENT.
```

This checklist is an evidence collection tool only. It must not be treated as approval to deploy, redeploy, restart, rebuild, change branches, change repository settings, modify environment variables, alter domains, run migrations, or change production configuration.
