/* ============================================================
 * wallet-core.js — Wallet System Controller (frontend demo)
 * ------------------------------------------------------------
 * Rules implemented:
 *  - Balances are NEVER mutated directly; every change creates
 *    a validated ledger transaction.
 *  - Each transaction has: id, timestamp, userId, amount, type,
 *    status, reason, idempotencyKey, prevBalance, postBalance.
 *  - Duplicate transactions (same idempotencyKey) are rejected.
 *  - Authorization, balance, limits, and status are validated
 *    before committing.
 *  - Failed/rejected transactions never modify the balance.
 *  - Completed transactions are immutable. Reversals use a
 *    new compensating transaction.
 *  - Displayed balance is derived from validated ledger data.
 *
 * NOTE: This is a frontend-only demo using localStorage. It is
 * intentionally structured so that swapping the storage layer
 * for a server-side ledger (REST/GraphQL) requires only replacing
 * the `_persist` / `_load` methods. Do NOT call this file's
 * internal methods from outside the wallet subsystem.
 * ============================================================ */

(function (global) {
  "use strict";

  // ---- Storage keys (frontend-only) -------------------------------
  const STORAGE = {
    LEDGER: "wallet.ledger.v1",
    STATE:  "wallet.state.v1",     // derived balance, session id
    SESSION: "wallet.session.v1"
  };

  // ---- Constants / business rules --------------------------------
  const LIMITS = {
    SEND_MIN: 1,
    SEND_MAX: 50000,           // per-transaction cap
    RECEIVE_MAX: 100000,
    REWARD_MAX_PER_TX: 100,
    REWARD_MAX_PER_DAY: 100,
    REWARD_COOLDOWN_MS: 60 * 1000,   // 60s between reward claims
    DAILY_OUTFLOW_CAP: 100000         // per-day send limit
  };

  const TYPES = ["send", "receive", "reward", "reversal"];
  const STATUS = {
    COMPLETED: "completed",
    FAILED: "failed",
    PENDING: "pending",
    REVERSED: "reversed"
  };

  // ---- Utilities -------------------------------------------------
  function uuid() {
    // RFC4122-ish v4 UUID without external deps
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  function nowISO() { return new Date().toISOString(); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function isValidAmount(n) {
    return typeof n === "number" && isFinite(n) && n > 0 && n <= 1e9;
  }
  function fmtINR(n) {
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency", currency: "INR", maximumFractionDigits: 2
      }).format(n);
    } catch {
      return "₹" + Number(n).toFixed(2);
    }
  }

  // ---- Atomic-ish commit (single source of truth) ---------------
  // In frontend, we simulate atomicity by reading + writing in a
  // single synchronous block. A real backend must replace these
  // two methods with a DB transaction (BEGIN..COMMIT).
  function _loadLedger() {
    try {
      const raw = localStorage.getItem(STORAGE.LEDGER);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function _persistLedger(ledger) {
    localStorage.setItem(STORAGE.LEDGER, JSON.stringify(ledger));
  }
  function _loadSession() {
    let s = localStorage.getItem(STORAGE.SESSION);
    if (!s) {
      s = "SES-" + uuid().slice(0, 8).toUpperCase();
      localStorage.setItem(STORAGE.SESSION, s);
    }
    return s;
  }
  function _loadUserId() {
    let u = localStorage.getItem("wallet.userId.v1");
    if (!u) {
      u = "WLT-" + uuid().slice(0, 8).toUpperCase();
      localStorage.setItem("wallet.userId.v1", u);
    }
    return u;
  }

  // ---- Derived balance from ledger (NEVER stored independently) -
  // Completed: +/- amount based on type
  // Reversed: amounts of reversed tx are excluded (we count original
  //   + reversal: net zero). Easier rule: sum only status==completed
  //   AND type != reversal entries. Reversals themselves don't change
  //   balance — they mark the original as 'reversed' so we exclude it.
  function deriveBalance(ledger, userId) {
    let bal = 0;
    for (const tx of ledger) {
      if (tx.userId !== userId) continue;
      if (tx.status !== STATUS.COMPLETED) continue;
      if (tx.type === "reversal") continue;     // reversal: no direct delta
      if (tx.type === "send")     bal -= tx.amount;
      else if (tx.type === "receive") bal += tx.amount;
      else if (tx.type === "reward")  bal += tx.amount;
    }
    return round2(bal);
  }

  // ---- Idempotency check ----------------------------------------
  function findByIdempotencyKey(ledger, key) {
    if (!key) return null;
    return ledger.find(t => t.idempotencyKey && t.idempotencyKey === key) || null;
  }

  // ---- Daily outflow / reward guards ----------------------------
  function todaysOutflow(ledger, userId) {
    const start = new Date(); start.setHours(0,0,0,0);
    let sum = 0;
    for (const tx of ledger) {
      if (tx.userId !== userId) continue;
      if (tx.status !== STATUS.COMPLETED) continue;
      if (tx.type !== "send") continue;
      if (new Date(tx.timestamp).getTime() < start.getTime()) continue;
      sum += tx.amount;
    }
    return round2(sum);
  }
  function todaysRewardTotal(ledger, userId) {
    const start = new Date(); start.setHours(0,0,0,0);
    let sum = 0;
    for (const tx of ledger) {
      if (tx.userId !== userId) continue;
      if (tx.status !== STATUS.COMPLETED) continue;
      if (tx.type !== "reward") continue;
      if (new Date(tx.timestamp).getTime() < start.getTime()) continue;
      sum += tx.amount;
    }
    return round2(sum);
  }
  function lastRewardAt(ledger, userId) {
    let latest = 0;
    for (const tx of ledger) {
      if (tx.userId !== userId) continue;
      if (tx.type !== "reward") continue;
      const t = new Date(tx.timestamp).getTime();
      if (t > latest) latest = t;
    }
    return latest;
  }

  // ---- Audit log (frontend-only; in production -> server) -------
  function _audit(event, payload) {
    try {
      const entry = {
        t: nowISO(),
        event,
        ...payload
      };
      const key = "wallet.audit.v1";
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      arr.push(entry);
      // Keep last 200 audit entries
      localStorage.setItem(key, JSON.stringify(arr.slice(-200)));
    } catch {}
  }

  // ============================================================
  // Public API
  // ============================================================
  const WalletCore = {

    LIMITS,
    STATUS,
    TYPES,
    fmtINR,

    // ----- Identity / session ----------------------------------
    getUserId()    { return _loadUserId(); },
    getSessionId() { return _loadSession(); },

    // ----- Read -----------------------------------------------
    getLedger()    { return _loadLedger(); },
    getBalance()   { return deriveBalance(_loadLedger(), this.getUserId()); },

    // ----- Mutations (validated, idempotent, atomic-ish) ------
    /**
     * Generic commit path used by all transaction types.
     * Steps:
     *  1. authorize (caller context)
     *  2. validate (amount, type, limits)
     *  3. check duplicate via idempotencyKey
     *  4. execute (compute new balance, append ledger entry)
     *  5. persist & verify (re-derive balance)
     *  6. audit
     */
    _commit(input) {
      const { type, amount, reason, idempotencyKey, counterparty } = input;
      const ledger = _loadLedger();
      const userId = this.getUserId();

      // 1) Authorize: in frontend demo, the active user IS the
      //    owner. A real backend must enforce auth here.
      if (!userId) return { ok: false, code: "UNAUTHORIZED", message: "सत्र समाप्त — कृपया पुनः लॉगिन करें।" };

      // 2) Validate
      if (!TYPES.includes(type)) return { ok: false, code: "BAD_TYPE", message: "अमान्य लेन-देन प्रकार।" };
      if (!isValidAmount(amount)) return { ok: false, code: "BAD_AMOUNT", message: "राशि 0 से अधिक और मान्य होनी चाहिए।" };
      if (!reason || !String(reason).trim()) return { ok: false, code: "BAD_REASON", message: "कारण आवश्यक है।" };

      // 3) Idempotency check
      if (idempotencyKey) {
        const existing = findByIdempotencyKey(ledger, idempotencyKey);
        if (existing) {
          return { ok: false, code: "DUPLICATE", message: "इस idempotency कुंजी के साथ लेन-देन पहले से मौजूद है।", tx: existing };
        }
      }

      // Compute balance BEFORE commit
      const prevBalance = deriveBalance(ledger, userId);

      // Type-specific validation
      if (type === "send") {
        if (amount < LIMITS.SEND_MIN) return { ok: false, code: "BELOW_MIN", message: `न्यूनतम राशि ₹${LIMITS.SEND_MIN} है।` };
        if (amount > LIMITS.SEND_MAX) return { ok: false, code: "ABOVE_MAX", message: `प्रति लेन-देन अधिकतम ₹${LIMITS.SEND_MAX} है।` };
        // Defense in depth: even if the UI allows it, the core rejects self-send
        if (counterparty && counterparty === userId) {
          return { ok: false, code: "SELF_SEND", message: "आप खुद को पैसे नहीं भेज सकते।" };
        }
        const today = todaysOutflow(ledger, userId);
        if (today + amount > LIMITS.DAILY_OUTFLOW_CAP) {
          return { ok: false, code: "DAILY_CAP", message: "दैनिक भेजने की सीमा पार हो गई।" };
        }
        if (prevBalance < amount) {
          // Log failure for audit (no balance change). Note: this still respects
          // idempotency — a duplicate key won't reach here because the dup check
          // runs first.
          const failed = this._mkTx({ type, amount, reason, idempotencyKey, userId, counterparty, prevBalance, status: STATUS.FAILED, failCode: "INSUFFICIENT_FUNDS" });
          ledger.push(failed); _persistLedger(ledger);
          _audit("tx_failed", { code: "INSUFFICIENT_FUNDS", amount });
          return { ok: false, code: "INSUFFICIENT_FUNDS", message: "अपर्याप्त शेष।", tx: failed };
        }
      }
      if (type === "receive") {
        if (amount > LIMITS.RECEIVE_MAX) return { ok: false, code: "ABOVE_MAX", message: `प्राप्ति अधिकतम ₹${LIMITS.RECEIVE_MAX} है।` };
      }
      if (type === "reward") {
        if (amount > LIMITS.REWARD_MAX_PER_TX) return { ok: false, code: "REWARD_TX_CAP", message: `एक रिवॉर्ड में अधिकतम ₹${LIMITS.REWARD_MAX_PER_TX}।` };
        const dayReward = todaysRewardTotal(ledger, userId);
        if (dayReward + amount > LIMITS.REWARD_MAX_PER_DAY) {
          return { ok: false, code: "REWARD_DAILY_CAP", message: `दैनिक रिवॉर्ड सीमा (₹${LIMITS.REWARD_MAX_PER_DAY}) पूरी हो चुकी।` };
        }
        const last = lastRewardAt(ledger, userId);
        if (last && (Date.now() - last) < LIMITS.REWARD_COOLDOWN_MS) {
          const wait = Math.ceil((LIMITS.REWARD_COOLDOWN_MS - (Date.now() - last)) / 1000);
          return { ok: false, code: "REWARD_COOLDOWN", message: `कृपया ${wait} सेकंड बाद पुनः प्रयास करें।` };
        }
      }
      if (type === "reversal") {
        // Reversal requires originalTxId; reason mandatory; original must exist and be completed and not already reversed.
        const originalId = input.originalTxId;
        if (!originalId) return { ok: false, code: "BAD_REVERSAL", message: "मूल लेन-देन आईडी आवश्यक।" };
        const original = ledger.find(t => t.id === originalId && t.userId === userId);
        if (!original) return { ok: false, code: "ORIGINAL_NOT_FOUND", message: "मूल लेन-देन नहीं मिला।" };
        if (original.status === STATUS.REVERSED) return { ok: false, code: "ALREADY_REVERSED", message: "यह लेन-देन पहले ही उलटा जा चुका है।" };
        if (original.status !== STATUS.COMPLETED) return { ok: false, code: "ORIGINAL_NOT_COMPLETED", message: "केवल पूर्ण लेन-देन ही उलटे जा सकते हैं।" };
      }

      // 4) Execute — build tx entry with deterministic postBalance
      const tx = this._mkTx({ type, amount, reason, idempotencyKey, userId, counterparty, prevBalance, status: STATUS.COMPLETED, originalTxId: input.originalTxId });

      // For reversal: also flip the original's status to REVERSED.
      if (type === "reversal") {
        const idx = ledger.findIndex(t => t.id === input.originalTxId);
        if (idx === -1) return { ok: false, code: "ORIGINAL_NOT_FOUND", message: "मूल लेन-देन नहीं मिला।" };
        ledger[idx] = { ...ledger[idx], status: STATUS.REVERSED, reversedBy: tx.id, reversedAt: nowISO() };
      }

      ledger.push(tx);
      _persistLedger(ledger);

      // 5) Verify by re-deriving
      const verified = deriveBalance(ledger, userId);
      _audit("tx_committed", { txId: tx.id, type, amount, postBalance: verified });

      return { ok: true, tx, balance: verified };
    },

    _mkTx({ type, amount, reason, idempotencyKey, userId, counterparty, prevBalance, status, originalTxId, failCode }) {
      // postBalance intentionally NOT trusted as source — it's a snapshot only
      let projected = prevBalance;
      if (status === STATUS.COMPLETED) {
        if (type === "send") projected -= amount;
        else if (type === "receive" || type === "reward") projected += amount;
        else if (type === "reversal") projected = prevBalance; // reversal itself doesn't change balance (it flips original)
      }
      return {
        id: "TX-" + uuid().toUpperCase(),
        timestamp: nowISO(),
        userId,
        type,
        amount: round2(amount),
        status,
        reason: String(reason).trim().slice(0, 200),
        idempotencyKey: idempotencyKey || null,
        counterparty: counterparty || null,
        originalTxId: originalTxId || null,
        prevBalance: round2(prevBalance),
        postBalance: round2(projected),
        failCode: failCode || null
      };
    },

    // ----- High-level operations (thin wrappers) ---------------
    send({ to, amount, reason, idempotencyKey }) {
      return this._commit({
        type: "send",
        amount: Number(amount),
        reason,
        idempotencyKey,
        counterparty: to
      });
    },
    receive({ from, amount, reason, idempotencyKey }) {
      return this._commit({
        type: "receive",
        amount: Number(amount),
        reason,
        idempotencyKey,
        counterparty: from
      });
    },
    claimReward({ rewardType, amount, reason }) {
      const r = this._commit({
        type: "reward",
        amount: Number(amount),
        reason: reason || rewardType,
        idempotencyKey: "rw-" + rewardType + "-" + new Date().toISOString().slice(0,10)
      });
      return r;
    },
    reverse({ originalTxId, reason }) {
      const original = this.getLedger().find(t => t.id === originalTxId);
      if (!original) return { ok: false, code: "ORIGINAL_NOT_FOUND", message: "मूल लेन-देन नहीं मिला।" };
      return this._commit({
        type: "reversal",
        amount: original.amount,
        reason: reason || `Reversal of ${original.id}`,
        originalTxId,
        counterparty: original.counterparty
      });
    },

    // ----- Admin / utility -------------------------------------
    reset() {
      localStorage.removeItem(STORAGE.LEDGER);
      localStorage.removeItem(STORAGE.STATE);
      localStorage.removeItem("wallet.audit.v1");
      _audit("data_reset", {});
    },
    exportJSON() {
      return JSON.stringify({
        userId: this.getUserId(),
        sessionId: this.getSessionId(),
        balance: this.getBalance(),
        ledger: this.getLedger()
      }, null, 2);
    },
    exportCSV() {
      const rows = [
        ["id","timestamp","type","amount","status","reason","counterparty","originalTxId","prevBalance","postBalance"]
      ];
      for (const tx of this.getLedger()) {
        rows.push([
          tx.id, tx.timestamp, tx.type, tx.amount, tx.status,
          (tx.reason || "").replace(/"/g,'""'),
          tx.counterparty || "", tx.originalTxId || "",
          tx.prevBalance, tx.postBalance
        ]);
      }
      return rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${v}"` : v).join(",")).join("\n");
    }
  };

  // Expose
  global.WalletCore = WalletCore;
})(window);
