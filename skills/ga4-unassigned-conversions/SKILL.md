---
name: ga4-unassigned-conversions
description: MUST USE when GA4 shows purchases or key events as Unassigned, (not set), or in a session with no source, or when Google Ads conversions imported from GA4 stay at 0 while GA4 records purchases. Covers Measurement Protocol session joins, GA4 cookie parsing (GS1/GS2), reserved field overrides in GTM, payment-return referrals, transaction ID joins, the GA4-to-Ads import, and inflated page_view counts. Do not use for direct click-ID uploads to Google Ads (use google-ads-offline-conversions).
---

# GA4 Unassigned conversions

Diagnose the most common GA4 attribution complaint: **purchases appear in GA4,
but under Unassigned or `(not set)`, and Google Ads (importing those key events
from GA4) shows 0 conversions.** The causes are mechanical. They sit across the
browser, the tag manager, the server, and GA4 Admin, so no single report shows
them. Work through the checks in order: each one is read-only first, then
names the fix.

Never invent a `client_id`, `session_id`, or transaction ID to make a join
succeed. A wrong ID is worse than a missing one: it creates a new session with
no source instead of falling back.

## Do not use

- Uploading offline conversions to Google Ads with `gclid`/`gbraid`/`wbraid` →
  `google-ads-offline-conversions`.
- Counts that disagree between CRM, checkout, and ad platforms without a GA4
  session symptom → `conversion-reconciliation`.
- A click ID or UTM lost before checkout → `click-id-debugging`.
- Attribution across your own domains (not a hosted payment page) →
  `cross-domain-attribution`.

## Symptom fingerprint

Use this skill when one or more of these hold:

- GA4 › Reports › Acquisition shows `purchase` revenue under **Unassigned**,
  `(not set)`, or a payment processor (`checkout.<processor>.com / referral`,
  sometimes grouped as **Organic Shopping**).
- `begin_checkout` is attributed to a real channel, but `purchase` for the same
  user is not.
- Google Ads conversion actions sourced from GA4 report 0 while GA4 shows
  purchases from users who clicked an ad.
- Sessions with events but no `session_start`, or roughly 2–3× more
  `page_view` events than real navigations.

---

## The Canonical 7-Step Protocol

Map the GA4 session join onto the shared ClickTrail lifecycle:

1. **CAPTURE** — Read the browser's GA4 identifiers at checkout start: the
   `client_id` from `_ga` and the numeric session ID from the property's own
   `_ga_<STREAM_ID>` cookie (GS1 or GS2 format), only under analytics consent.
2. **PERSIST** — Store `ga_client_id`, `ga_session_id`, `checkout_started_at`,
   the consent state, and the canonical transaction ID on the server-owned
   order or checkout record. Do not rely on the payment processor to carry them.
3. **CARRY** — Keep the record attached through the hosted payment page,
   webhooks, retries, and delayed payment methods (bank transfer, instant
   payment schemes, vouchers) that confirm minutes to days later.
4. **ATTACH** — When payment is confirmed, load the stored identifiers by
   transaction ID. Never read GA cookies from the webhook request; it does not
   come from the buyer's browser.
5. **REPORT** — Send one Measurement Protocol `purchase` with the stored
   `client_id`, `session_id`, a `timestamp_micros` inside that session,
   `engagement_time_msec ≥ 1`, and the stored consent.
6. **DEDUPE** — Use one transaction ID for `begin_checkout`, `purchase`,
   refunds, and ad-platform uploads. Send `purchase` from one path only
   (server or return page), or deduplicate on the transaction ID.
7. **VERIFY** — Use the BigQuery template below to confirm `begin_checkout` and
   `purchase` share `user_pseudo_id`, `ga_session_id`, and a non-null session
   source, then confirm the import on the Google Ads side.

---

## Ordered checks

Most likely first. Run the read-only check before changing anything, and record
the result as `PASS`, `FAIL`, or `UNKNOWN`.

### 1. Server event without the browser session

- **Symptom**: `purchase` sent by the server (Measurement Protocol) lands in a
  new session whose source is `(not set)`; `begin_checkout` for the same user
  sits in a sourced session.
