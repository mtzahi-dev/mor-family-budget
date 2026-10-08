"""Render the main screens to tests/__screenshots__/ for a visual check.

    python tests/screenshots.py

Uses the same fake runtime and fictional plan as the tests. Fonts load from Google Fonts
when the network allows it; otherwise the fallback fonts show.
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import PLAN, card_log, new_page, seed

OUT = Path(__file__).with_name('__screenshots__')

DOCS = seed(versions={'2026-08': PLAN}, cycle_day=13, months={
    '2026-08': {'cards': {'cc_a': card_log(('2026-08-11 20:00', 8700)),
                          'cc_b': card_log(('2026-08-12 09:00', 5600))}},
    '2026-09': {'cards': {'cc_a': card_log(('2026-09-12 21:00', 7400)),
                          'cc_b': card_log(('2026-09-12 21:00', 4100))},
                'extras': [{'id': 'ex_1', 'name': 'החזר הוצאות', 'amount': 650}]},
    '2026-10': {'cards': {'cc_a': card_log(('2026-10-02 08:30', 5200), ('2026-10-07 09:45', 6900)),
                          'cc_b': card_log(('2026-10-05 17:20', 2300))}},
})


def shoot(browser, name, prepare=None, **options):
    context, app = new_page(browser, DOCS, now='2026-10-07 12:30', scale=2, block_fonts=False, **options)
    app.page.wait_for_timeout(600)  # web fonts
    if prepare:
        prepare(app)
    app.page.screenshot(path=str(OUT / f'{name}.png'), full_page=True)
    context.close()
    if app.errors:
        raise SystemExit(f'{name}: page errors {app.errors}')
    print('wrote', OUT / f'{name}.png')


def open_card_sheet(app):
    app.page.click('[data-act="card"][data-id="cc_a"]')
    app.page.fill('#sheet [data-amt]', '7300')
    app.settle(250)


def main():
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        shoot(browser, 'month-light')
        shoot(browser, 'month-dark', dark=True)
        shoot(browser, 'month-360', width=360, height=760)
        shoot(browser, 'card-sheet', open_card_sheet)
        shoot(browser, 'history', lambda app: app.tab('history'))
        shoot(browser, 'plan', lambda app: app.tab('plan'))
        browser.close()


if __name__ == '__main__':
    main()
