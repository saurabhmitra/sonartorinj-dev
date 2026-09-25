/**
 * Sonar Tori — Stripe Checkout backend (Cloudflare Worker)
 *
 * The static site (GitHub Pages) POSTs a cart of attendees here. This Worker
 * builds a Stripe Checkout Session server-side using its OWN price table, so a
 * tampered cart can never change what a ticket costs. Card data is handled
 * entirely by Stripe's hosted checkout page — it never touches this Worker.
 *
 * Secrets / vars (set with `wrangler secret put` / in wrangler.toml [vars]):
 *   STRIPE_SECRET_KEY   (secret)  e.g. sk_live_...  or sk_test_...
 *   SUCCESS_URL         (var)     e.g. https://sonartorinj.com/ticket-success.html
 *   CANCEL_URL          (var)     e.g. https://sonartorinj.com/tickets.html
 *   ALLOWED_ORIGINS     (var)     comma-separated, e.g. https://sonartorinj.com,https://www.sonartorinj.com
 */

// Server-side source of truth for prices. Amounts are in cents (USD).
// The client only ever sends a ticket-type id + attendee details.
// `meal: false` = no meal served, so no veg/non-veg preference is collected.
const TICKET_TYPES = {
  both_adult:       { label: "Durga Pujo 2026 — Both Days (Oct 10 & 11), Adult",                amount: 11500 },
  both_kid:         { label: "Durga Pujo 2026 — Both Days (Oct 10 & 11), Kid (6–12)",            amount: 5000 },
  single_adult:     { label: "Durga Pujo 2026 — Single Full-Day (Oct 10), Adult",               amount: 9500 },
  single_kid:       { label: "Durga Pujo 2026 — Single Full-Day (Oct 10), Kid (6–12)",          amount: 2500 },
  single11_adult:   { label: "Durga Pujo 2026 — Single Full-Day (Oct 11), Adult",               amount: 5000 },
  single11_kid:     { label: "Durga Pujo 2026 — Single Full-Day (Oct 11), Kid (6–12)",          amount: 2500 },
  concert_adult:    { label: "Durga Pujo 2026 — Concert Only · Ms Jojo (Oct 10), Adult",       amount: 7000, meal: false },
  concert_kid:      { label: "Durga Pujo 2026 — Concert Only · Ms Jojo (Oct 10), Kid (6–12)",   amount: 2000, meal: false },
};

const MAX_TICKETS = 50; // sanity cap per order

// Card-processing surcharge added to the subtotal at checkout (Stripe's fee:
// 2.9% + $0.30). Computed here server-side so it can't be tampered with.
const SURCHARGE_PCT = 0.029;
const SURCHARGE_FIXED_CENTS = 30;

const DONATION_MIN_CENTS = 100;      // $1 minimum
const DONATION_MAX_CENTS = 2500000;  // $25,000 sanity cap

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    // Stripe calls this server-to-server (no CORS / no Origin).
    if (url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    if (url.pathname === "/donate") {
      return handleDonation(body, env, cors);
    }

    return handleTickets(body, env, cors);
  },
};

async function handleTickets(body, env, cors) {
    const attendees = Array.isArray(body?.attendees) ? body.attendees : null;
    if (!attendees || attendees.length === 0) {
      return json({ error: "Cart is empty" }, 400, cors);
    }
    if (attendees.length > MAX_TICKETS) {
      return json({ error: `Too many tickets (max ${MAX_TICKETS} per order)` }, 400, cors);
    }

    // Validate every ticket type up front against the server-side price table.
    const unknown = attendees.find((a) => !TICKET_TYPES[a?.typeId]);
    if (unknown) {
      return json({ error: `Unknown ticket type: ${unknown?.typeId}` }, 400, cors);
    }

    // Build one line item per attendee (quantity 1) so each ticket, its dietary
    // preference, and optional name show up individually on the Stripe receipt.
    const form = new URLSearchParams();
    form.append("mode", "payment");
    form.append("success_url", (env.SUCCESS_URL || "https://sonartorinj.com/ticket-success.html") + "?session_id={CHECKOUT_SESSION_ID}");
    form.append("cancel_url", env.CANCEL_URL || "https://sonartorinj.com/tickets.html");
    form.append("phone_number_collection[enabled]", "true");
    form.append("billing_address_collection", "auto");

    let vegCount = 0;
    let nonvegCount = 0;
    let subtotal = 0;

    attendees.forEach((a, i) => {
      const type = TICKET_TYPES[a.typeId];
      subtotal += type.amount;

      // Meal preference only applies to tickets that include a meal.
      let dietPart = "";
      if (type.meal !== false) {
        const diet = a?.diet === "veg" ? "Vegetarian" : "Non-Vegetarian";
        if (a?.diet === "veg") vegCount++; else nonvegCount++;
        dietPart = ` (${diet})`;
      }

      const name = typeof a?.name === "string" ? a.name.trim().slice(0, 60) : "";
      const namePart = name ? ` — ${name}` : "";

      form.append(`line_items[${i}][quantity]`, "1");
      form.append(`line_items[${i}][price_data][currency]`, "usd");
      form.append(`line_items[${i}][price_data][unit_amount]`, String(type.amount));
      form.append(`line_items[${i}][price_data][product_data][name]`, `${type.label}${dietPart}${namePart}`);
    });

    // Card-processing surcharge as its own line item (transparent on the receipt).
    const surcharge = Math.round(subtotal * SURCHARGE_PCT) + SURCHARGE_FIXED_CENTS;
    const feeIndex = attendees.length;
    form.append(`line_items[${feeIndex}][quantity]`, "1");
    form.append(`line_items[${feeIndex}][price_data][currency]`, "usd");
    form.append(`line_items[${feeIndex}][price_data][unit_amount]`, String(surcharge));
    form.append(`line_items[${feeIndex}][price_data][product_data][name]`, "Service fee");

    // Aggregate metadata for quick catering counts in the Stripe dashboard.
    form.append("metadata[event]", "Durga Pujo 2026");
    form.append("metadata[total_tickets]", String(attendees.length));
    form.append("metadata[vegetarian]", String(vegCount));
    form.append("metadata[non_vegetarian]", String(nonvegCount));
    form.append("metadata[subtotal_usd]", (subtotal / 100).toFixed(2));
    form.append("metadata[service_fee_usd]", (surcharge / 100).toFixed(2));

    let session;
    try {
      const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      session = await resp.json();
      if (!resp.ok) {
        return json({ error: session?.error?.message || "Stripe error" }, 502, cors);
      }
    } catch (err) {
      return json({ error: "Could not reach Stripe" }, 502, cors);
    }

    return json({ url: session.url }, 200, cors);
}

