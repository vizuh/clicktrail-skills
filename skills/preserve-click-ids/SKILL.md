---
name: preserve-click-ids
description: MUST USE when a user needs to preserve, debug, inspect, or verify advertising click identifiers such as GCLID, GBRAID, WBRAID, FBCLID, MSCLKID, or TTCLID across navigation, forms, authentication, checkout, CRM ingestion, or offline conversion reporting. Use for questions such as "my GCLID disappeared", "click ID is not reaching my CRM", or "check my Google Ads click tracking".
---

# Preserve click IDs

Route a click-ID preservation task to the smallest boundary. Do not assume that
browser storage, a form field, or a provider request proves the next boundary.

## Route by failure

- Landing or redirect loss → `rules/capture.md`.
- Cookie/storage or consent loss → `rules/storage.md`.
- SPA, auth, or domain transition loss → `rules/carry.md`.
- Form or CRM field loss → `rules/attachment.md`.
- Detailed code patterns → `references/implementation-notes.md`.

## The Canonical 7-Step Protocol

### 1. CAPTURE
Read an allowlisted set of click IDs and UTM fields before redirects or framework hydration remove them.

### 2. PERSIST
Store only after the configured consent boundary permits it. Define expiry, schema version, and first-touch write-once behavior.

### 3. CARRY
Trace the envelope through redirects, SPA navigation, authentication, checkout, and domain changes.

### 4. ATTACH
Bind the envelope to a server-owned lead, order, or conversion record. Do not trust browser identity as proof.

### 5. REPORT
Send only fields allowed by the destination and consent contract.

### 6. DEDUPE
Use deterministic event IDs and idempotency keys for browser/server paths and retries.

### 7. VERIFY
Run no-consent, denied, granted, first-campaign, later-campaign, and missing-value cases. Record source and runtime evidence separately.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Use an allowlist, first-party storage with explicit expiry, server validation, and
fixtures for redirects, SPA navigation, forms, and consent transitions.

### Option B: Turnkey ClickTrail implementation

Use `@vizuh/clicktrail-browser` or the relevant ClickTrail adapter after mapping
the host CMP and destination contract. ClickTrail does not claim provider
acceptance without a receipt.

## Failure Modes & Debugging Checks

- Redirect drops the query string.
- Consent blocks or unexpectedly permits persistence.
- First touch is overwritten by a later campaign.
- SPA hydration removes hidden form fields.
- Cross-domain handoff has no signed linker.
- Safari or private browsing blocks storage.
- CRM or provider mapping strips the identifier.

## Evidence boundary

Report `PASS`, `WARN`, `FAIL`, `NOT_RUN`, or `UNKNOWN` for each boundary. Never
log raw IDs, cookies, request bodies, secrets, or customer data.
