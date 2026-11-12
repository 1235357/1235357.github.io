"""Chapter 05 evidence and native reflow contracts, not browser acceptance."""
from pathlib import Path
from html.parser import HTMLParser
import unittest
import json
import re
import html
import markdown

ROOT = Path(__file__).resolve().parent

class Elements(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.elements = []
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

class GenerationTraceTest(unittest.TestCase):
    def setUp(self):
        self.raw = (ROOT / 'articles/05-generation-is-not-verification.md').read_text(encoding='utf-8')
        self.figure = self.raw.split('<figure class="generation-trace"', 1)[1].split('</figure>', 1)[0]
        self.css = (ROOT / 'style.css').read_text(encoding='utf-8')

    def test_observation_and_unestablished_claims_stay_together(self):
        for fact in ('1,745 input IDs', '33 output IDs', '16,599', 'E4', 'UNVERIFIED', 'unestablished', 'normal end-of-sequence'):
            self.assertIn(fact, self.figure)
        self.assertIn('Question, paraphrased:', self.figure)
        self.assertIn('fiscal 2025 second-quarter report', self.figure)
        self.assertIn('not a new experiment or a screenshot', self.figure)

    def test_verdict_precedes_process_and_source_details_are_collapsed(self):
        self.assertLess(self.figure.index('id="trace-verdict"'), self.figure.index('class="trace-question"'))
        self.assertIn('Execution passed. The financial claim is still unverified.', self.figure)
        self.assertIn('href="#trace-flow"', self.figure)
        nodes = Elements('<figure'+self.figure).elements
        audit = [attrs for tag,attrs in nodes if tag == 'details' and attrs.get('class') == 'trace-audit']
        self.assertEqual(len(audit), 1)
        self.assertNotIn('open', audit[0])

    def test_one_source_and_no_svg_or_step_heading_levels(self):
        self.assertEqual(self.figure.count('https://github.com/'), 2)
        self.assertEqual(self.figure.count('<li>'), 4)
        self.assertNotRegex(self.figure, r'<(?:h[1-6]|svg|iframe|script)\b')
        self.assertNotIn('<style>', self.raw)

    def test_markdown_retains_native_figure_and_four_steps(self):
        rendered = markdown.markdown(self.raw.split('---\n', 2)[2], extensions=['fenced_code', 'tables', 'toc'])
        nodes = Elements(rendered).elements
        self.assertEqual(sum(tag == 'figure' and attrs.get('class') == 'generation-trace' for tag, attrs in nodes), 1)
        self.assertEqual(sum(attrs.get('class') == 'trace-step-title' for _, attrs in nodes), 4)
        self.assertIn('fictional FY2024/FY2025 exercise', rendered)

    def test_real_excerpts_match_archived_e4_with_explicit_normalization(self):
        archive = json.loads((ROOT / 'docs/acceptance-2026-10-11/public-d75-native-raw.json').read_text(encoding='utf-8'))
        evidence = archive['preparedPrompt']['modelInput']['evidence']
        e4 = next(e for e in evidence if e['citationId'] == 'E4')
        excerpts = re.findall(r'data-range="(\d+):(\d+)"><small>.*?</small><span>(.*?)</span>', self.figure)
        self.assertEqual(len(excerpts), 4)
        for start, end, shown in excerpts:
            self.assertEqual(html.unescape(shown), ' '.join(e4['text'].encode('utf-16-le')[int(start)*2:int(end)*2].decode('utf-16-le').split()))
        self.assertIn('Whitespace collapsed; no table columns reconstructed.', self.figure)
        self.assertNotIn('<table', self.figure)
        self.assertIn('Condensed Consolidated Statements of Comprehensive Income', e4['text'])
        self.assertIn('Source statement: Condensed Consolidated Statements of Comprehensive Income.', self.figure)
        self.assertIn('<b>citations</b><strong>["E4"]</strong>', self.figure)
        self.assertIn('visually rearranged; citations remains an array', self.figure)
        prompt_excerpt = re.search(r'class="trace-prompt">“(.*?)”</blockquote>', self.figure).group(1)
        self.assertIn(prompt_excerpt, archive['preparedPrompt']['messages'][0]['content'])
        self.assertEqual(len(archive['promptTokenIds']), 1745)
        self.assertEqual(len(archive['generatedTokenIds']), 33)
        returned = json.loads(archive['text'])
        self.assertEqual(returned, {'answer': '16,599', 'citations': ['E4'], 'insufficient_evidence': False})
        inspection = json.loads((ROOT / 'docs/acceptance-2026-10-11/public-d75-output-inspection.json').read_text(encoding='utf-8'))
        self.assertEqual(inspection['outputInspection'], 'shape-and-citation-identity-accepted')
        self.assertEqual(inspection['claimSupport'], 'unestablished')
        self.assertEqual(inspection['financialCorrectness'], 'unestablished')

    def test_execution_and_support_verdicts_are_not_conflated(self):
        self.assertIn('id="trace-inspection"', self.figure)
        self.assertIn('trace-review', self.figure)
        self.assertIn('Financial support: unestablished.', self.figure)
        self.assertIn('model’s “false” is a claim', self.figure)
        self.assertIn('This figure does not establish that match.', self.figure)
        self.assertIn('grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)', self.css)
        self.assertIn('flex-wrap: wrap', self.css)

    def test_connectors_name_real_endpoints_and_explanation_is_not_a_verifier(self):
        nodes = Elements('<figure'+self.figure).elements
        ids = {attrs['id'] for _, attrs in nodes if 'id' in attrs}
        transfers = [attrs for _, attrs in nodes if attrs.get('class') == 'trace-transfer']
        self.assertEqual(len(transfers), 5)
        for edge in transfers:
            self.assertIn(edge['data-from'], ids)
            self.assertIn(edge['data-to'], ids)
        self.assertEqual(transfers[0]['data-to'], 'trace-retrieval')
        self.assertEqual(transfers[-1]['data-to'], 'trace-draft')
        self.assertIn('unresolved evidence relationship, not a running verifier', self.figure)
        self.assertIn('href="#trace-e4"', self.figure)
        self.assertIn('.trace-explanation { display:block; position:static; top:auto; align-self:stretch; max-height:none; overflow:visible', self.css)
        self.assertIn('.trace-source:target', self.css)

    def test_scoped_reflow_css_uses_native_type_and_no_scaling(self):
        rules = self.css.split('/* Chapter 05: reflowable recorded-evidence trace. */', 1)[1]
        self.assertIn('font: 1rem/1.55 var(--ui)', rules)
        self.assertIn('overflow-wrap: anywhere', rules)
        self.assertIn('min-width: 0', rules)
        self.assertNotIn('transform:', rules)
        self.assertNotRegex(rules, r'(?<!-)width:\s*\d+px')

if __name__ == '__main__':
    unittest.main()
