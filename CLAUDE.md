# Mor family budget — notes for Claude

A Hebrew (RTL) single-page app where the Mor family plans the month and tracks credit-card spending against the plan. It is published as a claude.ai Artifact and keeps its data in that artifact's `db`.

## Working with Tzahi

Tzahi owns the app. He is an engineer and project manager, not a software developer: write to him in Hebrew, in plain words, and skip code talk unless he asks for it. All UI copy is Hebrew.

## Files

- `index.html` — the whole app: markup, CSS and JS in one file, no build step. This exact file is what gets published.
- `tests/` — Playwright (Python) tests. `tests/mock_claude.js` fakes the artifact runtime (`window.claude.use`).
- `README.md` — short Hebrew overview for people.

## The live app

- URL: https://claude.ai/artifact/J5n31DXJya4L8eGoQwXekA
- Declared capabilities: `{"db": {}, "user": {}}`. On a republish, omit `capabilities` so the stored declaration carries over.
- The family's data lives in this artifact's db. Never publish a change as a new artifact: a new URL starts with an empty db.
- To ship a change: run the tests, then Artifact `publish` with `file_path: index.html` and the `url` above. A session that has not read or published this artifact is refused and handed the live version. Read it (`action: read`), diff it against `index.html`, and if they differ find out why before overwriting (someone may have published from a chat).
- If the Artifact tool is not available in your session, say so. Do not host the app anywhere else.
- After publishing, tell Tzahi in one sentence what changed. The app shows its own link card, so don't paste the URL.

## Data model (artifact db)

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

Read or fix live data with the `ArtifactData` tool and the URL above, and only when Tzahi asks; normal edits go through the UI.

Never put the family's real amounts in git: not in tests, fixtures or docs. Their spreadsheet stays out of the repo (`.gitignore` covers spreadsheet files).

## Rules the math follows (`compute(k)`)

- Budget month M carries the card charges billed in M. With `cycleDay` D > 1 that is spending from day D of M−1 through day D−1 of M. On day D the month view moves to M+1 by itself (`curKey()`).
- Current month forecast = income (plan + overrides + extras) − fixed − Σ max(spent, budget) over the cards. In words: it assumes each card stays within budget from now on, and overspending counts in full.
- Closed month: each card's last value. A card never updated that month counts at its budget, and the month card says so.
- Future month: plan only, no update buttons.
- Pace marker on each card bar = budget × elapsed cycle days ÷ cycle length. A card is "ahead of pace" when spent > that + 5% of its budget.
- Display rounds to whole shekels; amounts are stored as entered (at most 2 decimals).

## Code map (`index.html`, one IIFE)

- State: `S` — status, canWrite, plan, months, tab, monthKey, followCur, draft, pending.
- Dates and cycle: `keyOf`, `shift`, `cycleDay`, `cycleOf`, `cycleText`, `curKey`.
- Math: `planFor`, `sortedLog`, `compute`.
- Views return HTML strings: `viewMonth` → `viewHero` (with `viewStrip`), `viewCredit`, `viewIncome`, `viewFixed`; `viewHistory`; `viewPlan`. `render(force)` swaps `#app`, and skips the rebuild while the plan form has unsaved edits.
- Edit sheets (`<dialog>`): `openCardSheet`, `openIncomeSheet`, `openExtraSheet`.
- Storage: `subscribe` (onSnapshot on `budget/plan` and the `months` collection); `writeDoc(path, monthKey, patch)` serializes writes per doc and retries once on `unavailable`; month docs are `set` when missing and `update`d (merged) otherwise; `writeFailed` maps error codes to UI states. localStorage keeps a read-only copy for when the db is unavailable.
- Access: `canAct()` is true with a live db, no refused write, and `user.can('data.write')` not false. Viewers without write access see no edit controls.
- Escape anything a person typed with `esc()`. Amounts go through `M()` / `P()`, which wrap them in `<span class="num" dir="ltr">` so ₪ and the minus sign sit correctly in RTL.

## Testing

```
pip install -r requirements-dev.txt --break-system-packages
python -m playwright install chromium   # only if Chromium is missing
python -m pytest
python tests/screenshots.py              # PNGs in tests/__screenshots__/
```

- Each test opens `index.html` with a frozen clock (Asia/Jerusalem) and a seeded fake db; see `tests/helpers.py`.
- Add or update a test with every change to `compute`, the cycle logic or the storage code.
- After a visual change, render the screenshots and look at them (390px wide, light and dark).

## Design

- Type: Frank Ruhl Libre for amounts and headings, IBM Plex Sans Hebrew for UI text (Google Fonts).
- Color tokens on `:root`, with dark-mode overrides. Navy month card; amber for credit cards; green for surplus; red for deficit and overspending.
- Mobile first: it must work at 360px wide with the bottom tab bar, without horizontal scrolling.

## Open questions for Tzahi

- His spreadsheet had a single "bank cards" line that was higher than its per-person card breakdown. The app budgets per person; he has not confirmed which is right.
- The app assumes spending from the 13th onward is billed in the following month. He has not confirmed this.