// ── Donations ────────────────────────────────────────────────────────────────
async function handleDonation(body, env, cors) {
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ error: "Please enter a valid donation amount." }, 400, cors);
  }
  const amountCents = Math.round(amount * 100);
  if (amountCents < DONATION_MIN_CENTS) {
    return json({ error: "Minimum donation is $1." }, 400, cors);
  }
  if (amountCents > DONATION_MAX_CENTS) {
    return json({ error: "That amount is too large — please contact us directly." }, 400, cors);
  }

  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  const comments = typeof body?.comments === "string" ? body.comments.trim().slice(0, 400) : "";
  const referredBy = typeof body?.referredBy === "string" ? body.referredBy.trim().slice(0, 100) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : "";

  if (!name) return json({ error: "Please enter your name." }, 400, cors);
  if (!comments) return json({ error: "Please tell us the reason for your donation." }, 400, cors);

  const form = new URLSearchParams();
  form.append("mode", "payment");
  form.append("success_url", (env.DONATE_SUCCESS_URL || "https://sonartorinj.com/donate-success.html") + "?session_id={CHECKOUT_SESSION_ID}");
  form.append("cancel_url", env.DONATE_CANCEL_URL || "https://sonartorinj.com/donate.html");
  form.append("phone_number_collection[enabled]", "true");
  form.append("submit_type", "donate");
  form.append("line_items[0][quantity]", "1");
  form.append("line_items[0][price_data][currency]", "usd");
  form.append("line_items[0][price_data][unit_amount]", String(amountCents));
  form.append("line_items[0][price_data][product_data][name]", "Donation to Sonar Tori");
  form.append("metadata[type]", "donation");
  form.append("metadata[donor_name]", name);
  form.append("metadata[phone]", phone);
  form.append("metadata[comments]", comments);
  form.append("metadata[referred_by]", referredBy);
  form.append("metadata[amount_usd]", (amountCents / 100).toFixed(2));
  // Mirror onto the PaymentIntent so it's visible on the charge too.
  form.append("payment_intent_data[metadata][type]", "donation");
  form.append("payment_intent_data[metadata][donor_name]", name);

  let session;
  try {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    session = await resp.json();
    if (!resp.ok) {
      return json({ error: session?.error?.message || "Stripe error" }, 502, cors);
    }
  } catch (err) {
    return json({ error: "Could not reach Stripe" }, 502, cors);
  }

  return json({ url: session.url }, 200, cors);
}

// ── Stripe webhook → admin email on completed donations ──────────────────────
async function handleWebhook(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature") || "";

  const valid = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  if (event?.type === "checkout.session.completed") {
    const s = event.data?.object || {};
    const m = s.metadata || {};
    if (m.type === "donation") {
      try {
        await emailAdminDonation(s, m, env);
      } catch (err) {
        // Log but still 200 — the donation itself succeeded; Stripe holds the record.
        console.log("donation email failed:", err && err.message);
      }
    }
  }
  return new Response("ok", { status: 200 });
}

async function emailAdminDonation(session, m, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const amount = "$" + ((session.amount_total || 0) / 100).toFixed(2);
  const name = m.donor_name || session.customer_details?.name || "—";
  const phone = m.phone || session.customer_details?.phone || "—";
  const email = session.customer_details?.email || "—";
  const comments = m.comments || "—";
  const referredBy = m.referred_by || "—";

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
      <h2 style="color:#7a1f2b;margin:0 0 12px">New donation received</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td style="font-weight:bold">Amount</td><td>${esc(amount)}</td></tr>
        <tr><td style="font-weight:bold">Donor Name</td><td>${esc(name)}</td></tr>
        <tr><td style="font-weight:bold">Phone</td><td>${esc(phone)}</td></tr>
        <tr><td style="font-weight:bold">Email</td><td>${esc(email)}</td></tr>
        <tr><td style="font-weight:bold;vertical-align:top">Comments</td><td>${esc(comments)}</td></tr>
        <tr><td style="font-weight:bold">Referred By</td><td>${esc(referredBy)}</td></tr>
      </table>
    </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.DONATION_FROM || "Sonar Tori <donations@sonartorinj.com>",
      to: [env.ADMIN_EMAIL || "admin@sonartorinj.com"],
      subject: `New donation — ${amount} from ${name}`,
      html,
    }),
  });
  if (!resp.ok) throw new Error("Resend " + resp.status + " " + (await resp.text()));
}

// Verify Stripe's `stripe-signature` header (HMAC-SHA256 of `t.payload`).
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!secret || !sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // Reject events older than 5 minutes (replay protection).
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare.
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "https://sonartorinj.com,https://www.sonartorinj.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.includes(origin) || /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/i.test(origin)
      ? origin
      : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