- **Causes**:
  - The MP request has no `events[].params.session_id`. GA4 cannot join it to
    any browser session and starts a source-less one.
  - `client_id` is not the browser's `_ga` client ID (generated server-side,
    hashed, taken from a user table), so the purchase belongs to a different
    `user_pseudo_id`.
  - `timestamp_micros` is the payment confirmation time, which for delayed
    payments falls after the session ended (default timeout 30 minutes of
    inactivity).
- **Read-only check**: run the BigQuery template; verdicts `NO_CHECKOUT_FOR_USER`,
  `PURCHASE_WITHOUT_SESSION_ID`, and `SAME_SESSION_UNATTRIBUTED` point here.
  In code, find the MP sender (`grep -rn "mp/collect"`) and confirm where
  `client_id`, `session_id`, and `timestamp_micros` come from.
- **Fix**: capture the identifiers at checkout start (protocol steps 1–2) and
  send them with the purchase. When the payment confirms more than one session
  timeout after `checkout_started_at`, set `timestamp_micros` to
  `checkout_started_at + 1 s` so the event falls inside the original session;
  this moves the purchase's reporting date to checkout start, so document the
  trade-off. GA4 accepts `timestamp_micros` up to 72 hours in the past; beyond
  that, send without session attribution by explicit choice or skip. Always
  include `engagement_time_msec: 1` or higher. Validate payload shape with
  `/debug/mp/collect`, which checks schema only, not the session join.

### 2. GA4 cookie parser

- **Symptom**: the stored `ga_session_id` is empty, or differs from the `sid`
  the browser sends to the same property.
- **Causes**:
  - The parser only understands GS1 (`GS1.1.<session_id>.<session_number>...`)
    and fails on GS2 (`GS2.1.s<session_id>$o<session_number>$g...$t...`),
    which Google rolled out from mid-2025.
  - The parser reads the first `_ga_*` cookie instead of the one for the
    receiving property. Sites often carry several (a second stream, a widget
    or CMS tag, a leftover property).
  - A fallback takes "any digits" from an unknown format and produces an ID
    GA4 never issued.
- **Read-only check**: in DevTools › Application › Cookies, list every `_ga_*`
  cookie. The receiving property's cookie is `_ga_` + the measurement ID
  without `G-` (synthetic example: `G-EXAMPLE123` → `_ga_EXAMPLE123`). Compare
  its session ID with the stored `ga_session_id` and with the `sid` parameter
  on that property's `/g/collect` requests.
- **Fix**: pin the parser to the property's cookie, support GS1 and GS2, and
  return nothing for unknown formats (see Option A).

### 3. Reserved field override in the tag manager

- **Symptom**: sessions without `session_start`, `sid` changing between hits
  of one visit, `begin_checkout` itself in `(not set)`.
- **Cause**: a GA4 Event tag sends a parameter named `session_id`,
  `client_id`, `session_number`, `engagement_time_msec`, or `timestamp_micros`
  with a first-party value (for example a dataLayer UUID mapped by a catch-all
  tag). The Google tag treats `session_id` as a field (`sid`), not an event
  parameter: the first-party value replaces GA4's session and can be written
  back into `_ga_<STREAM_ID>`. `user_id` must be a real authenticated user ID,
  never an anonymous visitor ID.
- **Read-only check**: GTM Preview / Tag Assistant, one visit, three pages.
  `sid` must be identical on every `/g/collect` hit and equal the session ID
  in the property's `_ga_<STREAM_ID>` cookie. In the GTM container, list GA4
  Event tag parameters and Google tag configuration fields; flag any reserved
  name above.
- **Fix**: rename the dataLayer field (for example `ct_session_id`) or stop
  mapping it. Keep custom identifiers as clearly prefixed event parameters.

### 4. Payment return referral

- **Symptom**: purchases attributed to the payment processor
  (`checkout.<processor>.com / referral`, sometimes Organic Shopping) or to
  Direct, mostly for buyers who took a long time to pay.
- **Cause**: the hosted checkout domain is not in GA4's unwanted referrals.
  A buyer who returns from it starts a new session credited to the processor,
  and a return after the session timeout always starts a new session.
  Cross-domain linking does not apply: you cannot install your tag on a
  processor's hosted checkout page.
- **Read-only check**: GA4 Admin › Data streams › (web stream) › Configure tag
  settings › List unwanted referrals. In BigQuery, inspect `page_referrer` on
  the return-page events (the template returns it).
