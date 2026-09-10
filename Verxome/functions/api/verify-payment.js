/* ==========================================================================
   /api/verify-payment  —  Cloudflare Pages Function
   --------------------------------------------------------------------------
   This is the piece that makes payment verification trustworthy. It runs
   on Cloudflare's servers, not in the visitor's browser, so — unlike
   everything in verxome-api.js — nothing here can be inspected, edited,
   or skipped by someone poking around in dev tools.

   What it does, every time the frontend calls it after Paystack's popup
   reports success:
     1. Takes the transaction reference and the planId the visitor claims
        they paid for.
     2. Calls Paystack's OWN verify endpoint using your SECRET key (which
        lives only in Cloudflare's environment variables — never in this
        file, never in the site's HTML/JS, never in git).
     3. Confirms Paystack's records show the transaction as genuinely
        successful.
     4. Confirms the amount actually paid matches what that plan costs —
        looked up from the PLAN_PRICES table below, not from anything the
        browser sent. This is what stops someone from paying the Warrior
        price while claiming to be a General applicant.
     5. Only if both checks pass does it tell the frontend "verified: true".
        The frontend is written to only show the success screen and send
        the admin email after getting that green light.

   ---------------------------------------------------------------------
   ONE-TIME SETUP (once you have a live Paystack Secret Key):
     1. In the Cloudflare dashboard: Workers & Pages → your Pages project
        → Settings → Environment variables
     2. Add a variable named exactly:  PAYSTACK_SECRET_KEY
        Value: your sk_test_... (while testing) or sk_live_... key
        IMPORTANT: click "Encrypt" so it's stored as a secret, not plain text
     3. Redeploy (or it applies on the next deploy automatically)
     That's it — nothing in this file needs to change.
   ---------------------------------------------------------------------
   KEEPING PRICES IN SYNC:
   This function can't "see" the PLANS object in verxome-api.js — Pages
   Functions run in a separate, isolated environment from your site's
   browser JavaScript. So the prices below are intentionally duplicated.
   If you ever change a plan's price on the site, update it here too, or
   this function will reject genuinely correct payments.
   ========================================================================== */

const PLAN_PRICES_GHS = {
  warrior: 150,
  commander: 350,
  general: 750,
};

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

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

    // Ask Paystack itself what actually happened with this reference —
    // this is the step that can't be faked from a browser.
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
      // This is the case that matters most: a real, successful payment —
      // just not for the amount this plan actually costs.
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
