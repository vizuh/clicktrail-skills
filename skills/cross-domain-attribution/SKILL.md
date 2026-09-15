---
name: cross-domain-attribution
description: Preserve visitor identity, session state, and ad click IDs (GCLID, FBCLID) across different apex domains (e.g., company.com to checkout.com or Shopify, Stripe, Calendly) using cryptographically signed linker parameters and postMessage handshakes.
---

# Cross-Domain Attribution

Preserve the complete customer journey when visitors transition across distinct apex domains. Typical multi-domain workflows include:
- Marketing site (`brand.com`) -> Hosted e-commerce (`brand.myshopify.com` or `checkout-brand.com`)
- Landing page (`getservice.com`) -> App onboarding (`app.getservice.com` or `dashboard.io`)
- Service site (`agency.com`) -> Embedded or external booking widget (`calendly.com/agency` or `typeform.com`)
- SaaS marketing (`saas.com`) -> Hosted billing (`buy.stripe.com/abc123`)

Because web browsers enforce the **Same-Origin Policy** and strict cookie domain partitioning, cookies set on Domain A are inaccessible to Domain B. Without proactive cross-domain state propagation, Domain B interprets the visitor as a direct visit or referral, losing the original Google Ads, Meta Ads, or marketing campaign attribution.

---

## The Canonical 7-Step Protocol

### 1. CAPTURE
Detect cross-domain boundaries and extract active attribution:
- Identify outbound links pointing to configured target domains or detect embedded `<iframe>` elements.
- Read current visitor ID, session ID, first-touch UTMs, and ad click identifiers (`gclid`, `gbraid`, `wbraid`, `fbclid`).

### 2. PERSIST
Assemble and sign the portable attribution linker envelope:
- Serialize attribution fields into a compact payload.
- Append a creation timestamp (`ts`) and compute an HMAC hash or checksum to prevent tampering and replay attacks.
- Encode as a URL-safe Base64 or URI-encoded string.

### 3. CARRY
Transmit the linker across origin boundaries:
- **Links**: Attach a query parameter (e.g. `_ct_link=<token>`) to target anchor `href` attributes on `mousedown` or `touchstart` (just-in-time decoration avoids stale timestamps).
- **Iframes**: Dispatch a secure `window.postMessage({ type: 'ATTRIBUTION_LINK', token }, targetOrigin)` payload to embedded frames upon `load`.

### 4. ATTACH
Hydrate the destination domain on arrival:
- Domain B inspects `window.location.search` for `_ct_link`.
- Verify timestamp freshness (typically valid for 120 seconds to prevent link-sharing attribution leakage).
- Unpack parameters and write directly into Domain B's first-party storage (`localStorage`, cookies).

### 5. REPORT
Emit downstream conversion events containing the unified identity:
- When the visitor completes a purchase or lead form on Domain B, emit events containing the original `visitor_id`, original session ID, and inherited click IDs.

### 6. DEDUPE
Stitch the multi-domain sessions in your data warehouse:
- Reconcile the Domain A landing session with the Domain B conversion session using the shared `visitor_id`.
- Ensure Domain B does not record a new phantom acquisition channel (e.g., "Referral: brand.com").

### 7. VERIFY
Automate cross-domain handshake testing:
- Run an automated Playwright test that loads `http://domain-a.local?gclid=TEST_CROSS_123`, clicks an outbound link to `http://domain-b.local`, and asserts that `localStorage.getItem('_ct_attribution')` on Domain B contains `gclid: "TEST_CROSS_123"`.

---

## Implementation Options

### Option A: Vendor-Neutral Manual Implementation

Zero-dependency implementation featuring JIT (Just-In-Time) link decoration and inbound token parsing.

#### 1. Origin Domain: JIT Link Decorator & Iframe Broadcaster

```javascript
/**
 * Origin Domain Cross-Domain Linker (domain-a.com)
 */
(function() {
  const TARGET_DOMAINS = ['checkout-brand.com', 'brand.myshopify.com', 'calendly.com'];
  const LINKER_PARAM = '_ct_link';

  // Extract current attribution payload from local storage
  function getAttributionPayload() {
    let data = {};
    try {
      data = JSON.parse(localStorage.getItem('_ct_attribution_envelope') || '{}');
    } catch (e) {}

    return {
      vid: localStorage.getItem('_ct_vid') || 'vid_' + Math.random().toString(36).substring(2),
      ft: data.firstTouch || {},
      lt: data.lastTouch || {},
      ts: Date.now()
    };
  }

  // Serialize and encode token
  function createLinkerToken(payload) {
    const raw = JSON.stringify(payload);
    // URL-safe Base64 encoding
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Decorate URL with linker parameter
  function decorateUrl(urlString) {
    try {
      const url = new URL(urlString, window.location.href);
      const isTarget = TARGET_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith('.' + d));
      if (!isTarget) return urlString;

      const token = createLinkerToken(getAttributionPayload());
      url.searchParams.set(LINKER_PARAM, token);
      return url.toString();
    } catch (e) {
      return urlString;
    }
  }

  // Decorate links just-in-time on user intent (click/touchstart)
  document.addEventListener('mousedown', function(e) {
    const anchor = e.target.closest('a');
    if (anchor && anchor.href) {
      anchor.href = decorateUrl(anchor.href);
    }
  }, true);

  // Sync to embedded iframes
  window.addEventListener('load', function() {
    const iframes = document.querySelectorAll('iframe');
    const token = createLinkerToken(getAttributionPayload());
    iframes.forEach(iframe => {
      try {
        iframe.contentWindow.postMessage({ type: 'CT_LINKER_SYNC', token }, '*');
      } catch (e) {}
    });
  });
})();
```

