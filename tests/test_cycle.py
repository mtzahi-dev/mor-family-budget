"""Card charges reset on cycleDay: spending from that day on belongs to the next month."""
from helpers import card_log, seed


def test_day_before_reset_is_the_last_day_of_the_cycle(open_app):
    app = open_app(seed(cycle_day=13), now='2026-10-12 21:00')
    assert app.month == 'אוקטובר 2026'
    assert 'חיובי אשראי 13.9–12.10' in app.text('.hero-month')
    assert 'יום 30 מתוך 30' in app.text('.sec-note')


def test_reset_day_moves_to_the_next_month(open_app):
    app = open_app(seed(cycle_day=13), now='2026-10-13 07:00')
    assert app.month == 'נובמבר 2026'
    assert 'חיובי אשראי 13.10–12.11' in app.text('.hero-month')
    assert 'יום 1 מתוך 31' in app.text('.sec-note')
    app.go('prev')
    assert app.hero_label == 'סיכום אוקטובר'


def test_spending_after_reset_is_saved_to_the_next_month(open_app):
    docs = seed(cycle_day=13, months={'2026-10': {'cards': {'cc_b': card_log(('2026-10-11 10:00', 4800))}}})
    app = open_app(docs, now='2026-10-20 10:00')
    app.update_card('cc_b', 1200)
    assert app.card_log('2026-11', 'cc_b') == [1200]
    assert app.card_log('2026-10', 'cc_b') == [4800]


def test_cycle_day_1_is_the_calendar_month(open_app):
    app = open_app(seed(cycle_day=1), now='2026-10-07 12:00')
    assert 'חיובי אשראי' not in app.text('.hero-month')
    assert 'יום 7 מתוך 31' in app.text('.sec-note')
