# SecureZone UI Stabilization Backlog

Assessment date: 2026-07-10

## Priority backlog

| Priority | Item | Area | Acceptance criteria |
| --- | --- | --- | --- |
| P0 | Provider login validation | Provider portal | `provider1@fixzone.ng` and supported provider-ID login enter provider dashboard. |
| P0 | Tenant isolation smoke | Admin/provider/citizen | No user sees another organization’s private data. |
| P1 | Provider card responsive layout | Admin Providers | No RenderFlex overflow at 360-430px widths. |
| P1 | Platform Tools mobile layout | Super Admin | All cards and selected panels render without overflow. |
| P1 | Evidence image visibility | Citizen/provider/admin details | Uploaded evidence appears or shows professional fallback. |
| P1 | Platform Tools card rendering | Super Admin | All six panels render visible content; no blank body. |
| P1 | Assignment lifecycle labels | Provider/citizen/admin | Timeline shows expected stages consistently. |
| P1 | Completion validation wording | Citizen | Use “Confirm completed” and “Work still incomplete”; no direct “Reject Provider” action. |
| P2 | Provider analytics polish | Provider | Cards/sidebar/content do not crowd on mobile. |
| P2 | Organization monetization visibility | Admin Organizations | Usage bars static after load; quotas clearly labelled. |
| P2 | Notification click-through | All portals | Notifications route to authorized detail screens. |
| P2 | Website live-data copy | Public website | Static vs live claims are clear. |

## Provider analytics screenshot assessment

The provider analytics/mobile screenshot review should focus on the following frontend areas:

- `lib/features/provider/presentation/screens/provider_analytics_screen.dart`
- `lib/features/provider/presentation/screens/provider_home_shell.dart`
- `lib/features/provider/presentation/screens/provider_profile_screen.dart`
- shared responsive/card widgets used by provider dashboards

Likely widget hierarchy to inspect:

```text
ProviderHomeShell
  -> responsive shell / sidebar / bottom navigation
  -> selected provider body
  -> ProviderAnalyticsScreen
     -> scroll container
     -> KPI cards
     -> charts / analytics panels
     -> activity or performance rows
```

Recommended minimal fixes when implementation resumes:

1. Ensure the root provider content area is scrollable on mobile.
2. Avoid fixed heights for cards that contain dynamic text.
3. Use `Wrap`, `Flexible`, or responsive grid breakpoints for KPI cards.
4. Apply `maxLines` and `TextOverflow.ellipsis` to long email, ID, organization, and category labels.
5. Keep `Expanded` only inside bounded `Row`/`Column` parents.
6. Add bottom padding for mobile navigation SafeArea.
7. Test Pixel-width layouts around 360, 390, and 430 pixels.

## Non-goals for this backlog

- No new healthcare/legal/agriculture/ICT/education modules.
- No payment gateway implementation.
- No charting/heat-map/GPS expansion beyond stabilization.
- No backup restore/download expansion.
- No production deployment.
