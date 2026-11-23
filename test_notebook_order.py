"""Source-order contracts for the shared notebook template, not browser acceptance."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
ORDER = (
    'notebook-source', 'notebook-chunks', 'notebook-vectors',
    'notebook-retrieval', 'notebook-context', 'notebook-records',
)
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}


class NotebookMarkup(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.stack = []
        self.ids = []
        self.sections = []
        self.links = []
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        identifier = attributes.get('id')
        if identifier:
            self.ids.append(identifier)
        if (tag == 'section' and self.stack
                and self.stack[-1][1].get('id') == 'computation-notebook'):
            self.sections.append(attributes)
        if tag == 'a' and any(
                ancestor == 'nav' and attrs.get('aria-label') == 'Notebook sections'
                for ancestor, attrs in self.stack):
            self.links.append(attributes.get('href'))
        if tag not in VOID:
            self.stack.append((tag, attributes))

    def handle_endtag(self, tag):
        for position in range(len(self.stack) - 1, -1, -1):
            if self.stack[position][0] == tag:
                del self.stack[position:]
                break


class NotebookOrderTest(unittest.TestCase):
    def setUp(self):
        self.html = (ROOT / 'browser-rag/inspector.html').read_text(encoding='utf-8')
        self.markup = NotebookMarkup(self.html)

    def test_sections_follow_source_to_context_order(self):
        self.assertEqual(tuple(section.get('id') for section in self.markup.sections), ORDER)

    def test_notebook_index_and_body_have_the_same_order(self):
        self.assertEqual(self.markup.links, [f'#{identifier}' for identifier in ORDER])
        self.assertEqual(self.markup.links, [f"#{section.get('id')}" for section in self.markup.sections])

    def test_each_notebook_destination_is_unique_and_programmatically_focusable(self):
        self.assertEqual(len(self.markup.sections), len(ORDER))
        for section in self.markup.sections:
            self.assertIn(section.get('id'), ORDER)
            self.assertEqual(section.get('tabindex'), '-1')
        for identifier in ORDER:
            self.assertEqual(self.markup.ids.count(identifier), 1, identifier)
        self.assertEqual(len(self.markup.ids), len(set(self.markup.ids)))

    def test_draft_controls_stay_before_the_notebook(self):
        notebook = self.html.index('<details id="computation-notebook"')
        for identifier in ('generation-title', 'generation-meta', 'generate-answer', 'generation-detail'):
            self.assertLess(self.html.index(f'id="{identifier}"'), notebook, identifier)


if __name__ == '__main__':
    unittest.main()
