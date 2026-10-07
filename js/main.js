(function () {
  var doc = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Mobile menu
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  // Placeholder forms: prevent real submit, show thank-you note
  document.querySelectorAll("form[data-preview]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var box = form.querySelector("[data-form-result]");
      if (box) {
        box.hidden = false;
        box.textContent =
          "Preview only — this form does not book or charge. Please call or text 615-595-7547 or email creeksidestables@gmail.com to schedule.";
      }
      form.reset();
    });
  });

  // Sticky header: shrink + stronger backdrop once the page is scrolled (with hysteresis)
  var header = document.querySelector(".site-header");
  if (header) {
    var scrolled = false, ticking = false;
    var onScroll = function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      if (!scrolled && y > 140) { scrolled = true; header.classList.add("is-scrolled"); }
      else if (scrolled && y < 30) { scrolled = false; header.classList.remove("is-scrolled"); }
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();
  }

  // Fade / slide-up on scroll
  if (!reduceMotion && "IntersectionObserver" in window) {
    var targets = document.querySelectorAll(
      ".reveal, .side-card, .card, .callout, .figure, .stat, .form, .content > h2, .page-hero .wrap > *"
    );
    doc.classList.add("js-reveal");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    Array.prototype.forEach.call(targets, function (el, i) {
      el.classList.add("reveal");
      if (el.classList.contains("stat") || el.parentNode.classList.contains("wrap")) {
        el.style.setProperty("--d", ((i % 5) * 0.07).toFixed(2) + "s");
      }
      io.observe(el);
    });
  }
})();
