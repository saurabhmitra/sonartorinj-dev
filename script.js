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
});

