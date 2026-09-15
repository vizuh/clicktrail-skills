---
name: preserve-click-ids
description: Preserve advertising click IDs (GCLID, GBRAID, WBRAID, FBCLID, MSCLKID, TTCLID, LI_FAT_ID) against Safari ITP cookie caps, 301/302 redirects, and single-page application navigation.
---

# Preserve Click IDs

Safeguard critical ad attribution parameters across user sessions. Ad platforms depend on click identifiers to connect offline conversions and website conversions back to specific ad clicks:
- `gclid`: Google Ads (Web / Desktop)
- `gbraid`: Google Ads (App-to-Web on iOS 14.5+)
- `wbraid`: Google Ads (Web-to-Web on iOS 14.5+)
- `fbclid`: Meta Ads (Facebook & Instagram)
- `msclkid`: Microsoft Advertising (Bing)
- `ttclid`: TikTok Ads
- `li_fat_id`: LinkedIn Ads

Modern browsers, privacy features, and frontend architectures actively strip or truncate these identifiers:
1. **Apple Safari ITP**: Limits script-written (`document.cookie`) cookies and `localStorage` to 7 days (or 24 hours if the referring URL contained query parameters with known tracking signatures).
2. **Server Redirects**: HTTP 301/302 redirects (e.g. `http://` to `https://`, trailing slash normalization, or marketing landing page redirects) often drop query strings.
3. **Single Page Applications (SPAs)**: Client-side routers (Next.js, React Router, Vue Router) overwrite the address bar query string without preserving parameters in application state.

---

## The Canonical 7-Step Protocol

### 1. CAPTURE
Extract ad click IDs and acquisition parameters before framework hydration:
- Scan `window.location.search` during early page execution (e.g., synchronous head snippet).
- Capture all recognized ad identifiers: `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `li_fat_id`, `twclid`, plus standard UTMs (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`).

### 2. PERSIST
Store parameters redundantly across multiple browser storage layers:
- **First-party Cookie**: Set with `Path=/; SameSite=Lax; Max-Age=7776000` (90 days) on the top-level parent domain (e.g., `.example.com`).
- **`localStorage`**: Persistent fallback that survives session closure and cross-tab navigation.
- **`sessionStorage`**: Fast in-session cache that remains intact even if cookies are disabled.
- Store both **First-Touch (`ft_`)** and **Last-Touch (`lt_`)** envelopes to preserve the original acquisition source while recording subsequent touchpoints.

### 3. CARRY
Ensure parameters survive multi-page navigation and domain jumps:
- Monitor history mutations (`pushState`, `replaceState`, `popstate`) so SPA route changes do not purge active attribution state.
- Automatically rehydrate memory state from persistent storage if a visitor returns directly without query parameters.

### 4. ATTACH
Inject captured click identifiers into all conversion pathways:
- Use a `MutationObserver` to watch for newly mounted forms and automatically append `<input type="hidden" name="gclid" ...>` elements.
- Decorate outbound links leading to external checkout platforms (e.g. Stripe, Calendly, Shopify) with click ID query parameters.

### 5. REPORT
Expose a single, immutable snapshot of the attribution envelope:
- Provide an accessor (e.g. `window.getAttributionData()`) for GTM dataLayer pushes, analytics events, and CRM payload serialization.

### 6. DEDUPE
Prevent destructive overwriting of historical click data:
- If a user lands from a direct visit after an ad click, do NOT wipe the first-touch `gclid`.
- If a user lands from a new Google ad click, record the new ID as `lt_gclid` while retaining the original `ft_gclid`.

### 7. VERIFY
Automate integrity testing across browser environments:
- Use Playwright/Puppeteer to simulate an ad landing (`?gclid=TEST_123&fbclid=TEST_456`), navigate through 3 internal pages, and verify that hidden form fields on `/contact` still contain the original values.
- Verify cookie expiration headers and domain scope.

---

## Implementation Options

### Option A: Vendor-Neutral Manual Implementation

Zero-dependency, production-tested JavaScript engine with ITP resilience and automatic form injection.

