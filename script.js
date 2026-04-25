// Mobile menu toggle
document.addEventListener('DOMContentLoaded', function() {
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');

    if (hamburger) {
        hamburger.addEventListener('click', function() {
            navMenu.classList.toggle('active');
        });

        // Close menu when clicking on a link
        document.querySelectorAll('.nav-menu a').forEach(link => {
            link.addEventListener('click', function() {
                navMenu.classList.remove('active');
            });
        });
    }

    // Image carousel for past events (supports multiple carousels)
    document.querySelectorAll('.past-event-card').forEach(card => {
        const container = card.querySelector('.carousel-container');
        if (!container) return;

        const slides = card.querySelectorAll('.carousel-slide');
        const prevBtn = card.querySelector('.carousel-btn-prev');
        const nextBtn = card.querySelector('.carousel-btn-next');
        const dotsContainer = card.querySelector('.carousel-dots');
        let currentIndex = 0;

        function showSlide(index) {
            if (index >= slides.length) currentIndex = 0;
            else if (index < 0) currentIndex = slides.length - 1;
            else currentIndex = index;
            slides.forEach((s, i) => s.classList.toggle('active', i === currentIndex));
            dotsContainer.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === currentIndex));
        }

        slides.forEach((_, i) => {
            const dot = document.createElement('button');
            dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', 'Go to image ' + (i + 1));
            dot.addEventListener('click', () => showSlide(i));
            dotsContainer.appendChild(dot);
        });

        if (prevBtn) prevBtn.addEventListener('click', () => showSlide(currentIndex - 1));
        if (nextBtn) nextBtn.addEventListener('click', () => showSlide(currentIndex + 1));
    });

    // Match flyer image height to banner on wide layouts (banner drives row height)
    (function initHomePromoFlyerHeightSync() {
        const grid = document.querySelector('.home-promo-images');
        if (!grid) return;

        const imgs = grid.querySelectorAll('img');
        if (imgs.length < 2) return;

        const bannerImg = imgs[0];
        const flyerImg = imgs[1];
        const mq = window.matchMedia('(min-width: 721px)');

        function clearFlyerSizing() {
            flyerImg.style.removeProperty('height');
        }

        function sync() {
            if (!mq.matches) {
                clearFlyerSizing();
                return;
            }
            const h = bannerImg.getBoundingClientRect().height;
            if (h < 1) return;
            flyerImg.style.height = h + 'px';
        }

        let resizeTimer;
        function debouncedSync() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(sync, 50);
        }

        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(debouncedSync).observe(bannerImg);
        } else {
            window.addEventListener('resize', debouncedSync);
        }

        mq.addEventListener('change', sync);
        bannerImg.addEventListener('load', sync);
        if (bannerImg.complete) sync();
        else bannerImg.addEventListener('load', sync);
    })();
});

