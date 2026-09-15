---
name: lead-to-sale-attribution
description: MUST USE when a user needs to connect an anonymous ad click to a lead, CRM stage, contract, payment, or final sale across a long sales cycle. Use for durable lead IDs, delayed revenue, server-side handoff, and end-to-end verification.
---

# Lead-to-Sale Attribution

Connect upfront advertising spend with delayed backend revenue. In B2B, SaaS, and high-ticket sales, customer journeys are asynchronous:
1. **Day 1**: User clicks a Google or LinkedIn ad (`gclid` / `li_fat_id`), browses anonymously, and leaves.
2. **Day 5**: User returns organically and downloads a whitepaper or submits a demo request (Lead Created).
3. **Day 30**: Sales qualifies the lead (Opportunity Created).
4. **Day 60**: Customer signs a contract and pays via Stripe or wire transfer (Sale Completed).

Standard client-side analytics tools (Google Analytics, Meta Pixel) lose the attribution chain after the browser session closes. They report form submissions, but cannot distinguish between a tire-kicker and a $50,000 closed enterprise contract.

This skill establishes the full-funnel architecture required to stitch anonymous website touches to CRM leads, track qualification stages, and attribute final billing revenue to the originating ad campaign.

---

## The Canonical 7-Step Protocol

### 1. CAPTURE
Record visitor acquisition context upon initial anonymous visit:
- Generate a UUID v4 `visitor_id`.
- Capture first-touch marketing context: `utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `fbclid`, `referrer`, and landing page URL.

### 2. PERSIST
Maintain visitor identity across long deliberation intervals:
- Write `visitor_id` and attribution state into long-lived first-party cookies (`Max-Age=31536000`, 1 year) and `localStorage`.
- Create a corresponding `visitor_sessions` record in your backend database.

### 3. CARRY
Preserve the multi-touch journey across repeat visits:
- Retain the initial First-Touch (`ft_*`) parameters while updating Last-Touch (`lt_*`) parameters when the user returns via retargeting ads or email newsletters.

### 4. ATTACH
Bridge anonymous identity to known customer records upon form submission:
- Inject `visitor_id`, `ft_gclid`, `ft_utm_campaign`, and session metadata into hidden form fields or the API submission payload.
- In the backend, insert a `leads` record linking `lead_id`, `email`, and `visitor_id`.

### 5. REPORT
Emit attribution revenue events when financial transactions occur:
- Listen to billing webhooks (e.g. Stripe `checkout.session.completed` or `invoice.payment_succeeded`).
- Query the database to resolve the customer's email back to `lead_id` and the original `visitor_id`.
- Dispatch a canonical `sale` event with transaction amount, currency, and originating acquisition parameters to your attribution warehouse and ad platform offline conversion endpoints.

### 6. DEDUPE
Guarantee idempotent event processing across webhook deliveries:
- Key sales events using `stripe_invoice_id` or `payment_intent_id`.
- Separate new business revenue (initial sale) from recurring subscription renewals to prevent inflating campaign ROAS.

### 7. VERIFY
Validate attribution pipeline integrity via SQL reconciliation:
- Run daily automated checks verifying that > 90% of closed-won deals possess a non-null `visitor_id` and attributed marketing channel.
- Audit missing attribution records to identify ungated sales funnels or untracked entry points.

---

## Implementation Options

### Option A: Vendor-Neutral Manual Implementation

Zero-dependency architecture combining client-side identity tracking, PostgreSQL relational schema, and a Node.js Stripe webhook handler.

#### 1. Database Schema (PostgreSQL)

```sql
-- Anonymous visitor touchpoints
CREATE TABLE attribution_visitors (
  visitor_id UUID PRIMARY KEY,
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ft_source VARCHAR(100),
  ft_medium VARCHAR(100),
  ft_campaign VARCHAR(255),
  ft_gclid VARCHAR(255),
  ft_fbclid VARCHAR(255),
  ft_landing_page TEXT
);

-- Known leads
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  visitor_id UUID REFERENCES attribution_visitors(visitor_id),
  email VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'new', -- new, qualified, closed_won, closed_lost
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Downstream revenue transactions
CREATE TABLE attribution_sales (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id),
  visitor_id UUID REFERENCES attribution_visitors(visitor_id),
  transaction_id VARCHAR(255) UNIQUE NOT NULL, -- Idempotency key (e.g. Stripe ch_xxx)
  amount_cents INT NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  closed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 2. Client-Side Lead Form Binding (Vanilla JS)

