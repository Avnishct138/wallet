/* app.js — homepage binding (index.html) */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    const sessionEl = document.getElementById("preview-session");
    const balanceEl = document.getElementById("preview-balance");
    if (sessionEl) sessionEl.textContent = window.WalletCore.getSessionId();
    if (balanceEl) balanceEl.textContent = window.WalletCore.fmtINR(window.WalletCore.getBalance());

    // Smooth scroll for in-page anchors
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener("click", e => {
        const id = a.getAttribute("href");
        if (id && id.length > 1) {
          const target = document.querySelector(id);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      });
    });
  });
})();
