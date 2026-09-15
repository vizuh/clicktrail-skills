---
name: google-ads-offline-conversions
description: Upload offline conversion adjustments, qualified leads, and CRM revenue back to Google Ads via the Google Ads API using GCLID, GBRAID, WBRAID, and Enhanced Conversions for Leads with SHA-256 hashed user data.
---

# Google Ads Offline Conversions

Bridge the gap between online ad clicks and offline revenue. When deals close in your CRM, contracts are signed, or payments process in Stripe days or weeks later, upload conversion adjustments back to Google Ads to train Smart Bidding algorithms on real business value rather than raw form fills.

This skill solves the challenge of capturing and preserving Google click identifiers (`gclid`, `gbraid`, `wbraid`), associating them with customer leads, formatting offline conversion payloads for the Google Ads API, and diagnosing upload rejections.

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
When a qualification milestone or revenue event occurs (e.g., deal marked "Closed Won", SQL status reached, trial converted to paid):
- Query Google Ads API `conversionUploadService.uploadClickConversions`.
- Provide `conversionActionId`, `conversionDateTime` (strictly formatted with timezone offset), `conversionValue`, `currencyCode`, and the matched `gclid`, `gbraid`, `wbraid`, or SHA-256 hashed user identifiers.

### 6. DEDUPE
Prevent double counting on retries, webhook re-deliveries, or status adjustments:
- Provide an `order_id` (transaction ID / deal ID) as the idempotency key in the upload request.
- Google Ads evaluates `(gclid, conversion_action, order_id)` to deduplicate repeated uploads. For adjustments (e.g., value revision or refund), use `uploadConversionAdjustments`.

### 7. VERIFY
Validate upload success and match quality:
- Enable `partial_failure: true` in the API request to inspect individual upload item errors without aborting the batch.
- Verify that `response.partial_failure_error` is empty or inspect `ConversionUploadError` enum codes.
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

  if (hasNewId) {
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
    if (!currentData.gclid && !currentData.gbraid && !currentData.wbraid) return;
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
 * Uploads a single offline conversion via Google Ads REST API v17
 */
export async function uploadGoogleAdsConversion({
  customerId,
  developerToken,
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
  const url = `https://googleads.googleapis.com/v17/customers/${customerId.replace(/-/g, '')}:uploadClickConversions`;
  
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
      'developer-token': developerToken,
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

### Option B: Turnkey Implementation with ClickTrail

ClickTrail provides deterministic capture, consent enforcement, and automatic offline conversion dispatch via `@vizuh/clicktrail` / `@vizuh/clicktrail-*`.

#### 1. Browser Capture (`@vizuh/clicktrail-browser`)

```typescript
import { initClickTrailBrowser } from '@vizuh/clicktrail-browser';

// Initialize auto-capture of gclid, gbraid, wbraid, UTMs, and form bindings
const ct = initClickTrailBrowser({
  cookieDomain: '.example.com',
  persistDurationDays: 90,
  autoInjectForms: true,
  consentCategory: 'marketing'
});

// Access current acquisition envelope
const attribution = ct.getAttribution();
console.log('Active GCLID:', attribution.gclid);
console.log('First-Touch Click ID:', attribution.ft_gclid);
```

#### 2. Backend Offline Conversion Ingestion (`@vizuh/clicktrail-server`)

```typescript
import { ClickTrailServerClient } from '@vizuh/clicktrail-server';

const ctServer = new ClickTrailServerClient({
  apiKey: process.env.CLICKTRAIL_API_KEY,
  endpoint: 'https://collector.clicktrail.io/api/v1'
});

// Emitting offline conversion upon CRM deal closure
await ctServer.sendOfflineConversion({
  visitorId: lead.visitorId,
  leadId: lead.id,
  orderId: `deal_${deal.id}`,
  conversionAction: 'crm_qualified_deal',
  revenue: deal.amount,
  currency: 'USD',
  timestamp: deal.closedAt,
  clickIds: {
    gclid: lead.gclid,
    gbraid: lead.gbraid,
    wbraid: lead.wbraid
  },
  user: {
    email: lead.email // ClickTrail automatically normalizes and hashes via SHA-256
  },
  destinations: ['google-ads'] // ClickTrail handles OAuth, throttling, and API schemas
});
```

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
