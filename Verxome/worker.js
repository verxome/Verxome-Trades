/* ==========================================================================
   Verxome Trades — Worker entry point
   --------------------------------------------------------------------------
   Your Cloudflare project deploys via `wrangler deploy`, which is the
   Workers deployment path — not classic Cloudflare Pages. That path does
   not auto-detect a /functions folder, so payment verification needs to
   live directly in this file instead. Everything else (index.html,
   verxome-api.js, the favicon) is served automatically via the ASSETS
   binding configured in wrangler.jsonc — nothing needs to change there.
   ========================================================================== */

const PLAN_PRICES_GHS = {
  warrior: 150,
  commander: 350,
  general: 750,
};

// Launch promo — must mirror the PROMO block in verxome-api.js exactly.
// This copy runs on Cloudflare's own clock, which is what actually
// decides the amount a payment is checked against — the browser's date
// is never trusted for this. If you change the discount or end date,
// update BOTH files or genuine payments could get rejected (or the
// wrong amount could get silently accepted).
const PROMO = {
  ACTIVE: true,
  DISCOUNT_PERCENT: 50,
  END_DATE: '2026-10-01T00:00:00Z', // promo runs through the end of Sept 30, 2026 (Ghana time, GMT+0)
};

function isPromoActive() {
  if (!PROMO.ACTIVE) return false;
  return new Date() < new Date(PROMO.END_DATE);
}

function getExpectedPriceGHS(planId) {
  const originalPrice = PLAN_PRICES_GHS[planId];
  if (originalPrice == null) return null;
  return isPromoActive() ? Math.round(originalPrice * (1 - PROMO.DISCOUNT_PERCENT / 100)) : originalPrice;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/verify-payment' && request.method === 'POST') {
      return handleVerifyPayment(request, env);
    }

    // Everything else — index.html, verxome-api.js, the favicon, etc. —
    // is just served as a static file.
    return env.ASSETS.fetch(request);
  },
};

async function handleVerifyPayment(request, env) {
  try {
    // PAYSTACK_SECRET_KEY may be a plain secret (a string) or a Secrets
    // Store binding (an object with an async .get() method) depending on
    // how it was added in the Cloudflare dashboard — this handles both.
    const paystackSecretKey = typeof env.PAYSTACK_SECRET_KEY === 'string'
      ? env.PAYSTACK_SECRET_KEY
      : env.PAYSTACK_SECRET_KEY && typeof env.PAYSTACK_SECRET_KEY.get === 'function'
        ? await env.PAYSTACK_SECRET_KEY.get()
        : null;

    if (!paystackSecretKey) {
      return jsonResponse({ verified: false, error: 'Payment verification is not configured yet on the server.' }, 500);
    }

    const body = await request.json().catch(() => null);
    const reference = body && body.reference;
    const planId = body && body.planId;

    if (!reference || typeof reference !== 'string') {
      return jsonResponse({ verified: false, error: 'Missing transaction reference.' }, 400);
    }
    if (!planId || !PLAN_PRICES_GHS.hasOwnProperty(planId)) {
      return jsonResponse({ verified: false, error: 'Unknown plan.' }, 400);
    }

    const expectedPriceGHS = getExpectedPriceGHS(planId);
    const expectedAmountPesewas = Math.round(expectedPriceGHS * 100);

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });

    if (!paystackRes.ok) {
      return jsonResponse({ verified: false, error: 'Could not reach Paystack to verify this transaction.' }, 502);
    }

    const paystackData = await paystackRes.json();
    const tx = paystackData && paystackData.data;

    if (!tx) {
      return jsonResponse({ verified: false, error: 'Paystack returned no transaction data for this reference.' }, 400);
    }

    const isSuccessful = tx.status === 'success';
    const isRightAmount = tx.amount === expectedAmountPesewas;
    const isRightCurrency = tx.currency === 'GHS';

    if (!isSuccessful) {
      return jsonResponse({ verified: false, error: `Transaction status is "${tx.status}", not successful.` }, 400);
    }
    if (!isRightCurrency) {
      return jsonResponse({ verified: false, error: 'Transaction currency does not match.' }, 400);
    }
    if (!isRightAmount) {
      return jsonResponse({
        verified: false,
        error: `Amount paid (${tx.amount / 100} ${tx.currency}) does not match the ${planId} plan price (${expectedPriceGHS} GHS).`,
      }, 400);
    }

    return jsonResponse({
      verified: true,
      reference: tx.reference,
      amountGHS: tx.amount / 100,
      paidAt: tx.paid_at,
      customerEmail: tx.customer && tx.customer.email,
    }, 200);

  } catch (err) {
    return jsonResponse({ verified: false, error: 'Unexpected error while verifying payment.' }, 500);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
