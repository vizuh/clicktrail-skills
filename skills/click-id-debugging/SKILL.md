---
name: click-id-debugging
description: MUST USE when a provider-neutral click identifier or UTM is missing, malformed, or lost between application boundaries. Use for a general missing-ID incident trace. Do not use for storage-policy design (use `utm-and-click-id-persistence`), an existing browser implementation repair (use `preserve-click-ids`), a specifically Google Ads task (use `google-ads-click-tracking`), or CRM attachment (use `click-to-crm-attribution`).
---

# Click-ID debugging

Find the first boundary where an allowlisted acquisition parameter is lost.
Do not start by changing the destination API or inventing a replacement ID.

## Do not use

Do not use for general analytics redesign, ad spend optimization, or provider
reporting when no click-ID loss is alleged.

## Diagnostic sequence

1. CAPTURE the exact synthetic landing URL and query keys.
2. PERSIST the identifier under the declared consent state.
3. CARRY it through redirects, SPA routes, auth, checkout, and domain changes.
4. ATTACH it to a synthetic form, order, or CRM record when safe.
5. REPORT which boundary has the last known value.
6. DEDUPE the identifier and event ID so retries do not create a second outcome.
7. VERIFY with a minimal reproduction and source reference.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Trace the parameter with browser devtools, server logs that redact values, and
unit or integration fixtures. Compare query keys, storage-key presence, form
field presence, and server record schema.

### Option B: Turnkey ClickTrail implementation

Use `@vizuh/clicktrail-verify` for a synthetic browser trace and ClickTrail's
allowlisted capture contract. Use `@vizuh/clicktrail-mcp` only to inspect and
explain the resulting evidence; it does not prove provider delivery.

## Failure Modes & Debugging Checks

- Redirect drops the query string.
- Consent prevents expected persistence.
- SPA navigation overwrites the URL state.
- Cross-domain handoff has no signed linker.
- Form field is not registered or is renamed.
- CRM mapping strips the field.
- Click ID is present but the event ID is missing or reused.
