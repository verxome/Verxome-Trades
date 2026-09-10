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
    if (!env.PAYSTACK_SECRET_KEY) {
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

    const expectedAmountPesewas = Math.round(PLAN_PRICES_GHS[planId] * 100);

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
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
        error: `Amount paid (${tx.amount / 100} ${tx.currency}) does not match the ${planId} plan price (${PLAN_PRICES_GHS[planId]} GHS).`,
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
