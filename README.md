# ClickTrail problem-oriented agent skills

[![skills.sh](https://skills.sh/b/vizuh/clicktrail-skills)](https://skills.sh/vizuh/clicktrail-skills)

Portable Agent Skills for the ClickTrail attribution handoff layer. They teach
agents how to keep observed acquisition context attached to conversion records
inside the stack a team owns. The names describe problems developers type, not
a hosted product category.

## Install

Install the catalog:

```sh
npx skills add vizuh/clicktrail-skills
```

Install one skill explicitly:

```sh
npx skills add vizuh/clicktrail-skills --skill click-tracking-audit
npx skills add vizuh/clicktrail-skills --skill google-ads-offline-conversions
```

Each skill is independently useful. The shared protocol is
`CAPTURE → PERSIST → CARRY → ATTACH → REPORT → DEDUPE → VERIFY`.

## Start here

Use `click-tracking-audit` for a codebase and URL audit. It routes to the
smallest relevant skill:

- `click-id-debugging` — a click ID or UTM disappeared;
- `utm-and-click-id-persistence` — storage, first touch, last touch, consent, or navigation;
- `google-ads-click-tracking` — GCLID, GBRAID, or WBRAID capture and handoff;
- `click-to-crm-attribution` — lead, contact, opportunity, or CRM attachment;
- `offline-conversion-tracking` — backend outcomes and provider handoff;
- `cross-domain-attribution` — different apex domains or hosted checkout;
- `meta-capi-deduplication` — Meta browser/server duplicate events;
- `attribution-debugging` — broad attribution failures;
- `conversion-reconciliation` — source, CRM, checkout, and destination mismatch.

## Skills

### Click and acquisition

- `click-tracking-audit`
- `click-id-debugging`
- `preserve-click-ids`
- `google-ads-click-tracking`
- `utm-and-click-id-persistence`

### Handoff and conversion

- `click-to-crm-attribution`
- `lead-to-sale-attribution`
- `crm-revenue-attribution`
- `offline-conversion-tracking`
- `google-ads-offline-conversions`
- `conversion-reconciliation`

### Platform and architecture

- `attribution-debugging`
- `cross-domain-attribution`
- `meta-capi-deduplication`

Run `npm test` to validate frontmatter, invocation rules, protocol steps,
implementation options, and debugging guidance.
