/* wallet.js — dashboard UI bindings (wallet.html) */
(function () {
  "use strict";

  const W = window.WalletCore;

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toast(msg, kind = "success") {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show " + kind;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = "toast " + kind; }, 2600);
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString("hi-IN", {
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch { return iso; }
  }

  // ---------- Rendering ----------
  function refreshAll() {
    $("#balance").textContent = W.fmtINR(W.getBalance());
    $("#wallet-id").textContent = W.getUserId();
    $("#session-id").textContent = W.getSessionId();
    $("#tx-count").textContent = W.getLedger().length;
    renderTxList();
  }

  function renderTxList() {
    const list = $("#tx-list");
    const filter = $("#filter-type")?.value || "";
    const items = W.getLedger()
      .filter(t => !filter || t.type === filter)
      .slice()
      .reverse(); // newest first

    if (!items.length) {
      list.innerHTML = `
        <div class="empty">
          <svg viewBox="0 0 200 160" style="width:160px;height:120px;margin-bottom:8px"><use href="#illus-empty"/></svg>
          <div>अभी तक कोई लेन-देन नहीं।</div>
        </div>`;
      return;
    }

    list.innerHTML = items.map(tx => {
      const sign = tx.type === "send" ? "−" : "+";
      const amtClass = tx.type === "send" ? "negative" : "positive";
      const iconId =
        tx.type === "send" ? "i-send" :
        tx.type === "receive" ? "i-receive" :
        tx.type === "reward" ? "i-shield" :
        "i-arrow-up";
      const arrowIcon = tx.type === "send" ? "i-arrow-up" : "i-arrow-down";
      return `
        <div class="tx" data-id="${escapeHTML(tx.id)}">
          <div class="tx-icon ${escapeHTML(tx.type)}">
            <svg class="ico"><use href="#${iconId}"/></svg>
          </div>
          <div class="tx-main">
            <div class="tx-title">${escapeHTML(labelFor(tx))}</div>
            <div class="tx-meta">
              ${escapeHTML(tx.id)} · ${escapeHTML(fmtDate(tx.timestamp))}
              ${tx.counterparty ? " · " + escapeHTML(tx.counterparty) : ""}
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amt ${amtClass}">${sign} ${W.fmtINR(tx.amount)}</div>
            <span class="tx-status ${escapeHTML(tx.status)}">${statusLabel(tx.status)}</span>
            ${tx.type !== "reversal" && tx.status === "completed" ? `<button class="btn-danger" style="margin-top:6px;padding:4px 8px;font-size:11px" data-reverse="${escapeHTML(tx.id)}">रिवर्स</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    // Wire reverse buttons
    $$('[data-reverse]').forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-reverse");
        const tx = W.getLedger().find(t => t.id === id);
        if (!tx) return;
        const reason = prompt(`इस लेन-देन को उलटने का कारण लिखें (मूल: ${tx.id}):`, "व्यवस्थापक सुधार");
        if (reason === null) return;
        const r = W.reverse({ originalTxId: id, reason });
        if (r.ok) { toast("लेन-देन उलटा दिया गया (compensating entry बनाई गई।)"); refreshAll(); }
        else { toast(r.message || "रिवर्सल विफल।", "error"); }
      });
    });
  }

  function labelFor(tx) {
    if (tx.type === "send")     return `भेजा — ${tx.counterparty || "—"}`;
    if (tx.type === "receive")  return `प्राप्त — ${tx.counterparty || "—"}`;
    if (tx.type === "reward")   return `रिवॉर्ड — ${tx.reason}`;
    if (tx.type === "reversal") return `रिवर्सल — ${tx.reason}`;
    return tx.type;
  }
  function statusLabel(s) {
    return ({
      completed: "पूर्ण",
      failed: "विफल",
      pending: "लंबित",
      reversed: "उलटा"
    })[s] || s;
  }

  // ---------- Panel switching ----------
  function openPanel(name) {
    $$(".panel").forEach(p => p.hidden = true);
    const panel = document.getElementById("panel-" + name);
    if (panel) panel.hidden = false;
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function closeAllPanels() {
    $$(".panel").forEach(p => p.hidden = true);
  }

  // ---------- Forms ----------
  function onSend(e) {
    e.preventDefault();
    const to = $("#recv-id").value.trim();
    const amount = parseFloat($("#send-amt").value);
    const reason = $("#send-reason").value.trim();
    const idempotencyKey = $("#send-idem").value.trim() || ("send-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));

    if (!to) return toast("प्राप्तकर्ता आईडी आवश्यक।", "error");
    if (to === W.getUserId()) return toast("आप खुद को पैसे नहीं भेज सकते।", "error");
    if (!isFinite(amount) || amount <= 0) return toast("मान्य राशि दर्ज करें।", "error");
    if (!reason) return toast("कारण आवश्यक।", "error");

    const r = W.send({ to, amount, reason, idempotencyKey });
    if (r.ok) {
      toast("भेजने का लेन-देन पूरा हुआ।");
      e.target.reset();
      refreshAll();
      openPanel("history");
    } else {
      toast(r.message || "भेजने में त्रुटि।", "error");
    }
  }

  function onReceive(e) {
    e.preventDefault();
    const amount = parseFloat($("#rec-amt").value);
    const reason = $("#rec-reason").value.trim();
    if (!isFinite(amount) || amount <= 0) return toast("मान्य राशि दर्ज करें।", "error");
    if (!reason) return toast("कारण आवश्यक।", "error");
    const r = W.receive({ from: "external", amount, reason });
    if (r.ok) {
      toast("क्रेडिट जोड़ा गया।");
      e.target.reset();
      refreshAll();
    } else {
      toast(r.message || "क्रेडिट विफल।", "error");
    }
  }

  function onReward(e) {
    e.preventDefault();
    const rewardType = $("#rw-type").value;
    const amount = parseFloat($("#rw-amt").value);
    const reason = $("#rw-reason").value.trim() || rewardType;
    if (!isFinite(amount) || amount <= 0) return toast("मान्य राशि दर्ज करें।", "error");
    const r = W.claimReward({ rewardType, amount, reason });
    if (r.ok) {
      toast("रिवॉर्ड प्राप्त!");
      e.target.reset();
      $("#rw-amt").value = 10;
      refreshAll();
    } else {
      toast(r.message || "रिवॉर्ड विफल।", "warn");
    }
  }

  function exportJSON() {
    const data = W.exportJSON();
    const blob = new Blob([data], { type: "application/json" });
    downloadBlob(blob, `wallet-${W.getUserId()}-${Date.now()}.json`);
    toast("JSON निर्यात हो गया।");
  }
  function exportCSV() {
    const csv = W.exportCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `wallet-${W.getUserId()}-${Date.now()}.csv`);
    toast("CSV निर्यात हो गया।");
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function resetData() {
    if (!confirm("क्या आप वाकई सारा डेटा मिटाना चाहते हैं? यह पूर्ववत नहीं किया जा सकता।")) return;
    W.reset();
    toast("डेटा रीसेट हो गया।", "warn");
    refreshAll();
  }

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    // Initial render
    refreshAll();

    // Action buttons
    $$(".action").forEach(btn => {
      btn.addEventListener("click", () => {
        const a = btn.getAttribute("data-action");
        if (a === "history") {
          if ($("#panel-history").hidden) openPanel("history");
          else closeAllPanels();
          return;
        }
        openPanel(a);
      });
    });

    // Close buttons
    $$("[data-close]").forEach(b => b.addEventListener("click", closeAllPanels));

    // Forms
    $("#send-form").addEventListener("submit", onSend);
    $("#receive-form").addEventListener("submit", onReceive);
    $("#reward-form").addEventListener("submit", onReward);

    // Filter
    $("#filter-type")?.addEventListener("change", renderTxList);

    // Exports
    $("#export-json")?.addEventListener("click", exportJSON);
    $("#export-csv")?.addEventListener("click", exportCSV);
    $("#reset-data")?.addEventListener("click", resetData);
  });
})();
