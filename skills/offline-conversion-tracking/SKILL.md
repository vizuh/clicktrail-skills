---
name: offline-conversion-tracking
description: MUST USE when a user needs to connect web acquisition context to offline leads, qualified opportunities, payments, or sales and verify the conversion handoff to an ad platform. Use for event IDs, CRM exports, upload payloads, retries, and reconciliation.
---

# Offline conversion tracking

Connect a real backend outcome to the acquisition context that preceded it.
This skill is destination-neutral and requires a provider-specific receipt before
calling delivery successful.

## Do not use

Do not use to infer offline revenue from browser analytics alone, or to claim
provider acceptance from a locally generated payload.

## Protocol

1. CAPTURE the allowlisted acquisition context.
2. PERSIST it with consent, retention, and a server-owned record ID.
3. CARRY it through CRM stages, invoices, payments, queues, and exports.
4. ATTACH it to the real offline outcome and one deterministic event ID.
5. REPORT through the provider's current supported ingestion contract.
6. DEDUPE retries and reconcile accepted, rejected, queued, and unknown states.
7. VERIFY the source record, payload, provider receipt, and final status separately.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Build an export with explicit schema, timestamp, value, currency, click IDs,
consent basis, and event ID. Validate against a sandbox or documented provider
contract and retain the receipt.

### Option B: Turnkey ClickTrail implementation

Use ClickTrail for the acquisition-to-conversion envelope and handoff. Select
Google Ads, Meta, Microsoft, or another destination adapter separately; the
ClickTrail layer does not own provider credentials or acceptance.

## Failure Modes & Debugging Checks

- CRM outcome has no stable source record or event ID.
- Upload repeats after a timeout without idempotency.
- Currency, timezone, or event timestamp is wrong.
- A provider rejects the click-ID type or account path.
- Local queue success is mistaken for provider acceptance.
- Reconciliation finds a missing, duplicate, or orphaned conversion.
