---
name: meta-capi-deduplication
description: Deduplicate Meta Pixel and Conversions API (CAPI) events using matching event_id, event_name, _fbp, _fbc, and SHA-256 hashed user data to prevent double-counted conversions and dropped ROAS.
---

# Meta Conversions API (CAPI) Deduplication

Ensure high-fidelity attribution without double-counting. Meta recommends redundant event streaming: dispatching events simultaneously through the client-side Meta Pixel (`fbq`) and server-side Conversions API (CAPI). 

Without deterministic deduplication, Meta attributes duplicate conversions to the same ad click, inflating reported return on ad spend (ROAS), confusing Advantage+ bidding models, and triggering erratic budget reallocation.

This skill outlines the canonical deduplication protocol, proper extraction and construction of `_fbp` and `_fbc` cookies, and end-to-end implementation for both browser and server runtimes.

---

## The Canonical 7-Step Protocol

Meta requires two identical attributes across browser and server payloads to deduplicate: **`event_name`** and **`event_id`**, backed by matching user identifiers (`_fbp`, `_fbc`, hashed email).

### 1. CAPTURE
Extract Meta identifiers upon initial landing and interaction:
- `fbclid`: Query parameter appended to URLs when users click a Meta ad.
- `_fbp`: Meta browser cookie ID (`fb.1.${timestamp}.${randomNumber}`). Read existing or generate if missing.
- `_fbc`: Meta click ID cookie. Construct as `fb.1.${timestamp}.${fbclid}` when `fbclid` is present in URL.
- User data: Email, phone, first name, last name, client IP address, and client User-Agent header.

### 2. PERSIST
Maintain state across sessions:
- Save `_fbp` and `_fbc` in first-party cookies with `Path=/; Max-Age=7776000; SameSite=Lax`.
- Mirror identifiers in `localStorage` to protect against Safari ITP 24-hour cookie expiration caps on campaign landings.
- Generate a single deterministic `event_id` (e.g., order ID, lead ID, or UUID v4 generated on the initiating action) and persist it temporarily in memory or `sessionStorage`.

### 3. CARRY
Forward the deduplication context through the conversion pipeline:
- Transmit `event_id`, `_fbp`, `_fbc`, and client IP/User Agent to your backend when checkout, signup, or form submission occurs.
- If checkout is multi-step, retain the `event_id` in checkout session state (e.g., Stripe PaymentIntent metadata or backend session).

### 4. ATTACH
Construct identical event signatures for both endpoints:
- Set `event_name` to an exact standard Meta event name (e.g. `'Purchase'`, `'Lead'`, `'CompleteRegistration'`).
- Assign the exact same `event_id` string to both the client-side `fbq` call and the server-side CAPI payload.
- Attach normalized SHA-256 hashed contact parameters to increase Event Match Quality (EMQ).

### 5. REPORT
Emit events across dual channels:
- **Client**: Call `fbq('track', event_name, customData, { eventID: event_id })`.
- **Server**: Send an HTTP POST to `https://graph.facebook.com/v19.0/{PIXEL_ID}/events` containing the matching `event_id`, `event_name`, `event_time`, `user_data`, and `action_source: "website"`.

### 6. DEDUPE
Meta's ingestion engine matches events received within a 48-hour window:
- When Meta receives the browser event, it registers instant optimization signals.
- When Meta receives the server CAPI event with identical `(event_name, event_id)`, it recognizes the duplicate, discards the duplicate conversion count, and merges the rich server-side matching parameters (`client_ip_address`, hashed email).

### 7. VERIFY
Validate deduplication in Meta Events Manager:
- Configure `test_event_code` in your CAPI payload during staging.
- Open **Meta Events Manager > Data Sources > Pixel > Test Events**.
- Observe conversion events; verify the Status column displays **"Browser • Server (Deduplicated)"** and the Deduplication Overlap rate is > 95%.

---

## Implementation Options

### Option A: Vendor-Neutral Manual Implementation

Zero-dependency implementation using native browser JavaScript and Node.js server code.

#### 1. Browser Capture, Cookie Management & Pixel Trigger

```javascript
// Utility: Read cookie value by name
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

// Utility: Set 1st-party cookie
function setCookie(name, val, days = 90) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(val)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

// 1. Initialize or maintain _fbp and _fbc
export function setupMetaCookies() {
  const urlParams = new URLSearchParams(window.location.search);
  const fbclid = urlParams.get('fbclid');
  const now = Date.now();

  // Handle _fbc
  if (fbclid) {
    const fbcValue = `fb.1.${now}.${fbclid}`;
    setCookie('_fbc', fbcValue);
    try { localStorage.setItem('_fbc', fbcValue); } catch (e) {}
  }

  // Handle _fbp
  let fbp = getCookie('_fbp');
  if (!fbp) {
    try { fbp = localStorage.getItem('_fbp'); } catch (e) {}
  }
  if (!fbp) {
    const random = Math.floor(Math.random() * 10000000000);
    fbp = `fb.1.${now}.${random}`;
    setCookie('_fbp', fbp);
    try { localStorage.setItem('_fbp', fbp); } catch (e) {}
  }

  return {
    fbp: getCookie('_fbp') || fbp,
    fbc: getCookie('_fbc') || (fbclid ? `fb.1.${now}.${fbclid}` : null)
  };
}

// 2. Track Deduplicated Client Conversion
export function trackClientConversion(eventName, eventId, customData = {}) {
  if (typeof window.fbq !== 'function') {
    console.warn('Meta Pixel (fbq) not loaded');
    return;
  }
  
  // Notice the exact parameter object containing eventID
  window.fbq('track', eventName, customData, { eventID: eventId });
}
```

