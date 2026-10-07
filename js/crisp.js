/*
 * Crisp live-chat widget (shared by every page).
 * Standard Crisp loader: sets the website ID, then injects https://client.crisp.chat/l.js async.
 * Crisp renders its own bubble (.crisp-client) fixed bottom-right in its own stacking layer;
 * the site's sticky header (z-index 50) and mobile menu live at the top, so nothing overlaps.
 * Guarded so it only loads once even if this file were included twice.
 */
(function () {
  if (window.CRISP_WEBSITE_ID) return;
  window.$crisp = [];
  window.CRISP_WEBSITE_ID = "d2bfd652-059b-428e-b2e4-0c606777b3f8";
  var d = document;
  var s = d.createElement("script");
  s.src = "https://client.crisp.chat/l.js";
  s.async = 1;
  d.getElementsByTagName("head")[0].appendChild(s);
})();