```javascript
// On form submission, pass visitorId and attribution parameters
(function() {
  function getVisitorId() {
    let vid = localStorage.getItem('_ct_vid');
    if (!vid) {
      vid = crypto.randomUUID();
      localStorage.setItem('_ct_vid', vid);
    }
    return vid;
  }

  const form = document.querySelector('#lead-form');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      // Attach attribution state
      payload.visitorId = getVisitorId();
      try {
        const envelope = JSON.parse(localStorage.getItem('_ct_attribution_envelope') || '{}');
        payload.attribution = envelope.firstTouch || {};
      } catch (err) {}

      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      window.location.href = '/thank-you';
    });
  }
})();
```

#### 3. Backend Stripe Revenue Attribution Webhook (Node.js / Express)

```javascript
import express from 'express';
import Stripe from 'stripe';
import pg from 'pg';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    const customerEmail = invoice.customer_email;
    const amountCents = invoice.amount_paid;
    const transactionId = invoice.payment_intent || invoice.id;

    // 1. Resolve lead and visitor ID
    const leadQuery = await pool.query(
      'SELECT id, visitor_id FROM leads WHERE email = $1',
      [customerEmail]
    );

    if (leadQuery.rows.length > 0) {
      const { id: leadId, visitor_id: visitorId } = leadQuery.rows[0];

      // 2. Insert deduplicated sale record
      await pool.query(`
        INSERT INTO attribution_sales (lead_id, visitor_id, transaction_id, amount_cents, currency)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (transaction_id) DO NOTHING
      `, [leadId, visitorId, transactionId, amountCents, invoice.currency.toUpperCase()]);

      console.log(`Attributed sale of $${amountCents / 100} to Visitor: ${visitorId}`);
    }
  }

  res.json({ received: true });
});
```

---

### Option B: Turnkey Implementation with ClickTrail

ClickTrail provides turnkey identity stitching, lead capture bindings, and automated server-side revenue reporting via `@vizuh/clicktrail-core` and `@vizuh/clicktrail-server`.

#### 1. Capture & Form Binding (`@vizuh/clicktrail-browser`)

```typescript
import { createClickTrail, dataLayerDestination } from '@vizuh/clicktrail-browser';

const ct = createClickTrail({
  destinations: [dataLayerDestination()],
  consentGate: () => consentManager.advertising === true,
  forms: {},
});
ct.start();

// Keep PII in the server-owned form/lead boundary; send only a stable lead ID.
ct.track('lead_created', { event_id: 'evt_lead_987654', lead_id: 'lead_987654' });
```

#### 2. Ingesting Stripe / CRM Revenue (`@vizuh/clicktrail-server`)

```typescript
import { ClickTrailServerClient } from '@vizuh/clicktrail-server';

const ctServer = new ClickTrailServerClient({
  apiKey: process.env.CLICKTRAIL_API_KEY
});

// On deal close or Stripe webhook
await ctServer.sendSale({
  orderId: invoice.id,
  user: {
    email: invoice.customer_email
  },
  revenue: invoice.amount_paid / 100,
  currency: 'USD',
  destinations: ['google-ads', 'meta-capi', 'warehouse']
});
```

---

## Failure Modes & Debugging Checks

### 1. Identity Disconnect (Personal vs Corporate Email)
- **Symptom**: Lead fills form with `john@gmail.com`, but sales closes the deal under `john@megacorp.com`; Stripe payment records have zero matching lead source.
- **Cause**: Email-only matching fails across email switches during sales conversations.
- **Fix**: Capture and preserve the immutable `visitor_id` in CRM custom fields (`visitor_id__c`), or use identity stitching tables that merge multiple emails under a common `account_id`.

### 2. Form Submissions via Third-Party Iframes
- **Symptom**: Leads from embedded Hubspot or Marketo forms arrive in CRM without `gclid` or `utm_campaign`.
- **Cause**: Iframes run in separate browsing contexts and do not receive parent window hidden inputs.
- **Fix**: Pass attribution parameters into iframe query strings on mount or use the Hubspot Forms API `onFormReady` hook to set field values via JavaScript.

### 3. Duplicate Revenue Reporting on Recurring Invoices
- **Symptom**: Monthly subscription renewals cause ad campaigns to report 12x return, artificially inflating ROAS.
- **Cause**: Listening to generic billing webhooks without filtering `billing_reason === 'subscription_create'` vs `'subscription_cycle'`.
- **Fix**: Only trigger initial acquisition `sale` events on the first invoice (`billing_reason === 'subscription_create'`). Record recurring invoices as separate LTV milestone events.
