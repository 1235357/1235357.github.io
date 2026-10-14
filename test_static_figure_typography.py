"""The standalone SVG image must carry its actual portfolio font and license."""
import base64
import hashlib
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET

from site_typography_assets import TYPOGRAPHY_FILES


ROOT = Path(__file__).resolve().parent
SVG = '{http://www.w3.org/2000/svg}'


class StaticFigureTypographyTest(unittest.TestCase):
    def setUp(self):
        self.figure = ET.parse(ROOT / 'figures/04-evidence-to-calculation.svg').getroot()
        self.styles = '\n'.join(node.text or '' for node in self.figure.iter(SVG + 'style'))

    def test_standalone_image_embeds_the_complete_pinned_manrope_font(self):
        faces = re.findall(r'@font-face\s*\{([^}]+)\}', self.styles)
        self.assertEqual(len(faces), 1, 'An SVG image cannot inherit the page font face')
        face = faces[0]
        self.assertRegex(face, r'font-family:\s*Manrope\s*;')
        self.assertRegex(face, r'font-weight:\s*200\s+800\s*;')
        self.assertRegex(face, r'font-style:\s*normal\s*;')
        sources = re.findall(r"url\(['\"]?(data:font/ttf;base64,[A-Za-z0-9+/=]+)['\"]?\)", face)
        self.assertEqual(len(sources), 1)
        body = base64.b64decode(sources[0].split(',', 1)[1], validate=True)
        pin = TYPOGRAPHY_FILES['Manrope-Variable.ttf']
        self.assertEqual(len(body), pin['bytes'])
        self.assertEqual(hashlib.sha256(body).hexdigest(), pin['sha256'])
        self.assertEqual(body, (ROOT / 'assets/typography/Manrope-Variable.ttf').read_bytes())
        self.assertNotIn('local(', face, 'Installed fonts must not override the portable bytes')

    def test_embedded_font_carries_the_complete_unmodified_ofl_notice(self):
        notices = self.figure.findall(SVG + 'metadata')
        expected = (ROOT / 'assets/typography/Manrope-OFL.txt').read_text(encoding='utf-8')
        self.assertIn(expected, [node.text for node in notices],
                      'The copied font license must travel with the downloaded SVG')

    def test_image_has_no_external_font_or_other_resource_request(self):
        self.assertNotRegex(self.styles, r'@import\b')
        resources = re.findall(r"url\(['\"]?([^)'\"]+)['\"]?\)", self.styles)
        for node in self.figure.iter():
            for key, value in node.attrib.items():
                if key == 'href' or key.endswith('}href'):
                    resources.append(value)
                resources.extend(re.findall(r'url\(([^)]+)\)', value))
        for resource in resources:
            with self.subTest(resource=resource[:60]):
                self.assertTrue(resource.startswith(('#', 'data:font/ttf;base64,')))


if __name__ == '__main__':
    unittest.main()
