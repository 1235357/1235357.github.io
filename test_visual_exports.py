import unittest,tempfile,json,hashlib
from pathlib import Path
from xml.etree import ElementTree
from visual_exports import write_exports
from visual_flows import render_flow
from visual_sequences import render_sequence
class ExportTests(unittest.TestCase):
 def test_export_source_layout_and_bytes(self):
  spec=json.loads(Path('figures/two-lifecycles.archify.json').read_text(encoding='utf-8'));html=render_flow(spec,'two-lifecycles')
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);write_exports(html,'two-lifecycles',spec,root,Path('style.css').read_text(encoding='utf-8'))
   rows=json.loads((root/'two-lifecycles-exports.json').read_text(encoding='utf-8'));self.assertEqual(len(rows),2)
   for row in rows:
    data=(root/row['file']).read_bytes();root_svg=ElementTree.fromstring(data)
    self.assertIn('width',root_svg.attrib);self.assertIn('height',root_svg.attrib)
    self.assertNotIn(b'var(',data);self.assertNotIn(b'--ui:',data);self.assertIn(b'font-family:Arial,sans-serif;font-size:16px',data);self.assertNotIn(b'@font-face',data);self.assertNotIn(b'@import',data)
    self.assertNotIn(b'url(',data.replace(b'url(#',b'internal('))
    self.assertEqual(hashlib.sha256(data).hexdigest(),row['svg_sha256'])
    self.assertEqual(hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest(),row['source_digest'])
    self.assertIn(row['layout_digest'][:10],row['file'])

 def test_sequence_exports_are_valid_xml_at_natural_size(self):
  for name in ('owned-generation', 'table-cell-selection'):
   spec=json.loads(Path('figures',name+'.archify.json').read_text(encoding='utf-8'))
   html=render_sequence(spec,name)
   with tempfile.TemporaryDirectory() as d:
    output=Path(d);write_exports(html,name,spec,output,Path('style.css').read_text(encoding='utf-8'))
    rows=json.loads((output/(name+'-exports.json')).read_text(encoding='utf-8'))
    self.assertEqual(len(rows),4)
    found=[]
    for row in rows:
     data=(output/row['file']).read_bytes()
     root=ElementTree.fromstring(data)
     self.assertEqual(root.tag,'{http://www.w3.org/2000/svg}svg')
     self.assertEqual(root.get('width'),str(row['width']))
     self.assertEqual(root.get('height'),str(row['height']))
     self.assertTrue(root.get('style').endswith(f"width:{row['width']}px;height:{row['height']}px;max-width:none"))
     self.assertEqual(hashlib.sha256(data).hexdigest(),row['svg_sha256'])
     for g in root.findall('.//{http://www.w3.org/2000/svg}g[@data-message]'):
      found.append((g.get('data-message'),g.get('data-from'),g.get('data-to'),g.get('data-order')))
    self.assertEqual(found,[(m['id'],m['from'],m['to'],str(i+1)) for i,m in enumerate(spec['messages'])])

 def test_export_preserves_non_sizing_inline_style(self):
  panel='<svg viewBox="0 0 360 200" style="color:#123; width:100%;height:auto" role="img"><title>Portable &amp; valid</title></svg>'
  with tempfile.TemporaryDirectory() as d:
   output=Path(d);write_exports(panel,'inline-style',{},output,'')
   root=ElementTree.fromstring(next(output.glob('*.svg')).read_bytes())
   self.assertIn('color:#123;',root.get('style'))
   self.assertTrue(root.get('style').endswith('width:360px;height:200px;max-width:none'))

 def test_every_historical_panel_retains_visible_status_and_legend(self):
  spec=json.loads(Path('figures/browser-native.archify.json').read_text(encoding='utf-8'))
  with tempfile.TemporaryDirectory() as d:
   output=Path(d)
   write_exports(render_flow(spec,'browser-native'),'browser-native',spec,output,Path('style.css').read_text(encoding='utf-8'))
   rows=json.loads((output/'browser-native-exports.json').read_text(encoding='utf-8'))
   self.assertEqual(len(rows),3)
   for row in rows:
    root=ElementTree.fromstring((output/row['file']).read_bytes())
    ns='{http://www.w3.org/2000/svg}'
    footer=root.find(f"{ns}g[@data-export-context='true']")
    self.assertIsNotNone(footer)
    text=' '.join(footer.itertext())
    self.assertIn('Historical October 7 design',text)
    self.assertIn('NOT IMPLEMENTED',text)
    self.assertIn('not directly between workers',text)
    self.assertEqual(root.get('aria-describedby'),root.find(ns+'desc').get('id'))
    self.assertGreater(row['height'],row['panel_height'])
    self.assertEqual(root.get('viewBox'),f"0 0 {row['width']} {row['height']}")
