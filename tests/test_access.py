"""Who can edit, and what the page does without the artifact runtime."""
from helpers import seed


def test_view_only_member_gets_no_edit_controls(open_app):
    app = open_app(seed(), can_write=False)
    assert app.page.locator('[data-act="card"]').count() == 0
    assert 'הרשאת צפייה בלבד' in app.text('.banner')
    assert app.text('#sync') == 'צפייה בלבד'


def test_refused_write_switches_the_page_to_read_only(open_app):
    app = open_app(seed(), can_write=None, fail_writes='invalid_argument')
    app.update_card('cc_a', 1000)
    assert app.toast == 'אין הרשאה לשמור שינויים בדף הזה.'
    assert app.page.locator('[data-act="card"]').count() == 0
    assert 'הרשאת צפייה בלבד' in app.text('.banner')


def test_failed_save_keeps_the_sheet_open(open_app):
    app = open_app(seed(), fail_writes='unavailable')
    app.update_card('cc_a', 1000)
    app.settle(1300)  # the app retries an "unavailable" write once, after up to a second
    assert app.toast == 'השמירה לא הצליחה. נסו שוב בעוד רגע.'
    assert app.page.locator('#sheet[open]').count() == 1
    assert app.card_log('2026-10', 'cc_a') == []


def test_without_the_artifact_runtime(open_app):
    app = open_app(seed(), no_db=True)
    assert 'הנתונים שמורים בחשבון' in app.text('#app')


def test_empty_store_offers_setup(open_app):
    app = open_app({})
    assert 'עוד לא הוגדר תכנון' in app.text('#app')
    app.page.click('#app [data-act="tab"][data-tab="plan"]')
    assert app.page.locator('[data-plan-form]').count() == 1
