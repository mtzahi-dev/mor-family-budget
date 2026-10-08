# Mor family budget — notes for Claude

A Hebrew (RTL) web app where the Mor family plans the month and tracks credit-card spending against the plan. It runs on Netlify: a static page plus serverless functions, with the data in Netlify Blobs. Family members sign in with email and password, or with a passkey (fingerprint / face). Every third evening it sends a push notification about the month.

## Working with Tzahi

Tzahi owns the app. He is an engineer and project manager, not a software developer: write to him in Hebrew, in plain words, and skip code talk unless he asks for it. All UI copy is Hebrew. On Windows he uses PowerShell 5.1; for a step only he can do, give him a ready .bat file on the Desktop rather than commands.

## Files

- `public/index.html` — markup and CSS. `public/app.js` — the page logic (one IIFE). No build step. Keep scripts out of the HTML: the CSP allows only `script-src 'self'`.
- `public/core.js` — the budget math (cycle, plan versions, `compute`, the notification text). UMD: the page loads it as `window.BudgetCore`, the server imports it. Change the math here, once.
- `public/sw.js`, `public/manifest.webmanifest`, `public/*.png` — service worker (shows push notifications, caches nothing), install manifest, icons (`node dev/icons.mjs` redraws them).
- `lib/api.mjs` — the whole server: `createApi({ kv, push, now }).handle(Request)`. `lib/auth.mjs` (scrypt, codes, signed tokens), `lib/kv.mjs` (Blobs and in-memory stores, `mutate()`), `lib/push.mjs` (web-push).
- `netlify/functions/api.mjs` — serves `/api/*`. `netlify/functions/notify.mjs` — scheduled hourly; sends at 19:00 Israel time when three days have passed since the last send.
- `dev/live.mjs` — maintenance against the live store with the Netlify CLI sign-in: a new join code for an email, or a one-time import into an empty store.
- `dev/server.mjs` — local server with the same API over an in-memory store (`npm run dev`, port 5230, prints a dev sign-in). `dev/demo.mjs` — the fictional plan and seed builders used by tests and screenshots.
- `tests/*.spec.mjs` — Playwright tests (Node). `tests/screenshots.mjs` renders the screens.

## The live app

- URL: https://mor-family-budget.netlify.app (Netlify project `mor-family-budget`, team `mtzahi`; this folder is linked through `.netlify/state.json`).
- Deploy: run the tests, then `netlify deploy --prod` from the repo root. There is no build step and no git-based deploy.
- The API answers only on the site's own address (`context.site.url`); draft deploys and other hosts get 404, because every deploy shares the same Blobs store. Passkeys are bound to that address too, so adding a custom domain means re-registering them.
- The family's data lives in the site's Blobs store `budget`. Deploys never touch it.
- After deploying, tell Tzahi in one sentence what changed.
- The old claude.ai artifact (https://claude.ai/artifact/J5n31DXJya4L8eGoQwXekA) was the app until October 2026. Its db still holds the data as it was at the move; it is no longer where the family works.

## Data (Blobs store `budget`)

`budget/plan`

```json
{
  "cycleDay": 13,
  "updatedAt": "ISO time",
  "versions": {
    "YYYY-MM": {
      "income": [{ "id": "in_…", "name": "…", "amount": 0 }],
      "fixed":  [{ "id": "fx_…", "name": "…", "amount": 0 }],
      "cards":  [{ "id": "cc_…", "name": "…", "budget": 0 }]
    }
  }
}
```

- A version applies from its month until the next version. Saving the plan while viewing month M writes version M and drops any later versions, so earlier months keep their old plan.
- `cycleDay` is 1–28; 1 means the calendar month.

`months/YYYY-MM`

```json
{
  "month": "YYYY-MM",
  "cards":  { "cc_…": { "log": [{ "t": "ISO time", "a": 0 }] } },
  "income": { "in_…": 0 },
  "extras": [{ "id": "ex_…", "name": "…", "amount": 0 }]
}
```

- A card's value for the month is its latest log entry by time. Entries are running totals, not deltas ("add a charge" in the UI stores the new total). The log keeps the last 80 entries.
- `income[id]` overrides that income for this month only; `null` means back to the plan amount.
- `extras` are one-off income for this month (bonus, refund).
- Item ids are permanent because month docs point at them. Rename through `name`; never change an `id`.
- Writes go through `POST /api/doc`. The plan: `{path: 'budget/plan', patch: <whole plan>}`, validated and replaced. A month doc takes one change at a time, applied by the server to the stored doc inside a conditional write, so two people saving at once both land: `{card: {id, op: 'set'|'add'|'remove', t, a, n}}` ("add" is a charge on top of the latest total; `n` makes a retry idempotent), `{extra: {op: 'put'|'remove', id, name, amount}}`, or `{patch: {income: {id: amount|null}}}`. The doc is created when missing.

Other keys: `family/members` (members, password hashes, session ids, invite codes, passkeys), `family/secret` (token signing key), `family/used` (spent passkey challenges), `family/vapid` (push keys), `push/subs` (devices), `notify/state` (last send). The server creates the secrets on first use. Never print or copy them.

Read or fix live data only when Tzahi asks: `netlify blobs:get budget <key>` / `netlify blobs:set budget <key> --input file.json` from the linked folder. Never put the family's real amounts in git: not in tests, fixtures or docs. Their spreadsheet stays out of the repo (`.gitignore` covers spreadsheet files).

## Access

- Tzahi (`role: owner`) adds family members by email in the Settings tab; the app shows a 6-digit join code (7 days, 5 tries, one use). The same "new code" button is how someone who forgot their password gets back in. Only the owner sees and manages the list.
- Tokens are HMAC-signed, 60 days, and carry the member's random `sid`, checked on every request. A new `sid` signs out every device: joining with a code (which also drops the member's passkeys), changing the password, "sign out everywhere else", or being removed. Five wrong passwords lock the account for 15 minutes; attempts are counted before the password is checked, so parallel guesses can't get around it.
- Known limits, accepted for a family app: someone who knows a member's email can keep that account's password sign-in locked (passkey sign-in still works), and the lock reveals that the email is a member. A copied token stays valid until it expires or the `sid` changes; signing out on one device doesn't revoke it on the server.
- Passkeys: registered from Settings or the offer after a password sign-in. Each sign-in challenge is spent once (`family/used`), since synced passkeys report counter 0. On a device with a passkey the token and the data copy are kept in sessionStorage only, so every open of the app asks for the fingerprint/face and nothing stays on the phone. Without one they stay in localStorage. Settings lists every registered device and can remove any of them (a lost phone); signing out removes this device's passkey.
- Push subscriptions are accepted only for the real push services (FCM, Apple, Mozilla, Windows), at most 6 per member, and each send times out after 10 s.
- If Tzahi is locked out of the owner account (or anyone is, while he is away): `node dev/live.mjs code <email>` prints a fresh join code for that email; give it to the person. Never set a password for anyone.

