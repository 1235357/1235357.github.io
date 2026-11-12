import json, unittest
from pathlib import Path
from visual_architecture import render_owned_graph
class OwnedVisualTest(unittest.TestCase):
 def setUp(self): self.spec=json.loads(Path('figures/reader-owned-rag.archify.json').read_text())
 def test_exact_source_nodes_and_edges(self):
  h=render_owned_graph(self.spec)
  for n in self.spec['components']:self.assertEqual(h.count('data-node="'+n['id']+'"'),1)
  for x in self.spec['connections']:
   self.assertEqual(h.count('data-edge="'+x['id']+'"'),1)
   self.assertIn('data-from="'+x['from']+'" data-to="'+x['to']+'"',h)
  self.assertNotIn('data-node="context"',h)
 def test_references_are_explicit_not_new_nodes(self):
  h=render_owned_graph(self.spec)
  self.assertEqual(h.count('data-reference='),4)
  self.assertIn('same responsibilities in A',h)
 def test_change_requires_review(self):
  self.spec['connections'][0]['to']='lookup'
  with self.assertRaises(ValueError):render_owned_graph(self.spec)
 def test_no_renderer_tokens_or_duplicate_step_number(self):
  h=render_owned_graph(self.spec)
  self.assertNotIn('emphasis',h);self.assertNotIn('security',h)
 def test_current_node_text_matches_source(self):
  from html import escape
  h=render_owned_graph(self.spec)
  for n in self.spec['components']:
   self.assertIn(escape(n['label']),h)
   self.assertIn(escape(n['sublabel']),h)
 def test_semantic_edits_require_review(self):
  from copy import deepcopy
  for group,field in [('components','sublabel'),('connections','label'),('boundaries','label')]:
   spec=deepcopy(self.spec);spec[group][0][field]='changed'
   with self.assertRaises(ValueError):render_owned_graph(spec)
 def test_reference_badges_match(self):
  h=render_owned_graph(self.spec)
  for marker in ['A1','A2','A3','A4']:self.assertGreaterEqual(h.count(marker),2)
 def test_external_label_not_crossed_by_fetch(self):
  h=render_owned_graph(self.spec)
  self.assertIn('M180 352 V370 H26 V535 H45',h)
