"""The current month: forecast, card updates, income changes."""
from helpers import card_log, seed


def test_planned_gap_before_any_card_update(open_app):
    app = open_app(seed())
    assert app.month == 'אוקטובר 2026'
    assert app.hero_label == 'צפי לסוף אוקטובר'
    assert app.gap == '+₪5,000'
    assert 'עוד לא עודכן החודש' in app.card('cc_a')


def test_card_running_total_and_added_charge(open_app):
    app = open_app(seed())
    app.update_card('cc_a', 3000)
    app.update_card('cc_a', 500, add=True)
    assert app.card_log('2026-10', 'cc_a') == [3000, 3500]
    assert [w['op'] for w in app.writes()] == ['set', 'update']  # month doc created once, then merged
    assert app.gap == '+₪5,000'  # still within budget, so the forecast holds
    assert 'נותר ₪4,500' in app.card('cc_a')


def test_overspending_counts_in_full(open_app):
    app = open_app(seed())
    app.update_card('cc_b', 6200)
    assert app.gap == '+₪3,800'
    assert 'חריגה של ₪1,200' in app.hero_sub
    assert 'חריגה של ₪1,200' in app.card('cc_b')


def test_pace_warning_when_spending_runs_ahead(open_app):
    # 7 of 31 days gone: an even pace would be about ₪1,806 of ₪8,000
    app = open_app(seed(), now='2026-10-07 12:00')
    app.update_card('cc_a', 4000)
    assert 'מעל הקצב השווה' in app.card('cc_a')
    app.update_card('cc_a', 1500)
    assert 'מעל הקצב השווה' not in app.card('cc_a')


def test_income_override_extra_payment_and_reset(open_app):
    app = open_app(seed())
    app.set_income('in_b', 16000)
    assert app.gap == '+₪6,000'
    assert 'שונה החודש' in app.text('[data-act="income"][data-id="in_b"]')

    app.add_extra('בונוס', 2000)
    assert app.gap == '+₪8,000'

    app.page.click('[data-act="income"][data-id="in_b"]')
    app.page.click('#sheet [data-reset]')
    app.settle()
    assert app.gap == '+₪7,000'
    month = app.dump()['months/2026-10']
    assert month['income']['in_b'] is None
    assert [(x['name'], x['amount']) for x in month['extras']] == [('בונוס', 2000)]


def test_delete_a_wrong_update(open_app):
    docs = seed(months={'2026-10': {'cards': {
        'cc_a': card_log(('2026-10-02 09:00', 1500), ('2026-10-05 09:00', 15000)),
    }}})
    app = open_app(docs)
    app.page.click('[data-act="card"][data-id="cc_a"]')
    newest = app.page.locator('#sheet [data-del]').first
    newest.click()  # first tap asks
    newest.click()  # second tap deletes
    app.settle()
    assert app.card_log('2026-10', 'cc_a') == [1500]
    assert app.toast == 'העדכון נמחק'
