import json,unittest
from pathlib import Path
from copy import deepcopy
from visual_flows import render_flow
class VisualFlowTests(unittest.TestCase):
 def test_source_coverage_and_drift(self):
  for name in ['two-lifecycles','corpus-startup','structured-income-selection','browser-native']:
   spec=json.loads(Path('figures',name+'.archify.json').read_text());h=render_flow(spec,name)
   for n in spec['components']:self.assertEqual(h.count('data-node="'+n['id']+'"'),1)
   for edge in spec['connections']:
    self.assertEqual(h.count('data-edge="'+edge['id']+'"'),1)
    self.assertIn('data-from="'+edge['from']+'" data-to="'+edge['to']+'"',h)
   changed=deepcopy(spec);changed['components'][0]['label']='changed'
   with self.assertRaises(ValueError):render_flow(changed,name)
 def test_optional_snapshot_bypass(self):
  spec=json.loads(Path('figures/corpus-startup.archify.json').read_text());h=render_flow(spec,'corpus-startup')
  self.assertIn('both</tspan><tspan x="72" dy="22">absent',h);self.assertIn('both supplied',h);self.assertNotIn('data-node="failure"',h)
 def test_quarterly_figure_precedes_detailed_evaluation(self):
  article=Path('articles/06-evaluation-labels-before-scores.md').read_text()
  self.assertLess(article.index('id="quarterly-source-selection"'),article.index('By the end of this chapter'))
  self.assertEqual(article.count('id="quarterly-source-selection"'),1)
  self.assertIn('## Keep the row and its column together',article)
  self.assertIn('8,531 checks',article)
 def test_calculation_preserves_proposed_boundary_and_alternative(self):
  from visual_flows import calculation_spec
  source=Path('figures/04-evidence-to-calculation.puml').read_text();spec=calculation_spec(source);h=render_flow(spec,'evidence-calculation')
  self.assertEqual(len(spec['components']),7);self.assertEqual(len(spec['connections']),6)
  for n in spec['components']:self.assertEqual(h.count('data-node="'+n['id']+'"'),1)
  for e in spec['connections']:self.assertEqual(h.count('data-edge="'+e['id']+'"'),1)
  self.assertEqual(h.count('stroke-dasharray="7 5"'),4)
  self.assertIn('data-from="review" data-to="hold"',h)
  self.assertNotIn('data-from="calculate" data-to="hold"',h)
  with self.assertRaises(ValueError):calculation_spec(source.replace(': ambiguous',': accepted'))

 def test_historical_design_keeps_proxy_and_return_semantics(self):
  spec=json.loads(Path('figures/browser-native.archify.json').read_text());h=render_flow(spec,'browser-native')
  self.assertIn('NOT IMPLEMENTED at that checkpoint',h)
  self.assertIn('not directly between workers',h)
  self.assertIn('data-from="computation-worker" data-to="main-thread"',h)
  self.assertEqual(h.count('stroke-dasharray="7 5"'),2)