## Rules the math follows (`compute` in core.js)

- Budget month M carries the card charges billed in M. With `cycleDay` D > 1 that is spending from day D of M−1 through day D−1 of M. On day D the month view moves to M+1 by itself (`curKey()`).
- Current month forecast = income (plan + overrides + extras) − fixed − Σ max(spent, budget) over the cards. In words: it assumes each card stays within budget from now on, and overspending counts in full.
- Closed month: each card's last value. A card never updated that month counts at its budget, and the month card says so.
- Future month: plan only, no update buttons.
- Pace marker on each card bar = budget × elapsed cycle days ÷ cycle length. A card is "ahead of pace" when spent > that + 5% of its budget.
- Display rounds to whole shekels; amounts are stored as entered (at most 2 decimals).
- `statusMessage` (the notification): room left under the total card budget or the total overspend, single cards already over, the month's forecast, and a reminder when no card was updated for 3+ days (or none at all this cycle from day 3). Amounts are rounded to tens and written "כ-1,250 ש״ח".

## Page code map (`public/app.js`, one IIFE)

- State: `S` — status (`auth` | `connecting` | `live` | `offline`), token, user, rev, plan, months, tab, monthKey, followCur, draft, pending, authView, bioAvail, push, members, newCode.
- Views return HTML strings: `viewMonth` → `viewHero` (with `viewStrip`), `viewCredit`, `viewIncome`, `viewFixed`; `viewHistory`; `viewPlan`; `viewSettings`; `viewAuth`. `render(force)` swaps `#app`, and skips the rebuild while the plan form has unsaved edits or the settings/sign-in forms are on screen.
- Edit sheets (`<dialog>`): `openCardSheet`, `openIncomeSheet`, `openExtraSheet`, `openPasswordSheet`, `offerBio`.
- Server: `call(method, path, data)`; `refresh()` polls `GET /api/data?rev=` every 15 s while the page is visible and someone touched it in the last 5 minutes (it keeps Netlify function calls low); `writeDoc(path, monthKey, change)` serializes writes per doc and retries once on a network or 5xx error. The device keeps a read-only copy for when the server is unreachable; sign-out clears it.
- Escape anything a person typed with `esc()`. Amounts go through `M()` / `P()`, which wrap them in `<span class="num" dir="ltr">` so ₪ and the minus sign sit correctly in RTL.

## Testing

```
npm install
npx playwright install chromium   # only if Chromium is missing
npm test
npm run screenshots                # PNGs in tests/__screenshots__/
```

- Each test starts its own in-process server with an in-memory store, and opens the page with a frozen clock (Asia/Jerusalem); see `tests/fixtures.mjs`.
- Add or update a test with every change to `core.js`, the cycle logic, the API or the sign-in flow.
- After a visual change, render the screenshots and look at them (390px wide, light and dark).

## Design

- Type: Frank Ruhl Libre for amounts and headings, IBM Plex Sans Hebrew for UI text (Google Fonts).
- Color tokens on `:root`, with dark-mode overrides. Navy month card; amber for credit cards; green for surplus; red for deficit and overspending.
- Mobile first: it must work at 360px wide with the bottom tab bar, without horizontal scrolling.
- iPhone push needs the app added to the home screen (iOS 16.4+); Settings explains this when it detects Safari in a tab.

## Settled with Tzahi

- Card cycle (confirmed 2026-10-08): spending from the 13th onward is billed in the following month, so `cycleDay` 13 is right.
- Credit total (confirmed 2026-10-08): his spreadsheet's single "bank cards" line is the right monthly credit total, not its lower per-person breakdown. The family enters each person's card budget themselves in the Plan tab; no app change.
- Card data (decided 2026-10-08): the family updates card totals by hand. No import from card-company files and no connection to card accounts.
- Hosting (decided 2026-10-08): the app moved from the claude.ai artifact to Netlify so his wife can use it without a Claude account; sign-in by email and password, with passkeys; status notifications every 3 days at 19:00.