- **Fix**: add the processor hosts you use (for example `stripe.com`,
  `paypal.com`, `mercadopago.com`, plus country domains) to unwanted
  referrals. This stops the processor from becoming a source; it does not stop
  the new session after a timeout. For that, send the authoritative `purchase`
  from the server per check 1, and do not also fire it on the return page.
  A ClickTrail referrer ignore list affects ClickTrail's own `lt_*` fields
  only, not GA4's session attribution.

### 5. Transaction ID mismatch

- **Symptom**: funnel exploration shows checkouts and purchases that never
  join; deduplication across browser and server fails; refunds miss.
- **Cause**: `begin_checkout` carries one ID (for example the checkout session
  ID) and `purchase` another (an invoice or payment ID the browser never knew).
- **Read-only check**: the template's `checkout_transaction_id` and
  `purchase_transaction_id` columns; verdict `TRANSACTION_ID_MISMATCH`.
- **Fix**: choose one ID that exists in the browser, the payment webhook, and
  the database before payment. Use it for `begin_checkout`, `purchase`,
  `refund`, and every ad-platform upload.

### 6. Google Ads side

- **Symptom**: GA4 attributes purchases correctly, but the Google Ads
  conversion action stays at 0 or far below GA4.
- **Causes and read-only checks**:
  - GA4 shares only key events it credits to Google Ads. If checks 1–5 leave
    purchases Unassigned, Ads stays at 0: fix those first.
  - GA4 Admin › Product links › Google Ads: link present, auto-tagging on in
    Google Ads, `purchase` marked as a key event.
  - Google Ads › Goals › Conversions: the action's source is
    "Google Analytics (GA4)". A "Website" action needs a Google Ads tag
    (`AW-…`) on the site; with no tag it never records.
  - The action is **Primary** if bidding should use it; Secondary actions
    report only in "All conversions".
  - Consent Mode: with `ad_user_data` denied, GA4 does not share those
    conversions with Google Ads. Compare against the consent rate.
  - Allow the documented processing delay before concluding.
- **Fix**: correct the link, action source, Primary/Secondary flag, or consent
  wiring. Do not add a parallel upload path to hide an Unassigned problem;
  that double counts once GA4 is fixed.

### 7. Inflated `page_view`

- **Symptom**: about 2–3× `page_view` per real navigation.
- **Cause**: the Google tag's automatic `page_view` (and history-change page
  views in SPAs) plus a dataLayer event named `page_view` forwarded by a
  catch-all GA4 Event tag.
- **Read-only check**: Tag Assistant on one navigation (count `en=page_view`
  hits), or the session integrity query below.
- **Fix**: exclude `page_view` from catch-all triggers, rename the dataLayer
  event, or disable one of the sources. This does not cause Unassigned, but it
  corrupts the denominators used while debugging, so fix it early.

---

## BigQuery query template

Requires the GA4 BigQuery export. Replace the synthetic project, dataset, and
date suffixes. Results contain pseudonymous identifiers: keep them out of
tickets, commits, and public issues.

### Query 1: checkout and purchase rows per user

```sql
-- Synthetic placeholders: example-project.analytics_000000000, dates.
WITH checkout_events AS (
  SELECT
    user_pseudo_id,
    event_name,
    TIMESTAMP_MICROS(event_timestamp) AS event_at,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
       FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
    COALESCE(
      NULLIF(ecommerce.transaction_id, '(not set)'),
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'transaction_id')
    ) AS transaction_id,
    session_traffic_source_last_click.cross_channel_campaign.source AS session_source,
    session_traffic_source_last_click.cross_channel_campaign.medium AS session_medium,
    session_traffic_source_last_click.cross_channel_campaign.campaign_name AS session_campaign,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_referrer') AS page_referrer
  FROM `example-project.analytics_000000000.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20260101' AND '20260107'
    AND event_name IN ('begin_checkout', 'purchase')
)
SELECT
  user_pseudo_id,
  event_name,
  event_at,
  ga_session_id,
  CONCAT(IFNULL(session_source, '(null)'), ' / ', IFNULL(session_medium, '(null)')) AS session_source_medium,
  session_campaign,
  transaction_id,
  page_referrer
