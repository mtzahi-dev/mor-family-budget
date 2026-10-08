"""Closed months, future months and the history list."""
from helpers import PLAN, card_log, seed


def test_closed_month_uses_last_value_and_budget_for_missing_cards(open_app):
    docs = seed(versions={'2026-09': PLAN}, months={'2026-09': {'cards': {
        'cc_a': card_log(('2026-09-20 10:00', 6000), ('2026-09-29 10:00', 9000)),
    }}})
    app = open_app(docs, now='2026-10-07 12:00')
    app.go('prev')
    assert app.hero_label == 'סיכום ספטמבר'
    assert app.gap == '+₪4,000'  # 25,500 − 7,500 − (9,000 + 5,000 counted at budget)
    assert 'אין עדכון לאשראי ב' in app.hero_sub


def test_future_month_shows_the_plan_only(open_app):
    app = open_app(seed())
    app.go('next')
    assert app.hero_label == 'תכנון לנובמבר'
    assert app.gap == '+₪5,000'
    assert app.page.locator('[data-act="card"]').count() == 0


def test_history_lists_months_and_averages_the_closed_ones(open_app):
    docs = seed(versions={'2026-08': PLAN}, months={
        '2026-08': {'cards': {'cc_a': card_log(('2026-08-30 10:00', 9000)),
                              'cc_b': card_log(('2026-08-30 10:00', 5500))}},
        '2026-09': {'cards': {'cc_a': card_log(('2026-09-29 10:00', 7000)),
                              'cc_b': card_log(('2026-09-29 10:00', 4000))}},
    })
    app = open_app(docs, now='2026-10-07 12:00')
    app.tab('history')
    months = app.page.locator('.h-month').all_inner_texts()
    assert [m.split('\n')[0].strip() for m in months] == ['אוקטובר 2026', 'ספטמבר 2026', 'אוגוסט 2026']
    summary = app.text('.summary')
    assert 'ב-2 החודשים שנסגרו' in summary
    assert 'פער ממוצע +₪5,250' in summary  # August +3,500, September +7,000
    assert 'ב-1 מהם' in summary  # only August went over the card budget

    app.page.click('[data-act="goto"][data-k="2026-08"]')
    app.settle(60)
    assert app.hero_label == 'סיכום אוגוסט'
    assert app.gap == '+₪3,500'
