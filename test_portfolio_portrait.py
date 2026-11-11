"""No network or image packages: test the portrait's public asset boundary."""
import hashlib
from pathlib import Path
import tempfile
import unittest

import build
from site_portrait_assets import PORTRAIT_FILES


ROOT = Path(__file__).resolve().parent


class PortraitAssetsTest(unittest.TestCase):
    def test_reviewed_jpeg_is_square_and_has_no_private_metadata_segments(self):
        data = (ROOT / 'assets/portrait/zhentong-ye.jpg').read_bytes()
        self.assertEqual(data[:2], b'\xff\xd8')
        self.assertEqual(data[-2:], b'\xff\xd9')
        position = 2
        dimensions = []
        while position < len(data):
            self.assertEqual(data[position], 0xff)
            marker = data[position + 1]
            position += 2
            if marker == 0xda:  # Start of compressed pixel data.
                break
            length = int.from_bytes(data[position:position + 2], 'big')
            self.assertGreaterEqual(length, 2)
            segment = data[position + 2:position + length]
            self.assertEqual(len(segment), length - 2)
            # APP1/EXIF/XMP, APP13/IPTC, comments and all other APP metadata
            # are disallowed. The non-identifying JFIF header is retained.
            self.assertNotIn(marker, [*range(0xe1, 0xf0), 0xfe])
            if marker == 0xe0:
                self.assertEqual(segment[:5], b'JFIF\0')
            if marker == 0xc0:
                dimensions.append((int.from_bytes(segment[3:5], 'big'),
                                   int.from_bytes(segment[1:3], 'big')))
            position += length
        else:
            self.fail('JPEG scan data missing')
        self.assertEqual(dimensions, [(2048, 2048)])
        pin = PORTRAIT_FILES['zhentong-ye.jpg']
        self.assertEqual(len(data), pin['bytes'])
        self.assertEqual(hashlib.sha256(data).hexdigest(), pin['sha256'])

    def test_copier_allows_only_portrait_and_notice(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'assets/portrait'
            source.mkdir(parents=True)
            for name in PORTRAIT_FILES:
                (source / name).write_bytes((ROOT / 'assets/portrait' / name).read_bytes())
            (source / 'private-original.jpg').write_bytes(b'not approved for publication')
            output = root / 'dist'
            output.mkdir()
            build.copy_portrait_assets(root, output)
            self.assertEqual({p.name for p in (output / 'assets/portrait').iterdir()},
                             set(PORTRAIT_FILES))
            for name, pin in PORTRAIT_FILES.items():
                body = (output / 'assets/portrait' / name).read_bytes()
                self.assertEqual(len(body), pin['bytes'])
                self.assertEqual(hashlib.sha256(body).hexdigest(), pin['sha256'])

    def test_copier_refuses_changed_portrait_and_missing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'assets/portrait'
            source.mkdir(parents=True)
            output = root / 'dist'
            output.mkdir()
            with self.assertRaises((ValueError, FileNotFoundError)):
                build.copy_portrait_assets(root, output)
            body = bytearray((ROOT / 'assets/portrait/zhentong-ye.jpg').read_bytes())
            body[-10] ^= 1
            (source / 'zhentong-ye.jpg').write_bytes(body)
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                build.copy_portrait_assets(root, output)


if __name__ == '__main__':
    unittest.main()
