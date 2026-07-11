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
const TICKET_TYPES = {
  both_adult:  { label: "Durga Pujo 2026 — Both Days (Oct 10 & 11), Adult",     amount: 11500 },
  both_kid:    { label: "Durga Pujo 2026 — Both Days (Oct 10 & 11), Kid (6–12)", amount: 9000 },
  oct10_adult: { label: "Durga Pujo 2026 — Oct 10 Only, Adult",                 amount: 9500 },
  oct10_kid:   { label: "Durga Pujo 2026 — Oct 10 Only, Kid (6–12)",            amount: 5000 },
};

const MAX_TICKETS = 50; // sanity cap per order

// Card-processing surcharge added to the subtotal at checkout (Stripe's fee:
// 2.9% + $0.30). Computed here server-side so it can't be tampered with.
const SURCHARGE_PCT = 0.029;
const SURCHARGE_FIXED_CENTS = 30;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

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
      const diet = a?.diet === "veg" ? "Vegetarian" : "Non-Vegetarian";
      if (a?.diet === "veg") vegCount++; else nonvegCount++;
      subtotal += type.amount;

      const name = typeof a?.name === "string" ? a.name.trim().slice(0, 60) : "";
      const namePart = name ? ` — ${name}` : "";

      form.append(`line_items[${i}][quantity]`, "1");
      form.append(`line_items[${i}][price_data][currency]`, "usd");
      form.append(`line_items[${i}][price_data][unit_amount]`, String(type.amount));
      form.append(`line_items[${i}][price_data][product_data][name]`, `${type.label} (${diet})${namePart}`);
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
  },
};

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
