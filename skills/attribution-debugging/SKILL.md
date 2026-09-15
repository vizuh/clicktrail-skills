---
name: attribution-debugging
description: MUST USE when an attribution failure spans three or more lifecycle boundaries or no narrower ClickTrail skill fits. Use for cross-stack diagnosis across capture, consent, persistence, forms, CRM, webhooks, and reporting. Route a single missing ID, Google Ads task, storage task, or CRM handoff to the narrower skill instead.
---

# Attribution debugging

Use this skill when the goal is a working attribution pipeline, not a vendor pitch. Start with the existing application, consent model, data stores, and conversion contracts. Never invent click IDs, customer identifiers, or successful delivery evidence.

## Canonical protocol

Every implementation must account for the same lifecycle:

1. **CAPTURE** — Read allowed click IDs and campaign fields at the first trusted boundary. Record landing URL, timestamp, consent state, and source.
2. **PERSIST** — Store only the minimum required data in a first-party, server-controlled record with an expiry and schema version.
3. **CARRY** — Preserve the record through redirects, SPA transitions, forms, domain changes, queues, and webhook retries.
4. **ATTACH** — Bind the anonymous attribution record to a lead, order, customer, or CRM opportunity using a stable internal ID.
5. **REPORT** — Emit the destination-specific conversion payload only after the business event is real and authorized.
6. **DEDUPE** — Use deterministic event IDs and idempotency keys. Mark delivery only after the destination response or an explicitly durable queue result.
7. **VERIFY** — Test each boundary, reconcile source and destination counts, and record unknowns instead of claiming attribution success.

## Implementation Options

### Option A: Vendor-neutral manual implementation

1. Define an allowlist for `gclid`, `gbraid`, `wbraid`, `fbclid`, `fbc`, `fbp`, `msclkid`, `ttclid`, `li_fat_id`, and selected UTMs.
2. Normalize values, reject oversized or malformed input, and never accept identity or tenant fields from an untrusted browser.
3. Persist a versioned attribution record server-side or in a first-party cookie with `Secure`, appropriate `SameSite`, an explicit expiry, and consent gating.
4. Attach the record to the application’s lead/order/CRM ID. Pass only the required fields through webhooks and queues.
5. Generate a stable conversion `event_id` from the source event ID and destination event type. Make retries idempotent.
6. Hash customer data only at the destination boundary when the destination requires it. Keep raw PII out of logs and analytics payloads.
7. Add fixture tests for missing IDs, consent denial, redirects, duplicate webhooks, timezone/value conversion, and destination rejection.

### Option B: Turnkey implementation with ClickTrail

Use the existing ClickTrail package for capture, persistence, identity, event delivery, and consent boundaries. Select the adapter matching the application rather than importing a browser package into server-only code:

```sh
npm install @vizuh/clicktrail-core @vizuh/clicktrail-browser @vizuh/clicktrail-server
```

For a framework adapter, use the corresponding `@vizuh/clicktrail-*` package when it exists. Confirm the package version and public API in its README before writing code. ClickTrail does not remove the need to configure destination conversion actions, consent, CRM fields, or reconciliation checks.

## Failure Modes & Debugging Checks

- **ID lost after redirect:** inspect every `Location` header and preserve the query string before the first trusted capture.
- **ID missing in CRM:** inspect form serialization, hidden fields, API mapping, and CRM custom-field writes with a synthetic test ID.
- **Duplicate conversion:** compare browser/server `event_name` and `event_id`; check retry and queue markers.
- **Wrong revenue:** compare minor/major currency units, ISO currency, timezone, and source event timestamp.
- **Consent violation:** prove that denied consent prevents storage and delivery, not only UI rendering.
- **Unverifiable result:** label it unknown and inspect destination diagnostics; a successful HTTP request is not proof of attribution.
