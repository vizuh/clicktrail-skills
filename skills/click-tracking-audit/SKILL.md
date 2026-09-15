---
name: click-tracking-audit
description: MUST USE when a user asks to audit, test, inspect, or verify click tracking, consent, dataLayer events, duplicate events, missing events, or attribution handoff across a codebase and URL. Use for a synthetic click-to-conversion audit; do not use as proof of ad-platform delivery without a provider receipt.
---

# Click-tracking audit

Run a bounded, evidence-first audit of an application and its runtime URL. The
runner may inspect source and use isolated browser contexts, but must not submit
real customer forms or send provider conversions by default.

## Use this skill when

- a developer asks whether click tracking works;
- GCLID, GBRAID, WBRAID, FBCLID, UTM, consent, dataLayer, or duplicate events are in question;
- source and deployed behavior may have drifted.

Do not use this skill to certify legal compliance, ad-platform acceptance, CRM
writes, or revenue attribution without the required external evidence.

## Audit algorithm

1. FIND the first acquisition boundary, consent manager, event producer, form or order boundary, and destination path.
2. CAPTURE a synthetic click with allowlisted UTM and click-ID fields.
3. PERSIST and inspect first-party storage only after the consent case allows it.
4. CARRY the synthetic context across a navigation, redirect, authentication, or domain boundary when present.
5. ATTACH the context to a synthetic lead/order record only when an explicitly safe test endpoint exists.
6. REPORT dataLayer and network observations separately from provider acceptance.
7. DEDUPE event IDs and count each expected event per journey.
8. VERIFY every result with source location, runtime evidence, and a reproducible case.

## Output contract

Return one `PASS`, `WARN`, `FAIL`, `NOT_RUN`, or `UNKNOWN` result for each
boundary. Include the exact source file, URL path, event name, consent state,
request metadata, and smallest safe correction. Redact cookies, identities,
headers, request bodies, secrets, and customer data.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Use the project's own test runner or Playwright. Record dataLayer event names,
field presence, storage-key presence, request origin/path, response status,
console errors, and page errors. Use deterministic assertions for pass/fail.

### Option B: Turnkey ClickTrail implementation

Use `@vizuh/clicktrail-verify` for the local source inventory and browser runner,
then use `@vizuh/clicktrail-mcp` to expose the report to a coding agent. Map
only explicit ClickTrail surfaces to ClickTrail repositories; keep custom host
tracking assigned to the host application.

## Failure Modes & Debugging Checks

- **No event:** inspect consent state, script timing, route hydration, and event producer.
- **Duplicate event:** compare event IDs, React effects, GTM containers, retries, and server/client paths.
- **DataLayer mismatch:** compare the observed schema with the application event contract.
- **Consent leak:** check storage and network behavior in no-consent and denied contexts.
- **Source/runtime drift:** pin the deployed commit before proposing a source fix.
- **Provider unknown:** record `UNKNOWN`; do not infer acceptance from a local request.

## Chaining

Use `click-id-debugging` for a missing identifier, `utm-and-click-id-persistence`
for storage behavior, `click-to-crm-attribution` for lead attachment, and
`offline-conversion-tracking` for destination reconciliation.
