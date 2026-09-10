/* ==========================================================================
   VERXOME TRADES — API LAYER
   --------------------------------------------------------------------------
   Every bit of data and business logic for the site lives here, not
   scattered across the page. Right now CONFIG.MODE is 'local', so
   everything runs against this browser's storage and the site works
   fully in preview.

   WHEN THE LIVE SERVER IS READY:
     1. Set CONFIG.MODE = 'live'
     2. Set CONFIG.API_BASE_URL to your real API URL
     3. Build the matching endpoints on your server (see the fetch calls
        below for the exact routes/methods/payloads expected)
   Nothing in the HTML needs to change — every function keeps the same
   name and return shape in both modes.
   ========================================================================== */

const VerxomeAPI = (() => {

  const CONFIG = {
    MODE: 'local', // 'local' | 'live'  <-- flip this when the backend is ready
    API_BASE_URL: '', // e.g. 'https://api.verxome.com' — required once MODE is 'live'
    STORAGE_KEY: 'verxome_applications',
    // Paystack Inline (Popup) — collects real payment straight from the
    // browser, no backend required for this part.
    //   PUBLIC_KEY: your pk_test_... (or pk_live_... when ready for real
    //     money) key from Paystack Dashboard → Settings → API Keys &
    //     Webhooks. This key is meant to be public/client-side — safe here.
    //   NEVER put your Secret Key (sk_test_... / sk_live_...) in this file
    //   or anywhere else in the website. It must only ever live on a
    //   server, and this site doesn't have one yet.
    PAYSTACK: {
      PUBLIC_KEY: 'pk_test_c670e226c4fb101d8a7ac7186634e954ebec6f01',
      CURRENCY: 'GHS',
    },
  };

  // ---------------------------------------------------------------------
  // Admin email notification (EmailJS) — fires the moment an application
  // is recorded, in BOTH local and live mode, so you get the notification
  // email even before the Paystack-backed 'live' server exists.
  //
  // This runs entirely in the visitor's browser through EmailJS's public
  // API — no backend, no secret keys. A visitor can never redirect the
  // email anywhere else; it always goes to the address baked into your
  // EmailJS template.
  //
  // SETUP (one time, ~5 minutes):
  //   1. Create a free account at https://www.emailjs.com
  //   2. Add an Email Service connected to verxomtradingroom@gmail.com
  //   3. Create an Email Template with "To email" set to
  //      verxomtradingroom@gmail.com and a body that reads exactly:
  //        Plan Type: {{plan_type}}
  //        Client name: {{client_name}}
  //        Discord Username: {{discord_username}}
  //        Email: {{client_email}}
  //        Telephone Number: {{telephone_number}}
  //      (the "message" variable below already contains this pre-built,
  //      if your template just wants one {{message}} field instead)
  //   4. Copy your Service ID, Template ID and Public Key into
  //      NOTIFY_EMAIL below and flip ENABLED to true.
  //   5. Add the EmailJS SDK script tag to the HTML <head>, above the
  //      verxome-api.js tag:
  //      <script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"></script>
  // ---------------------------------------------------------------------
  const NOTIFY_EMAIL = {
    ENABLED: true,
    SERVICE_ID: 'service_j7l0dwa',
    TEMPLATE_ID: 'template_c6e9j1w',
    PUBLIC_KEY: 'XGC53_I0LVAJO6xqh',
    TO_EMAIL: 'verxomtradingroom@gmail.com', // must match the template's "To email" too
  };

  function sendAdminNotificationEmail(application, plan) {
    if (!NOTIFY_EMAIL.ENABLED) return; // no-op until configured — never blocks a submission
    if (typeof emailjs === 'undefined') {
      console.warn('EmailJS SDK not loaded — add the emailjs <script> tag to the HTML head (see comment above NOTIFY_EMAIL).');
      return;
    }
    const planTypeLabel = plan.name.charAt(0) + plan.name.slice(1).toLowerCase(); // GENERAL -> General
    const discordHandle = application.discordUsername.startsWith('@')
      ? application.discordUsername
      : '@' + application.discordUsername;

    const templateParams = {
      to_email: NOTIFY_EMAIL.TO_EMAIL,
      plan_type: planTypeLabel,
      client_name: application.fullName,
      discord_username: discordHandle,
      client_email: application.email,
      telephone_number: application.phone,
      reference: application.reference,
      message:
        `Plan Type: ${planTypeLabel}\n` +
        `Client name: ${application.fullName}\n` +
        `Discord Username: ${discordHandle}\n` +
        `Email: ${application.email}\n` +
        `Telephone Number: ${application.phone}\n` +
        `Payment Reference: ${application.reference}`,
    };

    emailjs.send(NOTIFY_EMAIL.SERVICE_ID, NOTIFY_EMAIL.TEMPLATE_ID, templateParams, NOTIFY_EMAIL.PUBLIC_KEY)
      .catch(err => console.warn('Admin notification email failed to send:', err));
  }

  // ---------------------------------------------------------------------
  // Plans — single source of truth. The plan cards on the page and the
  // join modal are both rendered from this data, so a price or feature
  // only ever needs to change in one place.
  // ---------------------------------------------------------------------
  const PLANS = {
    warrior: {
      id: 'warrior', name: 'WARRIOR', icon: 'sword',
      price: 150, label: '6 MONTHS', stars: 3, featured: false, ribbon: null,
      includesLabel: 'INCLUDES:',
      features: [
        'Signals (XAUUSD, EURUSD, GBPUSD)',
        'Community chat & member results',
        'End of week performance breakdown',
        'Basic room access',
      ],
      buttonLabel: 'Join Warrior',
    },
    commander: {
      id: 'commander', name: 'COMMANDER', icon: 'shieldStar',
      price: 350, label: '6 MONTHS', stars: 3, featured: true, ribbon: 'MOST POPULAR',
      includesLabel: 'INCLUDES EVERYTHING IN WARRIOR, PLUS:',
      features: [
        'Advance Market Analysis',
        'Weekly live market breakdown call',
        'Priority signal alerts',
        '#commander-lounge channel',
        '"Why I took this trade" PA breakdowns',
      ],
      buttonLabel: 'Join Commander',
    },
    general: {
      id: 'general', name: 'GENERAL', icon: 'crown',
      price: 750, label: '6 MONTHS', stars: 3, featured: false, ribbon: null,
      includesLabel: 'INCLUDES EVERYTHING IN COMMANDER, PLUS:',
      features: [
        'One on one coaching session',
        'Direct DM access during market hours',
        'Personalized trade review',
      ],
      buttonLabel: 'Join General',
    },
  };

  const FAQS = [
    ['What markets do you trade?', 'We focus on XAUUSD, EURUSD and GBPUSD.'],
    ['When are signals issued?', 'Signals are generally issued Monday through Thursday according to market conditions.'],
    ['What is the difference between Warrior and Commander?', 'Warrior members receive the final trading signals. Commander members receive additional advance market analysis, giving them access to the charts and reasoning behind potential setups before the final signal is released.'],
    ['What does General include?', 'General includes everything in Commander plus one on one coaching, direct DM access during market hours and personalized trade reviews.'],
    ['Is trading risk free?', 'No. Trading involves risk. Members are responsible for their own account management, position sizing and decisions.'],
    ['Do you guarantee profits?', 'No. Verxome does not guarantee profits or future trading results.'],
    ['What payment methods are available?', 'Payments are processed through Paystack and available Ghanaian payment methods may include MTN Mobile Money, Telecel Cash and other methods supported by Paystack.'],
    ['How do I receive Discord access?', 'After successful payment and membership processing, the necessary Discord onboarding information will be provided.'],
  ];

  // ---------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------
  function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function isValidPhone(v) { return (v || '').replace(/\D/g, '').length >= 9; }

  function validateApplication(data) {
    const errors = {};
    if (!data.fullName || data.fullName.trim().length < 2) errors.fullName = 'Please enter your full legal name.';
    if (!data.discord || data.discord.trim().length < 2) errors.discord = 'Please enter your Discord username.';
    if (data.discord !== data.discord2) errors.discord2 = 'Discord usernames do not match. Please check and try again.';
    if (!isValidPhone(data.phone)) errors.phone = 'Please enter a valid telephone number.';
    if (!isValidEmail(data.email || '')) errors.email = 'Please enter a valid email address.';
    if (!data.agree) errors.agree = 'Please accept the terms to continue.';
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // ---------------------------------------------------------------------
  // Plans API
  // ---------------------------------------------------------------------
  async function getPlans() {
    if (CONFIG.MODE === 'live') {
      // Expected: GET {API_BASE_URL}/plans -> [{ id, name, icon,
      // price, label, stars, featured, ribbon, includesLabel, features[], buttonLabel }]
      // icon is one of the keys in SITE_ICONS (see the HTML) — currently 'sword', 'shieldStar' or 'crown'
      const res = await fetch(`${CONFIG.API_BASE_URL}/plans`);
      if (!res.ok) throw new Error('Failed to load plans');
      return res.json();
    }
    return Object.values(PLANS);
  }

  function getPlan(planId) {
    // Synchronous lookup used for quick UI reads (modal, validation).
    // In live mode this still reads the shape above as a local cache/fallback
    // until you wire a live "get single plan" endpoint if you need one.
    return PLANS[planId] || null;
  }

  // ---------------------------------------------------------------------
  // FAQ API
  // ---------------------------------------------------------------------
  async function getFaqs() {
    if (CONFIG.MODE === 'live') {
      // Expected: GET {API_BASE_URL}/faqs -> [[question, answer], ...]
      const res = await fetch(`${CONFIG.API_BASE_URL}/faqs`);
      if (!res.ok) throw new Error('Failed to load FAQs');
      return res.json();
    }
    return FAQS;
  }

  // ---------------------------------------------------------------------
  // Applications API
  // ---------------------------------------------------------------------
  async function submitApplication(formData) {
    const { valid, errors } = validateApplication(formData);
    if (!valid) return { success: false, errors };

    const plan = getPlan(formData.planId);
    if (!plan) return { success: false, errors: { _global: 'Invalid plan selected.' } };

    if (CONFIG.MODE === 'live') {
      // Expected: POST {API_BASE_URL}/applications
      // Body: { planId, fullName, discord, phone, email }
      // On success the server should verify payment via Paystack and
      // return the saved application record (with its own reference).
      try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          return { success: false, errors: { _global: 'Something went wrong submitting your application. Please try again.' } };
        }
        const application = await res.json();
        sendAdminNotificationEmail(application, plan);
        return { success: true, application };
      } catch (err) {
        return { success: false, errors: { _global: 'Could not reach the server. Please check your connection and try again.' } };
      }
    }

    // ---- local mode: simulate payment, store in this browser only ----
    const reference = 'LOCAL_' + Date.now().toString(36).toUpperCase() + '_' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const application = {
      reference,
      planId: plan.id,
      planName: plan.name,
      priceGHS: plan.price,
      fullName: formData.fullName.trim(),
      discordUsername: formData.discord.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      submittedAt: new Date().toISOString(),
      paymentStatus: 'SIMULATED_PAID',
    };
    const existing = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '[]');
    existing.push(application);
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(existing));
    sendAdminNotificationEmail(application, plan);
    return { success: true, application };
  }

  // ---------------------------------------------------------------------
  // Called after /api/verify-payment (a Cloudflare Pages Function) has
  // independently confirmed with Paystack's servers that this reference
  // is a real, successful charge for the correct amount — see
  // openPaystackCheckout() in the HTML and functions/api/verify-payment.js.
  // This records that already-verified reference; it no longer needs to
  // be manually cross-checked in the Paystack dashboard before sending
  // someone their Discord invite, though it's never a bad habit to glance
  // at the dashboard occasionally.
  // ---------------------------------------------------------------------
  function buildPaidApplication(formData, paystackReference) {
    const plan = getPlan(formData.planId);
    const application = {
      reference: paystackReference,
      planId: plan.id,
      planName: plan.name,
      priceGHS: plan.price,
      fullName: formData.fullName.trim(),
      discordUsername: formData.discord.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      submittedAt: new Date().toISOString(),
      paymentStatus: 'PAID_VIA_PAYSTACK',
    };
    const existing = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '[]');
    existing.push(application);
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(existing));
    sendAdminNotificationEmail(application, plan);
    return application;
  }

  async function getApplications() {
    if (CONFIG.MODE === 'live') {
      // Expected: GET {API_BASE_URL}/applications (should require admin auth on the server)
      const res = await fetch(`${CONFIG.API_BASE_URL}/applications`);
      if (!res.ok) throw new Error('Failed to load applications');
      return res.json();
    }
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '[]');
  }

  async function clearApplications() {
    if (CONFIG.MODE === 'live') {
      // Expected: DELETE {API_BASE_URL}/applications (should require admin auth on the server)
      const res = await fetch(`${CONFIG.API_BASE_URL}/applications`, { method: 'DELETE' });
      return res.ok;
    }
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    return true;
  }

  return {
    CONFIG,
    getPlans,
    getPlan,
    getFaqs,
    submitApplication,
    buildPaidApplication,
    getApplications,
    clearApplications,
    validateApplication,
    isValidEmail,
    isValidPhone,
  };
})();
