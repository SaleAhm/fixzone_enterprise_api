# SecureZone User Observation Register

Assessment date: 2026-07-10

## Purpose

This register translates manual QA observations into stabilization-ready user-impact items.

## User-facing observations

| ID | Persona | Observation | Impact | Priority |
| --- | --- | --- | --- | --- |
| UO-001 | Provider | Login failures block provider dashboard access. | Critical workflow blocked. | P0 |
| UO-002 | Provider | Provider ID display can show internal IDs. | Unprofessional and confusing. | P1 |
| UO-003 | Provider | Job details may miss uploaded evidence images. | Completion proof unclear. | P1 |
| UO-004 | Provider | Analytics/profile layouts can feel crowded on mobile. | Reduced mobile usability. | P2 |
| UO-005 | Citizen | Completion validation wording must avoid “reject provider.” | Workflow trust and tone issue. | P1 |
| UO-006 | Citizen | Evidence images may fail to load on review screens. | Cannot validate work confidently. | P1 |
| UO-007 | Citizen | Category cards should open meaningful category history/details. | Navigation completeness. | P2 |
| UO-008 | Organization admin | Must see only tenant providers/reports/analytics/billing. | Tenant isolation. | P0 |
| UO-009 | Organization admin | Dispatch reassignment states need clarity. | Operational workflow risk. | P1 |
| UO-010 | Super admin | Platform Tools cards must render reliably. | Admin operations blocker. | P1 |
| UO-011 | Super admin | Mobile KPI and welcome cards must not clip. | Professional polish. | P2 |
| UO-012 | Public visitor | Website should distinguish live metrics from static marketing figures. | Credibility risk. | P2 |

## Recommended UI stabilization ordering

1. Provider login and provider card identity display.
2. Mobile overflow fixes.
3. Evidence image visibility.
4. Platform Tools rendering and mobile spacing.
5. Workflow wording and notification clarity.