FROM checkout_events
WHERE user_pseudo_id IN (
  SELECT user_pseudo_id FROM checkout_events WHERE event_name = 'purchase'
)
ORDER BY user_pseudo_id, event_at;
```

Read it user by user. A healthy purchase shares `user_pseudo_id` and
`ga_session_id` with the preceding `begin_checkout`, and both rows show the
same real source/medium.

### Query 2: one verdict per purchase

```sql
WITH checkout_events AS (
  -- Same CTE as Query 1.
  SELECT
    user_pseudo_id,
    event_name,
    TIMESTAMP_MICROS(event_timestamp) AS event_at,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
       FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
    COALESCE(
      NULLIF(ecommerce.transaction_id, '(not set)'),
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'transaction_id')
    ) AS transaction_id,
    session_traffic_source_last_click.cross_channel_campaign.source AS session_source,
    session_traffic_source_last_click.cross_channel_campaign.medium AS session_medium,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_referrer') AS page_referrer
  FROM `example-project.analytics_000000000.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20260101' AND '20260107'
    AND event_name IN ('begin_checkout', 'purchase')
),
purchases AS (SELECT * FROM checkout_events WHERE event_name = 'purchase'),
checkouts AS (SELECT * FROM checkout_events WHERE event_name = 'begin_checkout'),
paired AS (
  SELECT
    p.user_pseudo_id,
    p.event_at AS purchase_at,
    c.event_at AS checkout_at,
    c.ga_session_id AS checkout_session_id,
    p.ga_session_id AS purchase_session_id,
    c.session_source AS checkout_source,
    c.session_medium AS checkout_medium,
    p.session_source AS purchase_source,
    p.session_medium AS purchase_medium,
    c.transaction_id AS checkout_transaction_id,
    p.transaction_id AS purchase_transaction_id,
    p.page_referrer AS purchase_page_referrer
  FROM purchases AS p
  LEFT JOIN checkouts AS c
    ON c.user_pseudo_id = p.user_pseudo_id AND c.event_at <= p.event_at
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY p.user_pseudo_id, p.event_at ORDER BY c.event_at DESC
  ) = 1
)
SELECT
  *,
  TIMESTAMP_DIFF(purchase_at, checkout_at, MINUTE) AS minutes_checkout_to_purchase,
  CASE
    WHEN checkout_at IS NULL THEN 'NO_CHECKOUT_FOR_USER'
    WHEN purchase_session_id IS NULL THEN 'PURCHASE_WITHOUT_SESSION_ID'
    WHEN purchase_session_id != checkout_session_id
      AND (purchase_source IS NULL OR purchase_source IN ('(not set)', '(direct)'))
      THEN 'NEW_UNATTRIBUTED_SESSION'
    WHEN purchase_session_id != checkout_session_id
      THEN 'NEW_SESSION_OTHER_SOURCE'
    WHEN purchase_source IS NULL OR purchase_source = '(not set)'
      THEN 'SAME_SESSION_UNATTRIBUTED'
    WHEN checkout_transaction_id IS NULL
      OR purchase_transaction_id IS NULL
      OR checkout_transaction_id != purchase_transaction_id
      THEN 'TRANSACTION_ID_MISMATCH'
    ELSE 'JOINED'
  END AS verdict
FROM paired
ORDER BY verdict, purchase_at;
```

### Query 3: session integrity (checks 3 and 7)

```sql
WITH events AS (
  SELECT
    user_pseudo_id,
    event_name,
    event_timestamp,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
       FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location
  FROM `example-project.analytics_000000000.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20260101' AND '20260107'
)
SELECT
  COUNT(*) AS sessions,
  COUNTIF(session_starts = 0) AS sessions_without_session_start,
  SUM(page_views) AS page_views,
  SUM(distinct_page_view_seconds) AS distinct_page_view_seconds,
  SAFE_DIVIDE(SUM(page_views), SUM(distinct_page_view_seconds)) AS page_view_multiplier
