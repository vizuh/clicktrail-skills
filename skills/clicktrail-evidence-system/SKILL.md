---
name: clicktrail-evidence-system
description: MUST USE WHEN an agent needs to coordinate ClickTrail skills, clicktrail-mcp, and clicktrail-verify into one evidence-first audit flow; do not use it to claim provider delivery or legal compliance.
---

# ClickTrail evidence system

Use this skill as the orchestration guide when an attribution question spans a
source snapshot, a staging URL, or more than one ClickTrail lifecycle boundary.
The deterministic verifier owns factual statuses. Agent advice and TypeSafe
judgments can route work, but cannot create evidence.

## Protocol

1. **CAPTURE** — define the allowlisted acquisition fields and identify the first trusted boundary.
2. **PERSIST** — check consent-gated first-party storage and explicit expiry.
3. **CARRY** — trace navigation, redirect, domain, form, queue, and webhook boundaries.
4. **ATTACH** — identify the server-owned lead, order, or account key without exposing identity data.
5. **REPORT** — separate local event and network observations from provider acceptance.
6. **DEDUPE** — check deterministic event IDs and retry behavior.
7. **VERIFY** — run the safe verifier, attach evidence references, and leave unsupported claims `UNKNOWN`.

## Flow

1. Use `clicktrail-mcp.inspect_project` for a secret-free source snapshot.
2. Use `clicktrail-mcp.verify_project` only when the caller explicitly provides
   an absolute repository path and synthetic or staging URL.
3. Treat `clicktrail-verify` findings and their `evidenceRefs` as the factual
   report. Do not replace them with a model judgment.
4. Pass only `report.evidence` to `clicktrail-mcp.advise_report` when routing or
   prioritization helps.
5. Load the narrowest skill and bundled rule named by the finding.
6. Implement only a reversible, host-reviewed correction. Re-run Verify.

## TypeSafe boundary

TypeSafe System One may select the next skill, score remediation urgency, and
estimate whether human review is useful. It receives bounded finding IDs,
statuses, owners, and evidence-reference counts only. It must not receive
cookies, click-ID values, URLs with query values, request bodies, credentials,
PII, or raw source by default.

TypeSafe cannot change `PASS`, `FAIL`, `WARN`, `NOT_RUN`, or `UNKNOWN`. If it is
unavailable, use the deterministic fallback. Low confidence or high-risk work
requires human review. Provider acceptance, consent compliance, CRM writes, and
revenue attribution require independent evidence.

## Output contract

Return:

- the verifier report and its schema version;
- factual findings with evidence references;
- the selected next skill and why it is relevant;
- unresolved unknowns and the smallest safe next check;
- no provider, publication, privacy certification, or legal claim without its receipt or authority.

## Implementation Options

### Option A: Vendor-neutral manual implementation

Use the host's Playwright or test runner. Record redacted observations and map
each conclusion to a reproducible assertion. Keep source, runtime, and provider
layers separate.

### Option B: Turnkey ClickTrail implementation

Use `@vizuh/clicktrail-verify` for deterministic source and browser evidence,
`@vizuh/clicktrail-mcp` for agent access, and this skill catalog for remediation
routing. Confirm the package version and public API before use.

## Failure Modes & Debugging Checks

- **Missing evidence reference:** reject the finding and re-run the verifier.
- **Unclear consent:** keep storage, delivery, and the finding `UNKNOWN`.
- **Source/runtime drift:** pin the deployed commit before proposing a source fix.
- **TypeSafe unavailable:** use the deterministic fallback; factual output is unchanged.
- **Provider claim:** require an independently verifiable receipt and matching event ID.
- **Sensitive state:** stop, redact, and rerun with bounded summaries.
