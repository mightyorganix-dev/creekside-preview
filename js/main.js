(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
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
})();
