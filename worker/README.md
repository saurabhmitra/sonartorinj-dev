# Sonar Tori — Stripe Checkout Worker

The website (GitHub Pages) is static and can't hold a Stripe **secret** key. This
tiny Cloudflare Worker is the only server-side piece: it takes the cart, creates a
Stripe Checkout Session, and returns the hosted-payment URL. Card data is handled
entirely by Stripe — it never touches this Worker or the website.

## Prices live here, not in the browser
`TICKET_TYPES` in `checkout.js` is the source of truth for prices. The browser only
sends a ticket-type id + attendee details, so a tampered cart can't change a price.
To change prices, edit `TICKET_TYPES` (amounts are in **cents**) and redeploy.

## One-time setup

1. **Install the CLI and log in** (free Cloudflare account):
   ```
   npm install -g wrangler
   wrangler login
   ```

2. **Add your Stripe secret key** (from Stripe Dashboard → Developers → API keys).
   Use `sk_test_...` first to test, then `sk_live_...` for real sales:
   ```
   cd worker
   wrangler secret put STRIPE_SECRET_KEY
   ```

3. **Deploy:**
   ```
   wrangler deploy
   ```
   Wrangler prints a URL like `https://sonartori-checkout.<your-subdomain>.workers.dev`.

4. **Point the site at the Worker.** Open `tickets.js` and set:
   ```js
   const CHECKOUT_ENDPOINT = "https://sonartori-checkout.<your-subdomain>.workers.dev";
   ```

## Testing without spending money
Use your Stripe **test** secret key in step 2, then on the checkout page use card
`4242 4242 4242 4242`, any future expiry, any CVC. Switch the secret to the live key
when you're ready to sell.

## Where orders show up
Stripe Dashboard → Payments. Each attendee is a separate line item showing ticket
type + Veg/Non-Veg (+ name if entered). Order-level metadata has total tickets and
vegetarian / non-vegetarian counts for catering. Phone + email are collected by
Stripe at checkout.
