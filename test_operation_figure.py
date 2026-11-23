"""Authored lane-label contracts; browser/export geometry is checked separately."""
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent
SVG = '{http://www.w3.org/2000/svg}'


class OperationFigureTest(unittest.TestCase):
    def setUp(self):
        self.html = (ROOT / 'figures/browser-operation.archify.html').read_text(encoding='utf-8')
        self.spec = json.loads((ROOT / 'figures/browser-operation.archify.json').read_text(encoding='utf-8'))
        # Only the authored diagram, not toolbar icons or runtime strings.
        start = self.html.index('<!-- Lifecycle bands -->')
        end = self.html.index('<!-- Primary lifecycle rail -->', start)
        self.labels = ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">'
                                    + self.html[start:end] + '</svg>').findall(SVG + 'text')

    def test_complete_lane_labels_match_the_editable_spec(self):
        self.assertEqual(len(self.labels), len(self.spec['lanes']))
        for label, lane in zip(self.labels, self.spec['lanes']):
            with self.subTest(lane=lane['id']):
                self.assertEqual(''.join(label.itertext()), lane['label'])
                if label.findall(SVG + 'tspan'):
                    self.assertEqual(label.attrib['aria-label'], lane['label'])

    def test_long_labels_wrap_in_the_left_gutter_without_smaller_type(self):
        for label in self.labels[1:]:
            lines = label.findall(SVG + 'tspan')
            self.assertEqual(len(lines), 2)
            self.assertEqual(label.attrib['font-size'], '16')
            self.assertEqual(label.attrib['writing-mode'], 'vertical-rl')
            self.assertEqual(label.attrib['text-anchor'], 'middle')
            self.assertEqual([line.attrib['x'] for line in lines], ['36', '16'])
            self.assertTrue(all(line.attrib['y'] == label.attrib['y'] for line in lines))
            # Keep each column shorter than the old 26/30-character labels.
            # Actual font bounds and non-overlap still require browser observation.
            self.assertTrue(all(len(line.text.strip()) <= 17 for line in lines))
        self.assertEqual([label.attrib['y'] for label in self.labels], ['140', '380', '620'])

    def test_export_uses_the_same_authored_svg_and_preserves_light_policy(self):
        serializer = self.html[self.html.index('function serializeSvg('):]
        serializer = serializer[:serializer.index('function ', len('function serializeSvg('))]
        self.assertIn("document.querySelector('.diagram-container svg')", serializer)
        self.assertIn('svg.cloneNode(true)', serializer)
        self.assertIn("var requestedTheme = 'light'", serializer)
        self.assertNotIn('tspan', serializer)


if __name__ == '__main__':
    unittest.main()
