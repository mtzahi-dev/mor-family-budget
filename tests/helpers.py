"""Test helpers: a fictional plan, seed builders, and a thin wrapper around the page.

Every amount here is made up. Never copy the family's real numbers into tests.
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
APP_URL = (ROOT / 'index.html').as_uri()
MOCK_JS = Path(__file__).with_name('mock_claude.js').read_text(encoding='utf-8')
TZ = ZoneInfo('Asia/Jerusalem')
FONT_HOSTS = re.compile(r'^https://fonts\.(googleapis|gstatic)\.com/')

# income 25,500 − fixed 7,500 − card budgets 13,000 = planned gap +5,000
PLAN = {
    'income': [
        {'id': 'in_a', 'name': 'משכורת א', 'amount': 10000},
        {'id': 'in_b', 'name': 'משכורת ב', 'amount': 15000},
        {'id': 'in_kids', 'name': 'קצבת ילדים', 'amount': 500},
    ],
    'fixed': [
        {'id': 'fx_home', 'name': 'משכנתא', 'amount': 6000},
        {'id': 'fx_tax', 'name': 'ארנונה', 'amount': 1000},
        {'id': 'fx_kids', 'name': 'חוגים', 'amount': 500},
    ],
    'cards': [
        {'id': 'cc_a', 'name': 'אשראי א', 'budget': 8000},
        {'id': 'cc_b', 'name': 'אשראי ב', 'budget': 5000},
    ],
}


def local(when):
    """'2026-10-07 12:30' (Israel time) -> aware datetime."""
    return datetime.fromisoformat(when).replace(tzinfo=TZ)


def card_log(*entries):
    """card_log(('2026-10-03 09:00', 1500), ...) -> {'log': [...]} with UTC ISO times."""
    return {'log': [
        {'t': local(when).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'), 'a': amount}
        for when, amount in entries
    ]}


def seed(versions=None, cycle_day=1, months=None):
    """Documents for the fake db: the plan plus any month docs ({'2026-10': {...}})."""
    docs = {'budget/plan': {
        'cycleDay': cycle_day,
        'updatedAt': '2026-01-01T00:00:00Z',
        'versions': versions if versions is not None else {'2026-10': PLAN},
    }}
    for key, body in (months or {}).items():
        docs['months/' + key] = {'month': key, **body}
    return docs


def new_page(browser, docs=None, now='2026-10-07 12:30', can_write=True, no_db=False,
             fail_writes=None, width=390, height=844, dark=False, scale=1, block_fonts=True):
    """Open index.html with a frozen clock and the fake runtime. Returns (context, App)."""
    context = browser.new_context(
        viewport={'width': width, 'height': height}, device_scale_factor=scale,
        color_scheme='dark' if dark else 'light', locale='he-IL', timezone_id='Asia/Jerusalem')
    if block_fonts:
        context.route(FONT_HOSTS, lambda route: route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.clock.set_fixed_time(local(now))
    config = {'seed': docs or {}, 'canWrite': can_write, 'noDb': no_db, 'failWrites': fail_writes}
    page.add_init_script('window.__TEST = ' + json.dumps(config, ensure_ascii=False) + ';\n' + MOCK_JS)
    page.goto(APP_URL)
    page.wait_for_function("document.getElementById('sync').dataset.s !== 'wait'")
    page.wait_for_timeout(80)  # let the plan and months snapshots both land
    return context, App(page, errors)


class App:
    def __init__(self, page, errors):
        self.page = page
        self.errors = errors

    # reading
    def text(self, selector):
        return self.page.inner_text(selector).strip()

    @property
    def gap(self):
        return self.text('.hero-num')

    @property
    def hero_label(self):
        return self.text('.hero-label')

    @property
    def hero_sub(self):
        return self.text('.hero-sub')

    @property
    def month(self):
        return self.text('.hero-month').splitlines()[0].strip()

    @property
    def toast(self):
        return self.text('#toast')

    def card(self, card_id):
        return self.page.locator('.cr', has=self.page.locator(f'[data-id="{card_id}"]')).inner_text()

    def dump(self):
        return self.page.evaluate('window.__dump()')

    def writes(self):
        return self.page.evaluate('window.__writes')

    def card_log(self, month, card_id):
        doc = self.dump().get('months/' + month, {})
        return [e['a'] for e in doc.get('cards', {}).get(card_id, {}).get('log', [])]

    # acting
    def settle(self, ms=150):
        self.page.wait_for_timeout(ms)

    def go(self, act):
        """'prev' | 'next' | 'today' on the month card."""
        self.page.click(f'[data-act="{act}"]')
        self.settle(60)

    def tab(self, name):
        self.page.click(f'.tab[data-tab="{name}"]')
        self.settle(60)

    def update_card(self, card_id, amount, add=False):
        self.page.click(f'[data-act="card"][data-id="{card_id}"]')
        if add:
            self.page.click('#sheet [data-mode="add"]')
        self.page.fill('#sheet [data-amt]', str(amount))
        self.page.click('#sheet [data-save]')
        self.settle()

    def set_income(self, income_id, amount):
        self.page.click(f'[data-act="income"][data-id="{income_id}"]')
        self.page.fill('#sheet [data-amt]', str(amount))
        self.page.click('#sheet [data-save]')
        self.settle()

    def add_extra(self, name, amount):
        self.page.click('button[data-act="extra"]:not([data-id])')
        self.page.fill('#sheet [data-name]', name)
        self.page.fill('#sheet [data-amt]', str(amount))
        self.page.click('#sheet [data-save]')
        self.settle()
