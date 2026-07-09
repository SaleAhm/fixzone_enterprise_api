# Upload Security Hardening Design

Date: 2026-07-09
Branch reviewed: `phase-4-platform-expansion`
Status: Design only; do not implement yet.

## Current State

The backend has two evidence patterns:

- Report evidence and provider completion evidence accept JSON payloads containing `contentType` and `imageBase64`, decode the base64 string, and write files under local `uploads`.
- Trust evidence records accept a `fileUrl` reference and store metadata, but do not write file bytes.

Relevant current files:

- `src/report/dto/upload-report-evidence.dto.ts`
- `src/report/dto/upload-completion-evidence.dto.ts`
- `src/report/report.controller.ts`
- `src/report/report.service.ts`
- `src/trust/dto/create-evidence.dto.ts`
- `src/trust/records.controller.ts`
- `src/trust/trust.service.ts`
- `src/trust/dto/submit-kyc.dto.ts`
- `src/trust/identity.controller.ts`
- `src/main.ts`
- `src/configure-app.ts`

## Current Validation And Storage Behavior

- Allowed declared content types for report images are `image/jpeg`, `image/png`, and `image/webp`.
- Decoded report image buffers are rejected only when size is `0` or greater than `5mb`.
- File names supplied by clients are not used in storage naming for report evidence, which reduces path traversal risk.
- Generated storage names use timestamp plus UUID and derive the extension from declared `contentType`.
- Files are written to `uploads/<folder>/<reportId>/<generated-name>`.
- `/uploads` is served publicly as static content.
- Global JSON and urlencoded request body size is `8mb`.
- Trust evidence `fileUrl` is limited to 1000 characters, but it is not restricted to approved schemes, hosts, internal paths, or known uploaded-file references.

## Upload Validation Gaps

### Report Image Uploads

- Base64 format is not strictly validated before decoding.
- `Buffer.from(value, 'base64')` can decode malformed or partially invalid base64 without proving the input was canonical.
- Declared `contentType` is trusted for extension selection.
- File magic bytes are not checked, so mismatched content can be saved with an image extension.
- Image structure is not validated, so corrupt files or non-image payloads with image-like headers may be accepted.
- No image dimension or pixel-count limit exists, leaving room for decompression/resource attacks.
- No malware scanning hook exists.
- No per-upload audit metadata records size, detected MIME, digest, or validation status.
- Existing local storage is publicly served from `/uploads`; all saved evidence URLs are directly accessible to anyone with the URL.
- No lifecycle cleanup exists for orphaned or superseded evidence files.
- No explicit storage root containment check exists after resolving paths, although current folder and generated filename choices reduce practical traversal risk.
- Base64 uploads pay a size overhead, and the current `8mb` JSON body limit sits close to the `5mb` decoded image limit.

### Trust Evidence URL Records

- `fileUrl` accepts arbitrary strings up to 1000 characters.
- No restriction exists for allowed URL schemes.
- No restriction exists for internal hosts, private networks, or application-owned upload paths.
- `fileType` is free text and can drift from actual content.
- External evidence references are not verified, scanned, normalized, or checked for availability.
- Metadata is accepted as an object with no depth/size/allowed-key policy.

### KYC Document References

- KYC submit uses document URL/reference style fields, not local byte upload.
- Document URLs should follow the same reference policy as trust evidence: approved schemes/hosts, no private-network references, and clear ownership or source metadata.

## Recommended Hardening Design

### Introduce A Central Upload Security Service

Create a reusable service for byte-level evidence validation before any file write:

- Strictly validate base64 input format and decoded size.
- Detect MIME type from file signature instead of trusting only `contentType`.
- Confirm declared MIME, detected MIME, and extension all agree.
- Validate image dimensions and pixel count.
- Calculate a SHA-256 digest for audit and duplicate detection.
- Enforce storage root containment before writing.
- Return normalized metadata: detected MIME, extension, byte size, digest, width, height.

Suggested initial limits:

- Max decoded image size: 5mb.
- Max image dimensions: 6000 x 6000.
- Max pixel count: 24 megapixels.
- Allowed image types: JPEG, PNG, WebP.
- Empty, malformed, truncated, or mismatched files: reject with `400 Bad Request`.

### Static Upload Serving

Keep the current `/uploads` static serving only if product requirements require public evidence links during this phase. Longer-term, evidence should move to protected delivery:

- Store private file references, not public URLs.
- Serve evidence through authenticated endpoints that enforce report/evidence ownership and tenant scope.
- Use signed short-lived URLs if external object storage is introduced.

If public `/uploads` remains for now, add response headers later for safer serving:

- `X-Content-Type-Options: nosniff`
- restrictive cache policy for sensitive evidence
- exact content type from validated metadata

### Malware Scanning Strategy

For the immediate hardening pass, add a scanner interface but allow a no-op implementation in non-production. Production should wire the interface to one of:

- ClamAV service.
- Cloud/object-storage malware scanning workflow.
- Dedicated commercial file scanning API.

Uploads should be marked accepted only after validation and scan success. If asynchronous scanning is chosen later, store evidence as pending and prevent normal user access until cleared.

### Trust Evidence URL Policy

Add a reference validator for URL-style evidence:

- Allow only `https://` URLs or local application-owned `/uploads/...` references, depending on product decision.
- Reject `http://`, `file:`, `data:`, `javascript:`, private IP ranges, localhost, and link-local addresses.
- Normalize and trim values before storage.
- Restrict `fileType` to an enum or controlled set.
- Limit metadata depth and serialized size.
- Prefer storing uploaded evidence IDs over arbitrary URLs where possible.

