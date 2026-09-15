---
name: utm-and-click-id-persistence
description: MUST USE when designing or reviewing the storage policy for UTM parameters and advertising click IDs, including consent, expiry, schema version, first-touch write-once, last-touch updates, and lifecycle boundaries. Use for greenfield or cross-stack persistence contracts; do not use for a browser-specific implementation repair.
---

# UTM and click-ID persistence

Keep acquisition context available without turning the browser into a customer
identity store. Define first-touch and last-touch semantics before writing code.

## Do not use

Do not use for multi-touch attribution modeling, ad-spend optimization, or
indefinite browser tracking.

## Protocol

1. CAPTURE an allowlisted set of UTM and click-ID fields at the earliest trusted boundary.
2. PERSIST with explicit consent, expiry, schema version, and a first-touch write-once rule.
3. CARRY the envelope through route changes, redirects, auth, checkout, and forms.
4. ATTACH it to the server-owned record rather than trusting a browser identity field.
5. REPORT only the fields allowed by the destination and consent contract.
6. DEDUPE state updates and conversion events with stable IDs.
7. VERIFY first-touch, last-touch, expiry, denial, withdrawal, and missing-value cases.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Use a small allowlist, server-readable first-party storage where possible, and
fixtures for no consent, denied, granted, first campaign, and later campaign.
Never log raw query strings or customer identifiers.

### Option B: Turnkey ClickTrail implementation

Use ClickTrail's canonical attribution envelope and adapter-specific storage
rules. Confirm the host CMP contract before enabling persistence or delivery.

## Failure Modes & Debugging Checks

- First touch is overwritten by every later campaign.
- Last touch never updates after navigation.
- Storage is written before consent or remains after denial.
- A redirect strips the query string.
- Cookie scope, `Secure`, `SameSite`, or expiry blocks the expected carry path.
- A form serializes only visible fields and drops the attribution envelope.