#### 2. Destination Domain: Token Receiver & Hydration Engine

```javascript
/**
 * Destination Domain Linker Ingestion (domain-b.com)
 */
(function() {
  const LINKER_PARAM = '_ct_link';
  const MAX_TOKEN_AGE_MS = 120 * 1000; // 2 minutes max age

  function parseToken(token) {
    try {
      // Revert URL-safe Base64
      let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const json = atob(base64);
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function hydrateAttribution(payload) {
    if (!payload || !payload.ts) return;
    
    // Validate token freshness
    if (Date.now() - payload.ts > MAX_TOKEN_AGE_MS) {
      console.warn('Cross-domain linker token expired');
      return;
    }

    // Persist visitor ID
    if (payload.vid) {
      localStorage.setItem('_ct_vid', payload.vid);
      document.cookie = `_ct_vid=${encodeURIComponent(payload.vid)}; Path=/; Max-Age=7776000; SameSite=Lax`;
    }

    // Hydrate attribution envelope
    const existing = JSON.parse(localStorage.getItem('_ct_attribution_envelope') || '{"firstTouch":{}, "lastTouch":{}}');
    const merged = {
      firstTouch: Object.keys(existing.firstTouch).length ? existing.firstTouch : payload.ft,
      lastTouch: payload.lt || existing.lastTouch
    };

    localStorage.setItem('_ct_attribution_envelope', JSON.stringify(merged));
    console.log('Cross-domain attribution hydrated successfully:', merged);
  }

  // 1. Process URL query param on page load
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get(LINKER_PARAM);
  if (token) {
    hydrateAttribution(parseToken(token));
    // Clean URL without page reload
    urlParams.delete(LINKER_PARAM);
    const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
    window.history.replaceState({}, '', cleanUrl);
  }

  // 2. Listen for postMessage from parent frame
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'CT_LINKER_SYNC' && event.data.token) {
      hydrateAttribution(parseToken(event.data.token));
    }
  });
})();
```

---

### Option B: Turnkey Implementation with ClickTrail

ClickTrail provides seamless, secure cross-domain linker capabilities with HMAC verification and iframe bridges in `@vizuh/clicktrail-browser`.

```typescript
import { initClickTrailBrowser } from '@vizuh/clicktrail-browser';

// Origin: domain-a.com
const ct = initClickTrailBrowser({
  crossDomain: {
    enabled: true,
    targetDomains: ['checkout-brand.com', 'brand.myshopify.com'],
    paramName: '_ct_link',
    hmacSecret: process.env.NEXT_PUBLIC_LINKER_SECRET,
    ttlSeconds: 120,
    iframeMessaging: true
  }
});

// Destination: domain-b.com
const ctDest = initClickTrailBrowser({
  crossDomain: {
    enabled: true,
    acceptIncoming: true,
    hmacSecret: process.env.NEXT_PUBLIC_LINKER_SECRET
  }
});

// Destination automatically consumes incoming token and stitches the session
console.log('Unified Visitor ID:', ctDest.getVisitorId());
console.log('Inherited First-Touch GCLID:', ctDest.getAttribution().ft_gclid);
```

---

## Failure Modes & Debugging Checks

### 1. Linker Expiration & Replay Attacks
- **Symptom**: User lands on Domain B from an email link or bookmark, and attribution is rejected as expired.
- **Cause**: Static link decoration on page render causes users who leave the tab open for 5 minutes before clicking to send an expired token.
- **Fix**: Use Just-In-Time (JIT) decoration on `mousedown` / `touchstart` rather than decorating all anchor tags on `DOMContentLoaded`.

### 2. Intermediate Redirects Stripping the Token
- **Symptom**: `_ct_link` parameter is missing on the final checkout landing page.
- **Cause**: Domain B performs an internal HTTP 302 redirect (e.g., `/checkout` -> `/checkout/step-1` or `http` to `https`) without passing through query parameters.
- **Fix**: Verify redirects retain `$query_string` or inspect network hops in DevTools Network tab.

### 3. Iframe Third-Party Cookie Blocking
- **Symptom**: Destination iframe cannot write cookies in Safari or Chrome when embedded on Domain A.
- **Cause**: Browsers block third-party cookies inside cross-origin iframes by default.
- **Fix**: Use `window.postMessage` between parent and iframe to pass attribution into the iframe's `localStorage` rather than relying on cookie inheritance.

### 4. Link Sharing Cross-Contamination
- **Symptom**: Customer A shares a checkout link with Customer B, and Customer B's purchase is attributed to Customer A's session.
- **Cause**: `_ct_link` was not stripped from the browser URL bar after consumption on Domain B.
- **Fix**: Always call `window.history.replaceState` immediately after reading and storing the linker token.
