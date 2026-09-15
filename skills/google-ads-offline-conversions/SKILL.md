---
name: google-ads-offline-conversions
description: Upload offline conversion adjustments, qualified leads, and CRM revenue back to Google Ads via the Google Ads API using GCLID, GBRAID, WBRAID, and Enhanced Conversions for Leads with SHA-256 hashed user data.
---

# Google Ads Offline Conversions

Bridge the gap between online ad clicks and offline revenue. When deals close in your CRM, contracts are signed, or payments process in Stripe days or weeks later, upload conversion adjustments back to Google Ads to train Smart Bidding algorithms on real business value rather than raw form fills.

This skill solves the challenge of capturing and preserving Google click identifiers (`gclid`, `gbraid`, `wbraid`), associating them with customer leads, selecting the supported Google ingestion path, formatting conversion payloads, and diagnosing upload rejections.

## Current Google ingestion-path decision

Choose the destination before writing upload code:

- **Existing eligible implementation:** use Google Ads API **v25+** `ConversionUploadService.UploadClickConversions`. Google Ads API access levels are now associated with the Google Cloud project that owns the OAuth credentials. The `developer-token` header is optional and ignored after the September 9, 2026 sunset; do not make it a required configuration field.
- **New or restricted implementation:** use the **Google Ads Data Manager API** offline-events flow. Google Ads API `UploadClickConversions` remains restricted for tokens/projects covered by the historical no-prior-upload rule (no qualifying offline-upload requests between December 17, 2025 and June 15, 2026). If it returns `CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`, migrate to Data Manager.