FROM (
  SELECT
    user_pseudo_id,
    ga_session_id,
    COUNTIF(event_name = 'session_start') AS session_starts,
    COUNTIF(event_name = 'page_view') AS page_views,
    COUNT(DISTINCT IF(event_name = 'page_view',
      CONCAT(IFNULL(page_location, ''), '|', CAST(DIV(event_timestamp, 1000000) AS STRING)),
      NULL)) AS distinct_page_view_seconds
  FROM events
  WHERE ga_session_id IS NOT NULL
  GROUP BY user_pseudo_id, ga_session_id
);
```

A `page_view_multiplier` well above 1 means the same page is counted more than
once per second (check 7). Many `sessions_without_session_start` point to an
overridden or invented session ID (checks 1 and 3).

### Decision tree

```text
Query 2 verdict
├── NO_CHECKOUT_FOR_USER
│   ├── begin_checkout fires in Tag Assistant? no → fix the browser event first
│   └── yes → purchase uses a different client_id → check 1 (client_id source)
├── PURCHASE_WITHOUT_SESSION_ID
│   ├── stored ga_session_id empty? yes → check 2 (GS2 / property pinning)
│   └── no → MP sender drops session_id → check 1
├── NEW_UNATTRIBUTED_SESSION
│   ├── purchase_session_id matches no browser session for this user
│   │   → invented or wrong-property ID → checks 2 and 3
│   └── purchase came from the return page after a long payment → check 4, then move purchase to the server (check 1)
├── NEW_SESSION_OTHER_SOURCE
│   ├── source is the payment host, or page_referrer is a checkout domain → check 4
│   └── otherwise a later real visit; inspect that session before changing code
├── SAME_SESSION_UNATTRIBUTED
│   ├── minutes_checkout_to_purchase > session timeout → timestamp outside session → check 1
│   └── begin_checkout also (null)/(not set) → session broken in the browser → check 3
├── TRANSACTION_ID_MISMATCH → check 5
└── JOINED, but Google Ads still 0 → check 6
Always: Query 3 multiplier > ~1.5 → check 7 before trusting rates.
```

---

## Implementation Options

### Option A: Vendor-Neutral Manual Implementation

#### Read the GA4 session for one property

```javascript
/**
 * Returns { clientId, sessionId, sessionNumber } for ONE GA4 property, or null.
 * measurementId is the receiving web stream's ID (synthetic: 'G-EXAMPLE123').
 * Unknown formats return null: a wrong session ID splits the session.
 */
export function readGa4Identifiers(cookieHeader, measurementId) {
  const cookies = {};
  for (const pair of cookieHeader.split(/;\s*/)) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    try {
      cookies[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    } catch {
      // Malformed encoding: ignore this cookie rather than guess.
    }
  }

  // _ga = GA1.1.<random>.<first_seen>  →  client_id = last two parts
  const gaParts = (cookies._ga ?? '').split('.');
  const clientId = gaParts.length >= 4 ? gaParts.slice(-2).join('.') : null;

  const value = cookies[`_ga_${measurementId.replace(/^G-/, '')}`] ?? '';
  let sessionId = null;
  let sessionNumber = null;

  if (value.startsWith('GS2.')) {
    // GS2.1.s1767225600$o3$g1$t1767225900$j0$l0$h0
    const tokens = value.split('.').slice(2).join('.').split('$');
    sessionId = tokens.find((t) => /^s\d+$/.test(t))?.slice(1) ?? null;
    sessionNumber = tokens.find((t) => /^o\d+$/.test(t))?.slice(1) ?? null;
  } else if (value.startsWith('GS1.')) {
    // GS1.1.1767225600.3.1.1767225900.0.0.0
    const [, , sid, num] = value.split('.');
    sessionId = /^\d+$/.test(sid ?? '') ? sid : null;
    sessionNumber = /^\d+$/.test(num ?? '') ? num : null;
  }

  return clientId ? { clientId, sessionId, sessionNumber } : null;
}
```

Call it at checkout start (browser or the first-party request that creates
the checkout) and persist the result with the order. Never call it from a
payment webhook.

#### Measurement Protocol `purchase` that joins the session

```javascript
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // match the property's session timeout
const MAX_BACKDATE_MS = 72 * 60 * 60 * 1000;

