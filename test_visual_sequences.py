import unittest,json,re,copy,xml.etree.ElementTree as ET
from pathlib import Path
from visual_sequences import render_sequence
ROOT=Path(__file__).resolve().parent / 'figures'
class SequenceTests(unittest.TestCase):
    def test_all_source_messages_and_directions(self):
        for name in ['owned-generation','table-cell-selection']:
            spec=json.loads((ROOT/(name+'.archify.json')).read_text());html=render_sequence(spec,name)
            svgs=re.findall(r'<svg\b.*?</svg>',html,re.S)
            self.assertEqual(len(svgs),len(spec['segments']))
            found=[]
            for svg in svgs:
                root=ET.fromstring(svg)
                self.assertEqual(len(root.findall('.//g[@data-participant]')),len(spec['participants']))
                for g in root.findall('.//g[@data-message]'):
                    found.append((g.attrib['data-message'],g.attrib['data-from'],g.attrib['data-to'],int(g.attrib['data-order'])))
                self.assertNotIn('foreignObject',svg)
            self.assertEqual(found,[(m['id'],m['from'],m['to'],i+1) for i,m in enumerate(spec['messages'])])
    def test_cancel_is_alternative(self):
        s=json.loads((ROOT/'owned-generation.archify.json').read_text());html=render_sequence(s,'owned-generation')
        panels=re.findall(r'<svg\b.*?</svg>',html,re.S)
        self.assertIn('data-alternative="true"',panels[3]);self.assertIn('not a next success step',panels[3])
        self.assertNotIn('Continues in phase 4',panels[2]);self.assertIn('End of this path',panels[2])
    def test_source_change_fails_closed(self):
        s=json.loads((ROOT/'owned-generation.archify.json').read_text());s['messages'][0]['to']='native'
        with self.assertRaises(ValueError):render_sequence(s,'owned-generation')
    def test_scoped_text_styles_win_host_specificity(self):
        from visual_sequences import STYLE
        for name in ['title','role','message','note']:
            self.assertIn('.sq-panel .sq-'+name+'{font-family:Arial,sans-serif;', STYLE)
        self.assertIn('.sq-panel .sq-message{font-family:Arial,sans-serif;font-size:18px;font-weight:400;', STYLE)

    def test_labels_and_return_semantics(self):
        for name in ['owned-generation','table-cell-selection']:
            s=json.loads((ROOT/(name+'.archify.json')).read_text());html=render_sequence(s,name)
            self.assertEqual(html.count('class="sq-line sq-return"'),sum(m.get('variant')=='return' for m in s['messages']))
            self.assertIn('font-size:18px',html)
if __name__=='__main__':unittest.main()
