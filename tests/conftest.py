import pytest
from playwright.sync_api import sync_playwright

from helpers import new_page


@pytest.fixture(scope='session')
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def open_app(browser):
    """open_app(docs, now=..., can_write=..., ...) -> App. Fails the test on any page error."""
    opened = []

    def _open(docs=None, **options):
        context, app = new_page(browser, docs, **options)
        opened.append((context, app))
        return app

    yield _open
    errors = [e for _, app in opened for e in app.errors]
    for context, _ in opened:
        context.close()
    assert not errors, f'page errors: {errors}'