#### 2. Server CAPI Dispatch with Normalization (Node.js)

```javascript
import crypto from 'node:crypto';

export function sha256(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Sends a server-side event to Meta Conversions API
 */
export async function sendMetaCAPIEvent({
  pixelId,
  accessToken,
  eventName,
  eventId,
  eventTime = Math.floor(Date.now() / 1000),
  eventSourceUrl,
  userData: {
    email,
    phone,
    fbp,
    fbc,
    clientIp,
    clientUserAgent
  },
  customData = {},
  testEventCode = null
}) {
  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        event_id: eventId, // MUST match browser fbq eventID
        event_source_url: eventSourceUrl,
        action_source: 'website',
        user_data: {
          em: email ? [sha256(email)] : undefined,
          ph: phone ? [sha256(phone.replace(/[^0-9]/g, ''))] : undefined,
          fbp: fbp || undefined,
          fbc: fbc || undefined,
          client_ip_address: clientIp || undefined,
          client_user_agent: clientUserAgent || undefined
        },
        custom_data: customData
      }
    ]
  };

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(`Meta CAPI Error: ${JSON.stringify(body.error || body)}`);
  }
  return body;
}
```

---

### Option B: Turnkey Implementation with ClickTrail

ClickTrail automates unified `event_id` assignment, cookie preservation, and server-side fan-out through `@vizuh/clicktrail` and its browser/server adapters.

#### 1. Browser Event Dispatch (`@vizuh/clicktrail-browser`)

```typescript
import { initClickTrailBrowser } from '@vizuh/clicktrail-browser';

const ct = initClickTrailBrowser({
  destinations: {
    metaPixel: true // Automatically generates and pairs event_id on fbq calls
  }
});

// Emits browser purchase with an automatically stamped idempotent event_id
const eventRecord = ct.track('sale', {
  orderId: 'ord_987654',
  value: 149.00,
  currency: 'USD'
});

console.log('Generated Deduplication ID:', eventRecord.eventId);
// Passes eventRecord.eventId to backend via checkout payload
```

#### 2. Server CAPI Dispatch (`@vizuh/clicktrail-server`)

```typescript
import { ClickTrailServerClient } from '@vizuh/clicktrail-server';

const ctServer = new ClickTrailServerClient({
  apiKey: process.env.CLICKTRAIL_API_KEY
});

// Transmit verified purchase to Meta CAPI
await ctServer.sendSale({
  eventId: checkoutPayload.eventId, // Mirrors browser event_id
  orderId: 'ord_987654',
  revenue: 149.00,
  currency: 'USD',
  clickIds: {
    fbp: checkoutPayload.fbp,
    fbc: checkoutPayload.fbc
  },
  user: {
    email: order.customerEmail,
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  },
  destinations: ['meta-capi']
});
```

---

## Failure Modes & Debugging Checks

### 1. Mismatched `event_id` Between Client and Server
- **Symptom**: Events Manager reports 2x conversion count; Deduplication Overlap shows 0%.
- **Cause**: Client generates random UUID on button click, but server generates a distinct UUID or uses an internal database serial ID when recording the purchase.
- **Fix**: Use the authoritative `order_id` or transaction reference as the `event_id` for both calls (e.g. `eventID: "order_100234"`). If generating client-side, pass the exact string to the server in the checkout request payload.

### 2. Case and Spelling Mismatch in `event_name`
- **Symptom**: Both events appear in Events Manager but are classified as different event types (e.g. `Purchase` from browser vs `purchase` or `Sale` from server).
- **Cause**: Meta standard event names are case-sensitive strings (`Purchase`, `Lead`, `AddToCart`, `InitiateCheckout`, `CompleteRegistration`).
- **Fix**: Enforce an enum or strict string constant for event names across client and server.

### 3. Invalid `_fbc` Format
- **Symptom**: Low Event Match Quality warning on Meta CAPI dashboard for `fbc`.
- **Cause**: Passing the raw `fbclid` query value (e.g. `IwAR0...`) directly to the `fbc` user data field.
- **Fix**: Format `_fbc` strictly as `fb.1.${creationTimestamp}.${fbclid}` where `creationTimestamp` is Unix epoch milliseconds.

### 4. Timestamp Skew (`event_time` > 7 Days)
- **Symptom**: CAPI returns HTTP 400 with error subcode `2804003` ("Event time is older than 7 days").
- **Cause**: Backfilling legacy conversions or server clock drift.
- **Fix**: Verify server NTP synchronization; reject or omit CAPI delivery for events with timestamps older than 7 days.
