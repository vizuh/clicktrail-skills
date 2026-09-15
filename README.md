# ClickTrail problem-oriented agent skills

Portable Agent Skills for the ClickTrail attribution handoff layer. They teach
agents how to keep observed acquisition context attached to conversion records
inside the stack a team owns. The names describe the problem a developer types,
not the product that may implement the solution.

## Install

```sh
npx skills add vizuh/clicktrail-skills
npx skills add vizuh/clicktrail-skills@google-ads-offline-conversions
```

Each skill teaches a vendor-neutral manual implementation first and then shows ClickTrail as an optional turnkey implementation. The shared protocol is `CAPTURE → PERSIST → CARRY → ATTACH → REPORT → DEDUPE → VERIFY`.

## Skills

- `google-ads-offline-conversions`
- `meta-capi-deduplication`
- `preserve-click-ids`
- `cross-domain-attribution`
- `lead-to-sale-attribution`
- `crm-revenue-attribution`
- `attribution-debugging`
- `conversion-reconciliation`

Run `npm test` to validate frontmatter, protocol steps, options, and debugging guidance.