### Error And Audit Behavior

- Return validation failures as `400 Bad Request`.
- Return authorization/scope failures as `403 Forbidden`.
- Do not include raw file content, base64, external URLs with secrets, or hashes in public error responses.
- Audit successful uploads with size, detected MIME, digest prefix, report/evidence ID, actor ID, and organization ID where available.
- Audit rejected uploads only at a safe summary level.

## Exact File-Change Plan For Later

Do not implement during this review. When approved, change these files:

- `src/report/dto/upload-report-evidence.dto.ts`: add max base64 string length and stricter base64 validation decorator or pipe.
- `src/report/dto/upload-completion-evidence.dto.ts`: add max base64 string length and stricter base64 validation decorator or pipe.
- `src/report/report.service.ts`: replace inline `Buffer.from` and `saveImage` assumptions with centralized validation and storage helper results.
- `src/report/report.controller.ts`: no route shape change required unless adding upload-specific rate limiting decorators in the rate-limit tranche.
- `src/security/upload-security.service.ts`: new central byte validation, MIME detection, digesting, dimension checks, and storage containment helpers.
- `src/security/upload-security.module.ts`: export the upload security service to report/trust modules.
- `src/security/evidence-reference.validator.ts`: validate URL/reference-style trust and KYC evidence.
- `src/security/file-signature.ts`: small internal detector for JPEG, PNG, and WebP signatures if no dependency is approved.
- `src/security/file-scanner.interface.ts`: scanner abstraction with no-op/dev implementation.
- `src/trust/dto/create-evidence.dto.ts`: restrict `fileUrl`, `fileType`, and metadata size/depth.
- `src/trust/dto/submit-kyc.dto.ts`: apply the same URL/reference restrictions to KYC document references.
- `src/trust/trust.service.ts`: call the evidence reference validator before storing evidence and KYC document references.
- `src/main.ts`: later evaluate replacing public static `/uploads` with protected evidence-serving endpoints; if static remains, add safer headers.
- `src/configure-app.ts`: keep request body limits aligned with upload size policy and ensure errors are JSON.
- `src/report/report.module.ts` and `src/trust/trust.module.ts`: import the new upload/security module as needed.

No migration changes are required for minimum hardening. A later metadata/audit expansion may need schema changes, but that is outside this design-only phase.

## Dependency Assessment

Minimum hardening can be implemented without a new runtime dependency by checking JPEG, PNG, and WebP magic bytes manually.

Recommended but optional dependencies for a stronger implementation:

- Image metadata/dimension parser, such as `sharp` or an image-size library.
- Malware scanning integration client, depending on chosen scanner.

Because the user constraint says not to install packages now, this review recommends no package changes during design. Later implementation can either:

- Start dependency-free with signature checks and conservative byte-size validation.
- Add a vetted image metadata/scanning dependency after approval.

## Test Plan

Add service-level tests:

- `src/security/upload-security.service.spec.ts`
  - accepts valid JPEG, PNG, and WebP samples.
  - rejects empty payloads.
  - rejects malformed base64.
  - rejects declared MIME/signature mismatch.
  - rejects files over the decoded byte limit.
  - rejects excessive dimensions or pixel count if metadata parsing is implemented.
  - confirms generated paths remain under the upload root.
  - calculates stable SHA-256 digest metadata.

Add report e2e or service tests:

- `src/report/report.service.spec.ts`
  - citizen report evidence rejects invalid base64.
  - citizen report evidence rejects MIME mismatch.
  - provider completion evidence rejects oversized payload.
  - valid upload still stores normalized `evidenceImagePath`/`completionImagePath`.

Add trust e2e tests:

- `test/trust.e2e-spec.ts`
  - evidence record rejects `file:`, `data:`, `javascript:`, localhost, and private-network URLs.
  - evidence record accepts approved HTTPS or approved local evidence references.
  - KYC submit enforces the same document reference policy.
  - metadata exceeding size/depth policy is rejected.

Add static serving/protected delivery tests only if delivery behavior changes:

- unauthenticated access is blocked for protected evidence endpoint.
- authorized report owner/admin/provider can access scoped evidence.
- cross-tenant evidence access is denied.

## Risk Notes

- Public `/uploads` links are the largest residual confidentiality risk. Validation reduces malicious content risk but does not protect sensitive evidence from URL sharing.
- Base64 JSON uploads are less efficient than multipart or direct object storage and can increase memory pressure.
- Adding malware scanning synchronously can slow field workflows; asynchronous scanning needs a pending/quarantine state.
- Manual magic-byte checks are useful but weaker than full image parsing and scanning.
- Tight size/dimension limits may reject legitimate high-resolution field photos unless the frontend compresses before upload.
- Any future move to protected evidence delivery must preserve existing report records that already store `/uploads/...` URLs.

## Concise Implementation Plan Before Coding

1. Decide whether minimum hardening must be dependency-free or may add image/scanning dependencies.
2. Build a central upload security service and route all report image writes through it.
3. Add evidence URL/reference validation for trust evidence and KYC submissions.
4. Keep current route contracts stable unless product approves moving away from base64 JSON.
5. Add targeted service and e2e tests for invalid base64, MIME mismatch, oversize, URL policy, and happy paths.
6. Reassess public `/uploads` exposure as a separate protected-delivery work item before production scale-up.
