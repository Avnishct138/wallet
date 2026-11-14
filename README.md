# वॉलेट (Wallet) — GitHub-Ready Frontend Demo

एक secure, auditable, ledger-आधारित digital wallet का **frontend-only demo**।
यह repository production-ready backend के लिए एक clean starting point है — पूरी
business logic पहले से implement है, बस storage layer को server-side ledger से बदलना है।

---

## 📂 Project Structure

```
wallet-repo/
├── index.html          # Landing / marketing page (Hindi)
├── wallet.html         # Dashboard — send / receive / reward / history
├── css/
│   └── styles.css      # All styles (CSS variables, glassmorphism, responsive)
├── js/
│   ├── wallet-core.js  # ⚙️ Business logic — ledger, validation, idempotency
│   ├── wallet.js       # 🎛️ Dashboard UI bindings (forms, panels, render)
│   └── app.js          # 🏠 Homepage bindings (preview, smooth scroll)
├── assets/
│   └── favicon.svg     # Inline SVG favicon (no external icon font)
└── .nojekyll           # GitHub Pages: serve as static (skip Jekyll)
```

### Layer separation
- **Frontend (`index.html`, `wallet.html`, `css/`, `assets/`)** — pure presentation।
  कोई business logic नहीं, कोई balance math नहीं, कोई ledger access नहीं।
- **Business logic (`js/wallet-core.js`)** — एक ही module जो **सारे** wallet operations
  handle करता है (send/receive/reward/reversal)। UI इसी से बात करता है।
- **UI bindings (`js/wallet.js`, `js/app.js`)** — सिर्फ rendering + event handling।
  कोई validation या ledger write नहीं — हर action `WalletCore` के through जाता है।

---

## ⚙️ What the wallet currently does

| Feature | Status | Notes |
|---|---|---|
| उपयोगकर्ता session / wallet ID | ✅ Auto-generated, persistent (localStorage) | Server-side पर यह auth से आएगा |
| बैलेंस display | ✅ Derived from validated ledger | Never stored directly |
| पैसे भेजना (Send) | ✅ Limits, balance, idempotency | Daily outflow cap enforced |
| पैसे प्राप्त करना (Receive) | ✅ Per-tx cap | Source field for audit |
| रिवॉर्ड / बोनस | ✅ Per-tx + per-day cap + cooldown | Predefined rules |
| Transaction history | ✅ Filterable, searchable | Newest-first |
| Idempotency / duplicate protection | ✅ Idempotency key per tx | Returns existing if duplicate |
| Failed tx handling | ✅ Audited but no balance change | |
| Reversal (compensating tx) | ✅ Original marked reversed | Immutable |
| JSON / CSV export | ✅ | |
| Audit log | ✅ Last 200 events in localStorage | Production → server |
| Inline SVG icons | ✅ Zero external icon font | 13 custom symbols |

---

## 🚀 How to run it locally

### Option A — Direct file open (simplest)
```
# Just open index.html in your browser
# No build step required — pure HTML / CSS / JS
```

### Option B — Local web server (recommended for module loading / proper origins)
```bash
# Python 3
cd wallet-repo
python3 -m http.server 8080

# Node.js (if you have npx)
npx serve -p 8080 .

# Then open http://localhost:8080
```

### Option C — Deploy to GitHub Pages
1. Push to GitHub: `git init && git add . && git commit -m "init" && git remote add origin <url> && git push -u origin main`
2. Repo Settings → Pages → Source: `main` branch, `/` root
3. URL: `https://<username>.github.io/<repo>/`

> The included `.nojekyll` file tells GitHub Pages to serve the repo as static files
> without Jekyll preprocessing (important — otherwise files starting with `_` get ignored).

---

## 🗄️ Current data storage method

**Frontend-only `localStorage`:**

| Key | Purpose |
|---|---|
| `wallet.ledger.v1` | JSON array of all transactions |
| `wallet.session.v1` | Session ID (`SES-XXXXXXXX`) |
| `wallet.userId.v1` | Wallet ID (`WLT-XXXXXXXX`) |
| `wallet.audit.v1` | Last 200 audit events |
| `wallet.state.v1` | Reserved (not actively used) |

> ⚠️ **Not for production.** `localStorage` is browser-local and can be modified by the
> user. In production, ledger MUST live on the server. The current storage layer is
> intentionally isolated inside `wallet-core.js` so it can be swapped with HTTP calls.

---

## ⚠️ Current limitations (honest list)