export function buildGa4Purchase(order, now = Date.now()) {
  if (!order.gaClientId) return { skip: 'missing_client_id' };

  const paidAt = order.paidAt.getTime();
  const startedAt = order.checkoutStartedAt.getTime();
  const eventAt = paidAt - startedAt > SESSION_TIMEOUT_MS ? startedAt + 1000 : paidAt;
  if (now - eventAt > MAX_BACKDATE_MS) return { skip: 'too_late' };

  return {
    payload: {
      client_id: order.gaClientId,
      timestamp_micros: eventAt * 1000,
      consent: {
        ad_user_data: order.consent.adUserData ? 'GRANTED' : 'DENIED',
        ad_personalization: order.consent.adPersonalization ? 'GRANTED' : 'DENIED'
      },
      events: [{
        name: 'purchase',
        params: {
          ...(order.gaSessionId ? { session_id: order.gaSessionId } : {}),
          engagement_time_msec: 1,
          transaction_id: order.transactionId, // same ID as begin_checkout
          value: order.value,
          currency: order.currency,
          items: order.items
        }
      }]
    }
  };
}

// POST JSON to https://www.google-analytics.com/mp/collect
//   ?measurement_id=<web stream ID>&api_secret=<server-side secret>
// Send only after the processor confirms payment (for example a paid
// checkout-completed event or an async-payment-succeeded event).
```

#### Tag manager and GA4 Admin

- Rename or unmap dataLayer keys that collide with Google tag fields
  (`session_id`, `client_id`, `session_number`, `engagement_time_msec`,
  `timestamp_micros`) before any GA4 Event tag reads them.
- Exclude `page_view` from catch-all GA4 Event triggers.
- Add hosted payment domains to GA4 unwanted referrals.

### Option B: Turnkey ClickTrail Implementation

ClickTrail's browser adapter (`@vizuh/clicktrail-browser`) already captures
`ga_client_id`, `ga_session_id`, and `ga_session_number` from GA cookies behind
the consent gate (GS1 and GS2). Read them at checkout start and persist them
with the order:

```typescript
import { createClickTrail, dataLayerDestination } from '@vizuh/clicktrail-browser';

const clickTrail = createClickTrail({
  destinations: [dataLayerDestination()],
  consentGate: () => consentManager.analytics === true,
  storage: {},
});
clickTrail.start();

// At checkout start, send these to the server with the checkout request.
const gaIdentifiers = {
  gaClientId: clickTrail.getField('ga_client_id'),
  gaSessionId: clickTrail.getField('ga_session_id'),
};
```

Confirm the installed package version and public API in its README first.
Known gaps being addressed in `vizuh/clicktrail-js`, each with its own issue:
pinning `ga_session_id` to one GA4 property (#47), prefixing dataLayer fields
that collide with Google tag fields and the `page_view` duplicate (#48), a GA4
Measurement Protocol builder for delayed payments (#49), and ignoring payment
referrers in ClickTrail's own last touch (#43). Until a release ships one of
these, apply the matching Option A rule. Use `@vizuh/clicktrail-verify` for a
synthetic browser trace; it records local evidence and does not prove GA4 or
Google Ads acceptance.

---

## Failure Modes & Debugging Checks

- **MP purchase in a new `(not set)` session:** `session_id` missing, wrong,
  or `timestamp_micros` after the session ended → check 1.
- **Stored session ID empty or from another property:** GS1-only parser or
  unpinned `_ga_*` cookie → check 2.
- **`sid` changes within one visit:** reserved field mapped in GTM → check 3.
- **Revenue credited to a processor or Organic Shopping:** missing unwanted
  referral, late return → check 4.
- **Funnel never joins:** different IDs on `begin_checkout` and `purchase` →
  check 5.
- **GA4 correct, Ads 0:** link, action source, Primary flag, or consent →
  check 6.
- **2–3× page views:** catch-all tag forwards a dataLayer `page_view` → check 7.
- **`/debug/mp/collect` returns no errors but nothing joins:** the debug
  endpoint validates schema only; use the BigQuery template.

## Output contract

Return one status per check (`PASS`, `FAIL`, `UNKNOWN`), the Query 2 verdict
counts, the evidence used (Tag Assistant hit, cookie name, query row count,
source file), and the smallest safe fix. Redact client IDs, session IDs,
transaction IDs, measurement IDs, API secrets, and revenue before sharing
outside the property owners.

## Chaining

Use `google-ads-offline-conversions` when the fix is a direct click-ID upload
to Google Ads, `conversion-reconciliation` to compare checkout, CRM, and
destination counts, `cross-domain-attribution` for domains you control, and
`attribution-debugging` when the failure also spans CRM or forms.
