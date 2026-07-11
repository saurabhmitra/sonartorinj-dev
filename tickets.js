// Durga Pujo 2026 ticket cart.
// Prices shown here are for display only — the Cloudflare Worker re-checks every
// price server-side, so nothing here can change what a ticket actually costs.

// ── Set this to your deployed Worker URL (see worker/README.md) ──────────────
const CHECKOUT_ENDPOINT = "https://sonartori-checkout.saurabhmitra12.workers.dev";
// ─────────────────────────────────────────────────────────────────────────────

// Cart is kept in sessionStorage so it survives refreshes and tabbing away and
// back, then clears itself when the browser session ends or checkout succeeds.
const CART_STORAGE_KEY = 'sonartori_cart_v1';

// Card-processing surcharge shown at checkout. MUST match the Worker's values
// (SURCHARGE_PCT / SURCHARGE_FIXED_CENTS in worker/checkout.js) so the displayed
// total equals what Stripe charges.
const SURCHARGE_PCT = 0.029;
const SURCHARGE_FIXED_CENTS = 30;

document.addEventListener('DOMContentLoaded', function () {
    const cart = document.getElementById('ticket-cart');
    if (!cart) return;

    // Build a display map (id -> {label, price}) from the ticket-type cards.
    const types = {};
    cart.querySelectorAll('.ticket-type').forEach(el => {
        types[el.dataset.type] = {
            label: el.querySelector('.ticket-type-name').textContent.trim(),
            price: Number(el.dataset.price),
        };
    });

    // { key, typeId, name, diet } — restored from sessionStorage if present.
    let attendees = loadCart();
    let seq = attendees.reduce((m, a) => Math.max(m, a.key), 0);

    function loadCart() {
        try {
            const raw = sessionStorage.getItem(CART_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            // Drop anything whose ticket type no longer exists (e.g. prices changed).
            return parsed
                .filter(a => a && types[a.typeId])
                .map(a => ({
                    key: Number(a.key) || 0,
                    typeId: a.typeId,
                    name: typeof a.name === 'string' ? a.name : '',
                    diet: a.diet === 'veg' ? 'veg' : 'nonveg',
                }));
        } catch {
            return [];
        }
    }

    function saveCart() {
        try {
            sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(attendees));
        } catch { /* storage unavailable — cart just won't persist */ }
        if (typeof window.updateCartBadge === 'function') window.updateCartBadge();
    }

    const itemsEl = document.getElementById('cart-items');
    const emptyEl = document.getElementById('cart-empty');
    const subtotalEl = document.getElementById('cart-subtotal');
    const feeEl = document.getElementById('cart-fee');
    const totalEl = document.getElementById('cart-total');
    const checkoutBtn = document.getElementById('checkout-btn');
    const errorEl = document.getElementById('checkout-error');

    function money(cents) {
        const d = cents / 100;
        return '$' + (Number.isInteger(d) ? d.toString() : d.toFixed(2));
    }

    cart.querySelectorAll('.ticket-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const typeId = btn.closest('.ticket-type').dataset.type;
            attendees.push({ key: ++seq, typeId, name: '', diet: 'nonveg' });
            saveCart();
            render();
        });
    });

    function removeAttendee(key) {
        const i = attendees.findIndex(a => a.key === key);
        if (i !== -1) attendees.splice(i, 1);
        saveCart();
        render();
    }

    function render() {
        errorEl.textContent = '';

        if (attendees.length === 0) {
            emptyEl.style.display = '';
            itemsEl.querySelectorAll('.cart-item').forEach(n => n.remove());
            subtotalEl.textContent = '$0';
            feeEl.textContent = '$0.00';
            totalEl.textContent = '$0';
            checkoutBtn.disabled = true;
            return;
        }
        emptyEl.style.display = 'none';

        // Rebuild the item rows.
        itemsEl.querySelectorAll('.cart-item').forEach(n => n.remove());
        let subtotalCents = 0;

        attendees.forEach(a => {
            const t = types[a.typeId];
            subtotalCents += t.price * 100;

            const row = document.createElement('div');
            row.className = 'cart-item';
            row.innerHTML = `
                <div class="cart-item-top">
                    <span class="cart-item-name">${t.label}</span>
                    <span class="cart-item-price">$${t.price}</span>
                    <button type="button" class="cart-item-remove" aria-label="Remove ticket">&times;</button>
                </div>
                <div class="cart-item-fields">
                    <input type="text" class="cart-item-nameinput" placeholder="Attendee name (optional)" maxlength="60">
                    <div class="cart-item-diet" role="group" aria-label="Meal preference">
                        <button type="button" class="diet-btn" data-diet="veg">Veg</button>
                        <button type="button" class="diet-btn is-selected" data-diet="nonveg">Non-Veg</button>
                    </div>
                </div>`;

            const nameInput = row.querySelector('.cart-item-nameinput');
            nameInput.value = a.name;
            nameInput.addEventListener('input', () => { a.name = nameInput.value; saveCart(); });

            row.querySelectorAll('.diet-btn').forEach(db => {
                db.classList.toggle('is-selected', db.dataset.diet === a.diet);
                db.addEventListener('click', () => {
                    a.diet = db.dataset.diet;
                    row.querySelectorAll('.diet-btn').forEach(x =>
                        x.classList.toggle('is-selected', x.dataset.diet === a.diet));
                    saveCart();
                });
            });

            row.querySelector('.cart-item-remove').addEventListener('click', () => removeAttendee(a.key));
            itemsEl.appendChild(row);
        });

        const feeCents = Math.round(subtotalCents * SURCHARGE_PCT) + SURCHARGE_FIXED_CENTS;
        subtotalEl.textContent = money(subtotalCents);
        feeEl.textContent = money(feeCents);
        totalEl.textContent = money(subtotalCents + feeCents);
        checkoutBtn.disabled = false;
    }

    checkoutBtn.addEventListener('click', async () => {
        if (attendees.length === 0) return;
        errorEl.textContent = '';
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = 'Redirecting to secure checkout…';

        try {
            const resp = await fetch(CHECKOUT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    attendees: attendees.map(a => ({
                        typeId: a.typeId,
                        diet: a.diet,
                        name: a.name.trim(),
                    })),
                }),
            });
            const data = await resp.json();
            if (!resp.ok || !data.url) throw new Error(data.error || 'Checkout failed');
            window.location.href = data.url;
        } catch (err) {
            errorEl.textContent = err.message + '. Please try again or contact us.';
            checkoutBtn.disabled = false;
            checkoutBtn.textContent = 'Checkout';
        }
    });

    render();
});