```javascript
/**
 * Zero-dependency Click ID & UTM Preservation Engine
 */
(function() {
  const CLICK_PARAMS = [
    'gclid', 'gbraid', 'wbraid',
    'fbclid', 'msclkid', 'ttclid',
    'li_fat_id', 'twclid'
  ];
  const UTM_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign',
    'utm_term', 'utm_content'
  ];
  const ALL_PARAMS = [...CLICK_PARAMS, ...UTM_PARAMS];

  const COOKIE_NAME = '_ct_attribution';
  const STORAGE_KEY = '_ct_attribution_envelope';

  // Helper: Read cookie
  function readCookie(name) {
    const m = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
  }

  // Helper: Write wide-domain cookie
  function writeCookie(name, value, days = 90) {
    const domain = window.location.hostname.includes('.')
      ? '.' + window.location.hostname.split('.').slice(-2).join('.')
      : window.location.hostname;
    const maxAge = days * 86400;
    document.cookie = `${name}=${encodeURIComponent(value)}; Domain=${domain}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  }

  // Helper: Load current envelope
  function loadEnvelope() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!raw) raw = readCookie(COOKIE_NAME);
    try {
      return raw ? JSON.parse(raw) : { firstTouch: {}, lastTouch: {} };
    } catch (e) {
      return { firstTouch: {}, lastTouch: {} };
    }
  }

  // Helper: Save envelope
  function saveEnvelope(envelope) {
    const serialized = JSON.stringify(envelope);
    try { localStorage.setItem(STORAGE_KEY, serialized); } catch (e) {}
    try { sessionStorage.setItem(STORAGE_KEY, serialized); } catch (e) {}
    writeCookie(COOKIE_NAME, serialized);
  }

  // 1. Capture incoming query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const detected = {};
  let hasNew = false;

  ALL_PARAMS.forEach(key => {
    const val = urlParams.get(key);
    if (val) {
      detected[key] = val;
      hasNew = true;
    }
  });

  const envelope = loadEnvelope();
  const now = new Date().toISOString();

  // First-Touch: Store once, never overwrite
  if (Object.keys(envelope.firstTouch).length === 0 && hasNew) {
    envelope.firstTouch = { ...detected, recordedAt: now };
  }

  // Last-Touch: Update whenever new marketing parameters arrive
  if (hasNew) {
    envelope.lastTouch = { ...detected, recordedAt: now };
    saveEnvelope(envelope);
  }

  // Expose global accessor
  window.getAttributionEnvelope = function() {
    return loadEnvelope();
  };

  // 2. Attach to HTML Forms via DOM MutationObserver
  function injectForm(form) {
    const current = loadEnvelope();
    const active = { ...current.firstTouch, ...current.lastTouch };

    ALL_PARAMS.forEach(param => {
      const value = active[param];
      if (value) {
        let input = form.querySelector(`input[name="${param}"]`);
        if (!input) {
          input = document.createElement('input');
          input.type = 'hidden';
          input.name = param;
          form.appendChild(input);
        }
        input.value = value;
      }
    });
  }

  function scanForms() {
    document.querySelectorAll('form').forEach(injectForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanForms);
  } else {
    scanForms();
  }

  // Watch for dynamic forms mounted by React/Vue/Svelte
  if (window.MutationObserver) {
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === 'FORM') injectForm(node);
            else if (node.querySelectorAll) node.querySelectorAll('form').forEach(injectForm);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
```

---

### Option B: Turnkey Implementation with ClickTrail

ClickTrail provides enterprise-grade click ID preservation with automated first-touch/last-touch classification, consent compliance, and server-side fallback.

#### Using `@vizuh/clicktrail-browser`

```typescript
import { createClickTrail, dataLayerDestination } from '@vizuh/clicktrail-browser';

const ct = createClickTrail({
  destinations: [dataLayerDestination()],
  consentGate: () => consentManager.advertising === true,
  storage: { cookieAttrs: { path: '/', sameSite: 'Lax', secure: true } },
  forms: {},
});
ct.start();

const attribution = ct.getData();
console.log('Original First-Touch GCLID:', attribution.ft_gclid);
console.log('Latest Last-Touch FBCLID:', attribution.lt_fbclid);
console.log('Active Campaign Medium:', attribution.lt_medium);
```

---

## Failure Modes & Debugging Checks

### 1. HTTP 301/302 Redirect Dropping Query Strings
- **Symptom**: `window.location.search` is empty on the landing page even though ad clicks contain `?gclid=...`.
- **Cause**: Nginx, Cloudflare, or Apache redirecting from `http://example.com` to `https://www.example.com` without preserving `$args` / `$request_uri`.
- **Fix**: Check server redirect config:
  ```nginx
  # Nginx fix: ensure $is_args$args is appended
  return 301 https://www.example.com$request_uri;
  ```

### 2. Apple Safari ITP 24-Hour Expiration Cap
- **Symptom**: Conversions from Safari users who convert 2+ days after clicking an ad lose attribution.
- **Cause**: Safari ITP caps client-set cookies to 24 hours if the click arrived via a link containing query parameters with tracking IDs.
- **Fix**: Sync client storage with a server-set HTTP `Set-Cookie` header via an edge worker (Cloudflare Worker or Next.js middleware).

### 3. Dynamic Form Hydration Wiping Hidden Inputs
- **Symptom**: Hidden form fields exist in HTML source but submit empty values in React/Next.js applications.
- **Cause**: Controlled components in React or Vue re-render the form DOM node on user interaction and discard inputs inserted by external DOM scripts.
- **Fix**: Use ClickTrail's React hook or bind values directly into state:
  ```jsx
  const attribution = useClickTrail();
  <input type="hidden" name="gclid" value={attribution.gclid || ''} />
  ```

### 4. Storage Access Exception in Private Browsing
- **Symptom**: Script throws unhandled `SecurityError: The operation is insecure` or `QuotaExceededError` in Safari Private Browsing.
- **Cause**: Safari blocks `localStorage` writes in strict privacy settings.
- **Fix**: Always wrap `localStorage.setItem` and `sessionStorage.setItem` in `try/catch` blocks and fall back to in-memory state.
