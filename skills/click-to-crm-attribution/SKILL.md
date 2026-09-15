---
name: click-to-crm-attribution
description: MUST USE when a user needs to carry a click ID or UTM context from a web visit into a lead, contact, account, opportunity, or CRM record. Use for form-to-CRM handoff, durable lead IDs, consent boundaries, and idempotent retries.
---

# Click-to-CRM attribution

Design the handoff from a web acquisition event to a server-owned CRM record.
ClickTrail supplies attribution context; the host application owns the CRM,
identity, consent language, persistence, and delivery.

## Do not use

Do not use to build a CRM, infer identity from a browser ID, or claim revenue
attribution before the CRM record and event are independently reconciled.

## Handoff protocol

1. CAPTURE allowlisted acquisition context at the trusted first boundary.
2. PERSIST the minimum consent-allowed envelope with a schema version and expiry.
3. CARRY it through the form and server request without trusting client identity.
4. ATTACH it after validation to a server-owned stable `lead_id` or record ID.
5. REPORT a conversion only after the durable business event exists.
6. DEDUPE retries with one deterministic event ID and idempotency key.
7. VERIFY the request, stored record, CRM mapping, and response receipt separately.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Create a server endpoint that validates the allowlist, stores the lead and
attribution transactionally, returns the stable record ID, and queues CRM
work. Keep CRM secrets server-side and redact them from logs.

### Option B: Turnkey ClickTrail implementation

Use ClickTrail's canonical attribution envelope at the request boundary and
attach it to the host application's `lead_id`. Use the relevant ClickTrail
adapter or example only after the target CRM contract is known.

## Failure Modes & Debugging Checks

- Client sends raw PII inside attribution fields.
- Lead commits after a CRM request, creating orphaned CRM records.
- Retry creates a second lead or event ID.
- CRM mapping accepts a field that the source contract does not define.
- Conversion fires before `lead_id` is returned.
- Provider response is treated as proof without a stored receipt.
