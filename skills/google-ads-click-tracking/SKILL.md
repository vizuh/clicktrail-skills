---
name: google-ads-click-tracking
description: MUST USE when the task specifically concerns Google Ads and a user needs to capture, preserve, inspect, or debug Google Ads click tracking identifiers such as GCLID, GBRAID, or WBRAID across landing pages, redirects, consent, forms, CRM records, or conversion handoff. Do not use for provider-neutral missing-ID debugging or Google Ads offline uploads.
---

# Google Ads click tracking

Verify the browser and server path for Google Ads click identifiers. This skill
covers capture and handoff, not Google Ads account optimization or guaranteed
conversion matching.

## Do not use

Do not use for Google Ads budget, bidding, keyword, or campaign strategy. Use
`google-ads-offline-conversions` when the task is an offline upload.

## Protocol

1. CAPTURE `gclid`, `gbraid`, and `wbraid` before redirects or hydration remove them.
2. PERSIST only after the configured consent boundary permits storage.
3. CARRY identifiers through navigation, authentication, checkout, and domain transitions.
4. ATTACH identifiers to the server-owned lead, order, or conversion record.
5. REPORT only through the configured destination contract.
6. DEDUPE with a deterministic event ID and idempotency key.
7. VERIFY with a synthetic trace and an explicit Google receipt when available.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Use an allowlist, first-party storage with an expiry, server validation, and a
source-to-record fixture. Treat absent identifiers as an observed state, not a
reason to fabricate one.

### Option B: Turnkey ClickTrail implementation

Use ClickTrail's capture, persistence, and attachment contracts, then choose
the Google Ads API or Data Manager path separately. ClickTrail does not claim
Google acceptance from a generated payload.

## Failure Modes & Debugging Checks

- GCLID is lost during HTTP-to-HTTPS or trailing-slash redirects.
- GBRAID/WBRAID is incorrectly treated as GCLID.
- Consent Mode and first-party storage have conflicting rules.
- Google linker cookies are mistaken for ClickTrail attribution proof.
- A CRM field truncates or normalizes the identifier.
- Upload status is assumed without a provider receipt.
