# Phase 7A — Action and Placeholder Completeness Register

| Area | Visible action/control | Evidence | Classification | Risk | Recommendation |
|---|---|---|---|---|---|
| Citizen report | Submit report | `CitizenSubmitReportScreen._submit`, `ReportService.createCitizenReport`, backend `POST /report` | Implemented | Medium | Manual authenticated smoke |
| Citizen report | Pick camera/gallery evidence | `image_picker`, XFile image widgets, evidence upload service | Implemented | Medium | Verify Web/Android permissions and retry |
| Citizen report | Get current location | `LocationSelection`, geolocator dependencies | Implemented with limitations | Medium | Verify permissions, fallback and privacy wording |
| Citizen report | Manual pin | UI exists in submit screen | Partial | Medium | Confirm actual map/pin interaction and persistence |
| Citizen detail | Open report detail | Citizen list/detail route and `getReportById` | Implemented | Low | Manual smoke |
| Citizen detail | Timeline | Backend timeline API plus fallback timeline | Functional with limitation | Medium | Avoid fallback masking API failure |
| Citizen completion | Confirm completed | Completion review screen and confirm API | Implemented | Medium | End-to-end smoke with notifications/audit |
| Citizen completion | Work still incomplete | Reject-completion API exists | Implemented | Medium | Ensure wording does not say “reject provider” |
| Citizen notifications | Mark read | `NotificationService.markNotificationRead` | Implemented | Low | Verify click-through |
| Citizen notifications | Mark all read | `markAllNotificationsRead` | Implemented | Low | Verify |
| Citizen profile | Edit profile | `ApiService.updateMe` | Implemented | Medium | Verify email/password expectations |
| Citizen profile | Security/session | Routes to Trust Center security | Partial | Medium | Real session revoke not complete |
| Provider login | Forgot password | `provider_login_screen.dart` has `onPressed: () {}` | Placeholder | High | Implement forgot/reset password UX |
| Provider jobs | Accept assignment | `ReportService.acceptAssignedReport`, status API | Implemented | Medium | Verify audit/notifications |
| Provider jobs | Reject assignment with reason | `rejectProviderAssignment` and backend reject DTO | Implemented | Medium | Verify required reason, notification |
| Provider jobs | Completion evidence upload | Backend completion evidence endpoint | Implemented | Medium | Verify multi-image/retry/progress later |
| Provider profile | Theme controls | Text says “Full theme controls coming soon” | Placeholder | Low | Hide or implement |
| Provider subscription | Choose/upgrade plan | Provider subscription screens | Partial | Revenue | Payment gateway absent |
| Billing history | Invoice download/card payment | Screen states disabled until processor configured | Disabled intentionally | Revenue | Implement payment/invoice tranche |
| Admin dispatch | Manual assignment | UI + `assignProvider` + backend assign endpoint | Implemented | Medium | Confirm audit |
| Admin dispatch | Auto-Assign Best Match | UI calls recommendation then assignment; backend dispatch AI service | Functional with limitation | High | Explain scoring; audit sampled outcomes |
| Admin dispatch | Auto Assign All | UI and service method exist | Implemented/unverified | High | Add confirmation and audit verification |
| Admin dispatch | Expire overdue assignments | UI and endpoint exist | Implemented/unverified | High | Add confirmation, dry-run/count preview |
| Admin dispatch | Reassign | UI and backend reassign endpoint | Implemented | Medium | Confirm conflict handling |
| Admin dispatch | Cancel assignment | UI and backend cancel endpoint | Implemented | Medium | Confirm notifications/audit |
| Admin reports | Filter/search | UI filter states exist | Implemented | Low | Add pagination/export |
| Admin reports | Export | No complete UI export found | Missing | Medium | Add controlled export |
| Admin users | Invite | `inviteAdminUser`, backend invitation endpoint | Implemented | High | Verify tenant scoping and email delivery |
| Admin users | Edit | `updateAdminUser` | Implemented | Medium | Confirm role-change guard |
| Admin users | Reset password | `resetAdminUserPassword` | Implemented | High | Verify temporary password handling policy |
| Admin users | Suspend/activate | `setAdminUserStatus` | Implemented | High | Confirm self-protection |
| Admin users | Resend invitation | API/UI exist | Implemented | Medium | Verify |
| Admin users | Approve/reject provider request | API/UI exist | Implemented | Medium | Verify |
| Admin providers | Assign/deactivate/remove capabilities | Provider capability APIs/UI exist | Implemented | Medium | Verify tenant scoping |
| Organizations | Create/edit | API/UI exist | Implemented | Medium | Verify validation |
| Organizations | Activate/suspend/archive | API/UI exist | Implemented | High | Confirm audit and tenant impact warning |
| Organizations | Future module selections | UI labels metadata-only | Metadata-only | Medium | Prevent accidental activation |
| Monetization | Billing settings update | Org update API used | Partial | Revenue | Replace RC/manual placeholders |
| Monetization | Payment gateway | Not connected | Missing | Revenue | Phase 7E |
| Platform Tools | Demo generate/reset/purge | UI/API/e2e coverage exists | Implemented but test failing | High | Stabilize demo e2e |
| Platform Tools | Health | UI/API exist | Implemented | Medium | Verify real metrics/refresh |
| Platform Tools | Cache clear | UI/API exist | Implemented | Medium | Confirm safe scopes |
| Platform Tools | Create backup | UI/API exist | Partial; test failing | High | Fix backup e2e and operator UX |
| Platform Tools | Delete backup | UI/API exist | Partial | High | Confirmation/audit required |
| Platform Tools | Download backup | Backend endpoint exists | Backend-only/sensitive | Critical | Do not expose until safe controls |
| Platform Tools | Restore backup | Backend endpoint exists | Backend-only/unsafe to expose broadly | Critical | Requires explicit authorization, pre-restore backup and runbook |
| Platform Tools | Audit export | Backend endpoint exists; UI text says export disabled | Backend-only/disabled | Medium | Implement export with filters |
| Trust Center | Submit KYC | UI/API exist | Implemented | High | Verify admin review e2e |
| Trust Center | Review KYC | Admin UI/API exist | Implemented | High | Verify audit |
| Trust Center | Create evidence record | UI/API exist | Implemented | High | Verify document scoping |
| Trust Center | Open dispute/message/status/assign/escalate | UI/API exist | Implemented | High | Verify notifications |
| Trust Center | Device/session revoke | UI says future-ready | Placeholder/foundation | High | Implement only with real token invalidation |
| Public website | Live metrics/donut/trends/geography | Production verified | Implemented | Low | Monitor |

