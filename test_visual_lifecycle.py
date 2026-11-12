import json,unittest
from pathlib import Path
from visual_lifecycle import render_lifecycle
class LifecycleVisualTest(unittest.TestCase):
 def test_all_source_edges_including_returns(self):
  s=json.loads(Path('figures/browser-operation.archify.json').read_text(encoding='utf-8'));h=render_lifecycle(s)
  for n in s['states']:self.assertEqual(h.count('data-node="'+n['id']+'"'),1)
  for x in s['transitions']:
   self.assertEqual(h.count('data-edge="'+x['id']+'"'),1)
   self.assertIn('data-from="'+x['from']+'" data-to="'+x['to']+'"',h)
  self.assertIn('not a step after',h)
 def test_changed_return_rejected(self):
  s=json.loads(Path('figures/browser-operation.archify.json').read_text(encoding='utf-8'));s['transitions'][-1]['to']='idle'
  with self.assertRaises(ValueError):render_lifecycle(s)