Primary references: [developer-token migration](https://developers.google.com/google-ads/api/docs/api-policy/developer-token), [feature deprecations](https://developers.google.com/google-ads/api/docs/deprecations), [Data Manager offline events](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline).

---

## The Canonical 7-Step Protocol

Every robust offline conversion pipeline follows this 7-step deterministic protocol:

### 1. CAPTURE
Extract Google click identifiers and contact data immediately upon landing:
- `gclid`: Standard Google Click Identifier for desktop and non-iOS web traffic.
- `gbraid`: Google Click Identifier for app-to-web campaigns on iOS 14.5+.
- `wbraid`: Google Click Identifier for web campaigns on iOS 14.5+ with cross-site tracking restrictions.
- Normalized user attributes (email, phone number) for **Enhanced Conversions for Leads** (used as secondary match keys when click IDs are unavailable).

### 2. PERSIST
Store captured identifiers across storage mechanisms:
- First-party cookie with `Path=/; SameSite=Lax; Max-Age=7776000` (90 days, matching Google's maximum attribution window).
- `localStorage` mirror to survive browser cookie truncation (e.g., Apple Safari ITP capping script-writable cookies to 7 days or 24 hours on referring links with click IDs).
- Record initial capture timestamp (`first_seen_at`) to validate the 90-day expiration boundary prior to API upload.

### 3. CARRY
Propagate click parameters through the visitor's multi-page session:
- Maintain click IDs across internal link clicks and single-page application (SPA) client-side route changes.
- Automatically populate hidden inputs in all HTML `<form>` elements on the page (`gclid`, `gbraid`, `wbraid`, `user_id`).
- Pass identifiers across subdomains (`.example.com`) via wide-domain cookie configuration.

### 4. ATTACH
When the visitor submits a form or books a meeting:
- Extract hidden input values and attach `gclid`, `gbraid`, `wbraid`, and hashed contact info to the backend lead record or CRM contact (e.g., HubSpot contact, Salesforce Lead, PostgreSQL `users` table).
- Record `conversion_time` as the moment the lead was created or when the qualifying offline milestone was reached.

### 5. REPORT
When a qualification milestone or revenue event occurs (for example, a deal
marked "Closed Won", an SQL status, or a paid trial):

1. Select the provider path before dispatch:
   - Existing eligible project: Google Ads API **v25** `ConversionUploadService.UploadClickConversions`.
   - New or restricted project: Data Manager API `POST https://datamanager.googleapis.com/v1/events:ingest`.
2. For Google Ads API, send one click identifier per conversion and provide
   `conversionActionId`, `conversionDateTime` (timezone offset),
   `conversionValue`, `currencyCode`, and optional hashed user identifiers.
   Use OAuth scope `https://www.googleapis.com/auth/adwords`. The legacy
   `developer-token` header is optional and ignored after the September 9,
   2026 sunset; it is not a required secret.
3. For Data Manager, map the conversion action ID to the destination product
   field, use RFC3339 `eventTimestamp`, and send `gclid`/`gbraid`/`wbraid`
   under `event.adIdentifiers`. Use OAuth scope
   `https://www.googleapis.com/auth/datamanager`. Data Manager uses fast-fail,
   not Google Ads `partial_failure`.

Eligibility is independent of the API version. Since June 15, 2026, new
adopters or projects without qualifying prior offline-upload activity can
receive `CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE` from
`UploadClickConversions`; migrate those workflows to Data Manager.

### 6. DEDUPE
Prevent double counting on retries, webhook re-deliveries, or status adjustments:
- Provide an `order_id` (transaction ID / deal ID) as the idempotency key in the upload request.
- Google Ads evaluates `(gclid, conversion_action, order_id)` to deduplicate repeated uploads. For adjustments (e.g., value revision or refund), use `uploadConversionAdjustments`.

### 7. VERIFY
Validate upload success and match quality:
- For Google Ads API, enable `partial_failure: true` and inspect `response.partial_failure_error` or `ConversionUploadError` codes.
- For Data Manager, do not send `partial_failure`; its ingest request uses fast-fail semantics and returns a `requestId` on success.
- Audit the Google Ads UI under **Goals > Conversions > Uploads** to confirm upload status, matched conversions, and processing latency.

---

## Implementation Options

### Option A: Vendor-Neutral Manual Implementation

Zero-dependency implementation using standard Web APIs on the frontend and Node.js REST API calls on the backend.

#### Client-Side Capture & Form Attachment (Vanilla JavaScript)

```html
<!-- Place before closing </body> or in page <head> -->
<script>
(function() {
  const STORAGE_KEY = '_ct_gads_ids';
  const COOKIE_NAME = '_ct_gads';
  const PARAMS = ['gclid', 'gbraid', 'wbraid'];

  // 1. Capture query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const hasAdvertisingConsent = window.__CLICKTRAIL_CONSENT__?.advertising === true;
  const captured = {};
  let hasNewId = false;

  PARAMS.forEach(param => {
    const val = urlParams.get(param);
    if (val) {
      captured[param] = val;
      hasNewId = true;
    }
  });

  // 2. Read existing storage if no new params
  let currentData = {};
  try {
    const rawLocal = localStorage.getItem(STORAGE_KEY);
    if (rawLocal) currentData = JSON.parse(rawLocal);
  } catch (e) {}

  // First touch is write-once and persistence is disabled until consent.
  if (hasNewId && hasAdvertisingConsent && !currentData.capturedAt) {
    currentData = {
      ...currentData,
      ...captured,
      capturedAt: new Date().toISOString()
    };
    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentData));
    } catch (e) {}
    // Persist to 1st-party cookie (90-day expiry)
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(currentData))}; Path=/; Max-Age=7776000; SameSite=Lax`;
  }

  // 3. Attach to DOM forms on load
  function injectFormFields() {
    if (!hasAdvertisingConsent || (!currentData.gclid && !currentData.gbraid && !currentData.wbraid)) return;
    document.querySelectorAll('form').forEach(form => {
      PARAMS.forEach(param => {
        if (currentData[param]) {
          let input = form.querySelector(`input[name="${param}"]`);
          if (!input) {
            input = document.createElement('input');
            input.type = 'hidden';
            input.name = param;
            form.appendChild(input);
          }
          input.value = currentData[param];
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFormFields);
  } else {
    injectFormFields();
  }
})();
</script>
```

#### Backend Offline Conversion Upload (Node.js / REST API)

```javascript
import crypto from 'node:crypto';

/**
 * Normalizes and hashes email according to Google Ads Enhanced Conversions spec:
 * 1. Trim leading/trailing whitespace
 * 2. Lowercase all characters
 * 3. For @gmail.com and @googlemail.com, remove periods before '@'
 * 4. Compute SHA-256 hex digest
 */
export function hashEmail(email) {
  if (!email) return null;
  let normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    normalized = `${local.replace(/\./g, '')}@${domain}`;
  }
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Formats date into Google Ads required timezone string:
 * "yyyy-mm-dd hh:mm:ss+|-hh:mm"
 */
export function formatConversionDateTime(date, timeZoneOffsetStr = '+00:00') {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}${timeZoneOffsetStr}`;
}

/**
 * Uploads a single offline conversion via Google Ads REST API v25.
 * Use this only for an eligible existing implementation; otherwise use Data Manager.
 */
export async function uploadGoogleAdsConversion({
  customerId,
  accessToken,
  conversionActionId,
  gclid,
  gbraid,
  wbraid,
  email,
  conversionValue,
  currencyCode = 'USD',
  conversionDate = new Date(),
  orderId
}) {
  const url = `https://googleads.googleapis.com/v25/customers/${customerId.replace(/-/g, '')}:uploadClickConversions`;
  
  const conversionPayload = {
    conversionAction: `customers/${customerId.replace(/-/g, '')}/conversionActions/${conversionActionId}`,
    conversionDateTime: formatConversionDateTime(conversionDate, '+00:00'),
    conversionValue: Number(conversionValue),
    currencyCode,
    orderId: orderId || undefined
  };

  if (gclid) {
    conversionPayload.gclid = gclid;
  } else if (gbraid) {
    conversionPayload.gbraid = gbraid;
  } else if (wbraid) {
    conversionPayload.wbraid = wbraid;
  }

  // Enhanced Conversions for Leads user identifier
  if (email) {
    conversionPayload.userIdentifiers = [
      {
        hashedEmail: hashEmail(email),
        userIdentifierSource: 'FIRST_PARTY'
      }
    ];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      conversions: [conversionPayload],
      partialFailure: true
    })
  });

  const json = await response.json();
  if (json.partialFailureError) {
    throw new Error(`Google Ads Upload Partial Failure: ${JSON.stringify(json.partialFailureError)}`);
  }
  return json.results;
}
```

---

### Data Manager API path for new or restricted projects

Use this path when the Google Ads API returns
`CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`, or when the project is a new
offline-conversion adopter covered by Google’s historical restriction.

```javascript
const response = await fetch('https://datamanager.googleapis.com/v1/events:ingest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`
  },
  body: JSON.stringify({
    destinations: [{
      reference: 'google_ads',
      operatingAccount: { accountId: customerId, accountType: 'GOOGLE_ADS' },
      productDestinationId: String(conversionActionId)
    }],
    events: [{
      destinationReferences: ['google_ads'],
      eventTimestamp: conversionDate.toISOString(),
      conversionValue: Number(conversionValue),
      currency: currencyCode,
      transactionId: orderId,
      adIdentifiers: { gclid }
    }]
  })
});
```

Data Manager uses OAuth scope
`https://www.googleapis.com/auth/datamanager`, does not require a developer
token, and uses fast-fail semantics rather than `partial_failure`. Validate
the exact destination and event schema against the [offline events reference](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline) before production use.