1. **No authentication.** Session is auto-generated. Anyone can claim a wallet ID.
2. **No real backend.** All data is in `localStorage` and is per-browser, per-device.
3. **No multi-user / cross-device sync.** Different browsers = different wallets.
4. **No payments.** "Receive" is a manual demo credit, not connected to any payment gateway.
5. **No encryption at rest.** Plain JSON in `localStorage`.
6. **No server-side validation.** All rules run in-browser; a malicious user could edit
   `wallet-core.js` and bypass them. **Server-side enforcement is mandatory for production.**
7. **No 2FA / KYC / AML / fraud detection.**
8. **No rate-limiting at the network level** (rate-limit logic exists in code but is trivially bypassable in browser).
9. **No real-time sync** between tabs beyond `storage` events.
10. **No accessibility audit beyond basics** (ARIA labels on toast & nav only).

---

## 🛠️ What still needs a backend / database

For a production-grade wallet, the following MUST be added **before** any real money flows:

### Backend service
- [ ] **Authentication** (email/password, OAuth, 2FA, magic link)
- [ ] **KYC / identity verification** for regulatory compliance
- [ ] **Server-side ledger** (PostgreSQL with double-entry accounting)
- [ ] **Atomic transactions** (`BEGIN ... COMMIT`, row-level locks)
- [ ] **Idempotency table** (key + endpoint + user, expires after 24h)
- [ ] **Authorization layer** (user owns wallet → can debit only their own)
- [ ] **Audit log** (append-only, signed, exportable)
- [ ] **Rate limiting** (per-IP, per-user, per-endpoint)
- [ ] **Fraud detection** (velocity checks, geo, device fingerprint)

### Database schema (sketch)
```
users         (id, email, kyc_status, created_at)
wallets       (id, user_id, balance_cached, currency, created_at)  -- balance is derived in queries
ledger        (id, wallet_id, type, amount, status, idempotency_key UNIQUE, prev_balance, post_balance, reason, counterparty_wallet_id, created_at)
audit_log     (id, actor_id, event, payload, ip, user_agent, created_at)
idempotency   (key UNIQUE, user_id, endpoint, response_hash, created_at, expires_at)
reversals     (id, original_tx_id UNIQUE, reversal_tx_id, reason, created_at)
```

### API endpoints (REST sketch)
```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/wallet                 # balance + wallet info
GET    /api/wallet/ledger          # paginated history
POST   /api/wallet/transactions    # { type, amount, reason, idempotencyKey }
POST   /api/wallet/transactions/:id/reverse
GET    /api/admin/audit-log        # admin only
```

### Migration path from this demo
1. Replace `WalletCore._loadLedger` / `_persistLedger` with `fetch()` calls to the
   server endpoints above.
2. Move all business rules (limits, validation) into the **backend** — the frontend
   copy becomes a UX optimization, not the source of truth.
3. Add JWT-based auth headers to every request.
4. Add `Idempotency-Key` header per request.
5. Remove `localStorage` writes entirely from `wallet-core.js`.

---

## 🔒 Security principles (already wired into the demo)

These rules are enforced **in `wallet-core.js`** and will continue to apply once the
storage layer is replaced:

> 1. **No balance mutation without a ledger entry.** Every change goes through `_commit()`.
> 2. **Every transaction is uniquely identified** (`TX-<uuid>`) with timestamp, userId,
>    amount, type, status, and reason.
> 3. **Duplicate protection via idempotency keys.** Same key → returns existing tx.
> 4. **Validate authorization, balance, limits, and status** before any commit.
> 5. **Failed/rejected transactions never modify the balance.**
> 6. **Completed transactions are immutable.** Corrections use a new compensating
>    transaction (`type: reversal`), never an edit.
> 7. **Displayed balance is derived** from validated ledger data.
> 8. **Frontend code never writes balances or ledger directly** — it only calls
>    authorized backend operations through `WalletCore`.
> 9. **Secrets / API keys / DB credentials are NEVER in this repo.** `.gitignore`
>    protects `.env*` and other sensitive patterns.

---

## 📜 License

This is a demo / starter kit. Add your own license (MIT / Apache-2.0 / proprietary) before publishing.

---

## 🤝 Contributing

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/some-feature`)
3. Commit your changes (`git commit -m 'Add some feature'`)
4. Push to the branch (`git push origin feature/some-feature`)
5. Open a pull request

> **Please don't commit secrets.** Run `git status` before every push.
