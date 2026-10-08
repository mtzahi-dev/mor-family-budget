"""The plan editor: versions by month, validation, unsaved edits."""
from helpers import PLAN, seed

FIRST_FIXED_AMOUNT = '[data-g="fixed"][data-f="amount"] >> nth=0'


def test_plan_change_applies_from_this_month_on(open_app):
    app = open_app(seed(versions={'2026-08': PLAN}), now='2026-10-07 12:00')
    app.tab('plan')
    app.page.fill(FIRST_FIXED_AMOUNT, '6500')
    app.page.click('[data-act="plan-save"]')
    app.settle()

    versions = app.dump()['budget/plan']['versions']
    assert sorted(versions) == ['2026-08', '2026-10']
    assert versions['2026-10']['fixed'][0] == {'id': 'fx_home', 'name': 'משכנתא', 'amount': 6500}
    assert versions['2026-08']['fixed'][0]['amount'] == 6000

    app.tab('month')
    assert app.gap == '+₪4,500'
    app.go('prev')  # September keeps the old plan
    assert app.gap == '+₪5,000'


def test_plan_saves_the_reset_day(open_app):
    app = open_app(seed(cycle_day=1))
    app.tab('plan')
    app.page.fill('[data-cycle]', '13')
    app.page.click('[data-act="plan-save"]')
    app.settle()
    assert app.dump()['budget/plan']['cycleDay'] == 13


def test_plan_refuses_a_row_without_a_name(open_app):
    app = open_app(seed())
    app.tab('plan')
    app.page.click('[data-act="plan-add"][data-g="fixed"]')
    app.page.fill('[data-g="fixed"][data-f="amount"] >> nth=-1', '300')
    app.page.click('[data-act="plan-save"]')
    app.settle(60)
    assert app.toast == 'חסר שם בשורה של הוצאות קבועות'
    assert app.page.get_attribute('[data-g="fixed"][data-f="name"] >> nth=-1', 'aria-invalid') == 'true'
    assert app.writes() == []


def test_plan_refuses_a_bad_reset_day(open_app):
    app = open_app(seed())
    app.tab('plan')
    app.page.fill('[data-cycle]', '40')
    app.page.click('[data-act="plan-save"]')
    app.settle(60)
    assert app.toast == 'יום האיפוס צריך להיות מספר בין 1 ל-28'
    assert app.writes() == []


def test_unsaved_plan_edits_survive_a_tab_switch(open_app):
    app = open_app(seed())
    app.tab('plan')
    app.page.fill('[data-g="income"][data-f="amount"] >> nth=0', '11000')
    app.tab('month')
    assert app.page.locator('.tab[data-tab="plan"] .dot').count() == 1
    app.tab('plan')
    assert app.page.input_value('[data-g="income"][data-f="amount"] >> nth=0') == '11000'
