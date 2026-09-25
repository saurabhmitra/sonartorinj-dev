// Donation form → Worker → Stripe Checkout.
// Prod uses the LIVE worker; dev/localhost use the TEST worker (no real charges).
const DONATE_WORKERS = {
    live: "https://sonartori-checkout.saurabhmitra12.workers.dev",
    test: "https://sonartori-checkout-dev.saurabhmitra12.workers.dev",
};
const DONATE_IS_PROD = location.hostname === "sonartorinj.com" || location.hostname === "www.sonartorinj.com";
const DONATE_ENDPOINT = (DONATE_IS_PROD ? DONATE_WORKERS.live : DONATE_WORKERS.test) + "/donate";

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('donate-form');
    if (!form) return;

    const amountInput = document.getElementById('donate-amount');
    const amountBtns = document.querySelectorAll('.donate-amount-btn');
    const nameInput = document.getElementById('donate-name');
    const phoneInput = document.getElementById('donate-phone');
    const commentsInput = document.getElementById('donate-comments');
    const referredInput = document.getElementById('donate-referred');
    const submitBtn = document.getElementById('donate-submit');
    const errorEl = document.getElementById('donate-error');
    const commentsCount = document.getElementById('comments-count');
    const referredCount = document.getElementById('referred-count');

    // Preset amount buttons fill the custom field and highlight.
    amountBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            amountInput.value = btn.dataset.amount;
            amountBtns.forEach(b => b.classList.toggle('is-selected', b === btn));
            errorEl.textContent = '';
        });
    });
    amountInput.addEventListener('input', () => {
        amountBtns.forEach(b => b.classList.toggle('is-selected', b.dataset.amount === amountInput.value));
    });

    commentsInput.addEventListener('input', () => { commentsCount.textContent = commentsInput.value.length; });
    referredInput.addEventListener('input', () => { referredCount.textContent = referredInput.value.length; });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';

        const amount = Number(amountInput.value);
        if (!Number.isFinite(amount) || amount < 1) {
            errorEl.textContent = 'Please enter a donation amount of at least $1.';
            amountInput.focus();
            return;
        }
        if (!nameInput.value.trim()) {
            errorEl.textContent = 'Please enter your name.';
            nameInput.focus();
            return;
        }
        if (!commentsInput.value.trim()) {
            errorEl.textContent = 'Please tell us the reason for your donation.';
            commentsInput.focus();
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Redirecting to secure checkout…';

        try {
            const resp = await fetch(DONATE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: amount,
                    name: nameInput.value.trim(),
                    phone: phoneInput.value.trim(),
                    comments: commentsInput.value.trim(),
                    referredBy: referredInput.value.trim(),
                }),
            });
            const data = await resp.json();
            if (!resp.ok || !data.url) throw new Error(data.error || 'Donation failed');
            window.location.href = data.url;
        } catch (err) {
            errorEl.textContent = err.message + '. Please try again or contact us.';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Donate';
        }
    });
});