### Option B: ClickTrail implementation

ClickTrail provides deterministic capture, consent-aware first-party storage,
form attachment, and destination-neutral event construction. It does not
claim provider delivery without a provider receipt.

#### 1. Browser capture (`@vizuh/clicktrail-browser`)

```typescript
import { createClickTrail, dataLayerDestination } from '@vizuh/clicktrail-browser';

const clickTrail = createClickTrail({
  destinations: [dataLayerDestination()],
  consentGate: () => consentManager.advertising === true,
  storage: { cookieAttrs: { path: '/', sameSite: 'Lax', secure: true } },
  forms: {},
});
clickTrail.start();
```

#### 2. Next.js server boundary (`@vizuh/clicktrail-next`)

```typescript
import { attachAttributionToAccount } from '@vizuh/clicktrail-next';
import { cookies } from 'next/headers';

const accountAttribution = await attachAttributionToAccount(
  account.id,
  await cookies(),
);
// Persist accountAttribution.first_touch with the server-owned account.
```

Use the Google Ads API or Data Manager API section above for provider
credentials and delivery. ClickTrail supplies the normalized attribution
record; it does not manage Google OAuth, provider allowlists, or conversion
receipts.

---

## Failure Modes & Debugging Checks

### 1. `CONVERSION_DATETIME_INVALID` / Malformed Timezone
- **Symptom**: Google Ads API returns error code `CONVERSION_DATETIME_INVALID` or `DATE_PARSE_ERROR`.
- **Cause**: Sending an ISO 8601 string containing `'T'` or `'Z'` (e.g. `2026-03-01T15:30:00Z`).
- **Fix**: Format as exact `yyyy-mm-dd hh:mm:ss+|-hh:mm` (e.g. `2026-03-01 15:30:00+00:00`). Space separator and explicit timezone offset are mandatory.

### 2. `CLICK_NOT_FOUND` / Expired GCLID (> 90 Days)
- **Symptom**: API responds with `ConversionUploadError.CLICK_NOT_FOUND`.
- **Cause**: The click occurred more than 90 days before upload, or the GCLID was truncated / modified during redirection.
- **Fix**: Filter conversions where `Date.now() - capturedAt > 90 * 86400 * 1000`. Rely on Enhanced Conversions for Leads (hashed email) as the primary match key when click IDs exceed 90 days.

### 3. GBRAID / WBRAID Mismatch
- **Symptom**: Conversions from iOS traffic are rejected or show zero attributed value in Google Ads reporting.
- **Cause**: Submitting a `gbraid` string in the `gclid` field, or submitting both simultaneously without verifying campaign type.
- **Fix**: Check which parameter exists. Do not pass both `gclid` and `gbraid` in the same item payload; Google Ads API accepts one click identifier per conversion entry.

### 4. Safari ITP 24-Hour / 7-Day Cookie Truncation
- **Symptom**: High GCLID loss rate on iOS / Safari users returning after 24 hours to complete a form.
- **Cause**: Safari Intelligent Tracking Prevention (ITP) caps client-set (`document.cookie`) cookies to 24 hours or 7 days when the referring URL contained click tracking query parameters.
- **Fix**: Rehydrate from `localStorage` on page load, or set cookies through a server-side reverse proxy / HTTP response header (`Set-Cookie`) with `HttpOnly: false`.
