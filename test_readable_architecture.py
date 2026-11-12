import unittest,json
from pathlib import Path
from readable_architecture import render_relationship_map
class ReadableArchitectureTest(unittest.TestCase):
 def test_all_nodes_and_edges_preserved(self):
  s=json.loads(Path('figures/reader-owned-rag.archify.json').read_text());h=render_relationship_map(s,'reader-owned')
  for n in s['components']:self.assertEqual(h.count('id="reader-owned-'+n['id']+'"'),1)
  for e in s['connections']:self.assertEqual(h.count('data-edge="'+e['id']+'"'),1);self.assertIn('href="#reader-owned-'+e['to']+'"',h)
 def test_no_miniature_svg_or_script(self):
  s=json.loads(Path('figures/reader-owned-rag.archify.json').read_text());h=render_relationship_map(s,'reader-owned');self.assertNotIn('<svg',h);self.assertNotIn('<script',h)
 def test_invalid_endpoint_rejected(self):
  with self.assertRaises(ValueError):render_relationship_map({'components':[],'connections':[{'from':'x','to':'y'}]},'x')

class AllReadingMapsTest(unittest.TestCase):
 def test_each_declared_relationship_survives(self):
  from readable_architecture import render_reading_map
  for p in Path('figures').glob('*.archify.json'):
   d=json.loads(p.read_text());h=render_reading_map(d,p.stem)
   edges=d.get('connections',d.get('messages',d.get('transitions',[])))
   for edge in edges:self.assertEqual(h.count('data-edge="'+edge['id']+'"'),1,p.name)

class SemanticGroupsTest(unittest.TestCase):
 def test_boundary_lane_and_segment_names_survive(self):
  from readable_architecture import render_reading_map
  from html import escape
  for p in Path('figures').glob('*.archify.json'):
   d=json.loads(p.read_text());h=render_reading_map(d,p.stem)
   for group in d.get('boundaries',[])+d.get('lanes',[])+d.get('segments',[]):
    self.assertIn(escape(group['label']),h,p.name)
 def test_calculation_flow_from_editable_source(self):
  from readable_architecture import render_calculation_reading
  h=render_calculation_reading(Path('figures/04-evidence-to-calculation.puml').read_text(),'calculation')
  self.assertEqual(h.count('data-edge='),6)
  self.assertIn('proposed',h);self.assertIn('implemented',h)
  self.assertIn('ambiguous',h);self.assertIn('Do not accept',h)
