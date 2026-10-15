"""Focused homepage methodology contracts, independent of model assets."""
import copy
from html.parser import HTMLParser
import json
from pathlib import Path
import unittest
from portfolio import render_home


class Elements(HTMLParser):
    def __init__(self, content):
        super().__init__()
        self.elements = []
        self.feed(content)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class MethodologyTest(unittest.TestCase):
    def setUp(self):
        self.profile = json.loads(Path(__file__).with_name('portfolio.json').read_text(encoding='utf-8'))
        self.html = render_home(self.profile)
        self.dom = Elements(self.html)

    def test_methodology_is_navigable_and_labelled(self):
        self.assertIn(('a', {'href': '#methodology'}), self.dom.elements)
        section = next(a for t, a in self.dom.elements if a.get('id') == 'methodology')
        self.assertEqual(section['aria-labelledby'], 'methodology-title')
        self.assertIn('My working cycle', self.html)
        self.assertEqual(len(self.profile['methodology']['steps']), 4)

    def test_attribution_and_separate_validation(self):
        for phrase in ['于建国', 'Dave Rensin', 'Brian Suchy', 'Elephant–Goldfish Model',
                       'separate things to verify', 'situation I have not seen before']:
            self.assertIn(phrase, self.html)
        urls = [a.get('href') for t, a in self.dom.elements if t == 'a']
        self.assertIn('https://www.modevol.com/p/xxg', urls)
        self.assertIn('https://planitpurple.northwestern.edu/event/647083', urls)
        self.assertFalse(any('xuexiguan-agent-skill' in (url or '') for url in urls))

    def test_unverified_repository_is_not_linked(self):
        profile = copy.deepcopy(self.profile)
        profile['methodology']['repository'] = None
        self.assertNotIn('egm-agent-skill', render_home(profile))

    def test_optional_verified_repository(self):
        profile = copy.deepcopy(self.profile)
        profile['methodology']['repository'] = {'label': 'Test source', 'href': 'https://example.org/verified'}
        self.assertIn('href="https://example.org/verified"', render_home(profile))

    def test_all_authored_text_is_escaped(self):
        profile = copy.deepcopy(self.profile)
        profile['methodology']['layers'][0]['title'] = '<script>alert(1)</script>'
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', render_home(profile))
        self.assertNotIn('<script>alert(1)</script>', render_home(profile))

    def test_profile_without_methodology_remains_supported(self):
        profile = copy.deepcopy(self.profile)
        del profile['methodology']
        html = render_home(profile)
        self.assertNotIn('href="#methodology"', html)
        self.assertIn('id="projects"', html)

    def test_unique_ids_and_preserved_project_frame(self):
        ids = [a['id'] for t, a in self.dom.elements if 'id' in a]
        self.assertEqual(len(ids), len(set(ids)))
        frames = [a for t, a in self.dom.elements if t == 'iframe']
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0]['src'], 'browser-rag/inspector.html')
        self.assertEqual(len(self.profile['projects']), 6)


if __name__ == '__main__':
    unittest.main()
