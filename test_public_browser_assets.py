"""Synthetic public-build/download controls; no browser/model acceptance."""
import hashlib
import importlib.util
import io
import json
import re
import unittest
from pathlib import Path
from unittest.mock import patch
import build
import test_build as fixtures
import test_browser_assets as existing
import browser_release_assets as release

spec = importlib.util.spec_from_file_location('browser_materializer', Path(__file__).parent / 'scripts/materialize-browser-assets.py')
materializer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(materializer)

class PublicBrowserAssetsTest(unittest.TestCase):
    add_asset = existing.EmbeddingAssetsTest.add_asset
    write_registry = existing.EmbeddingAssetsTest.write_registry
    def setUp(self):
        existing.EmbeddingAssetsTest.setUp(self)
        (self.root/'LICENSE').write_text('MIT synthetic site license',encoding='utf-8')
        # Real authored modules form the production graph; small asset bodies
        # use explicitly patched build pins and are never model inputs.
        for name in release.PUBLIC_MODULES:
            (self.browser / name).write_bytes((existing.REPOSITORY_BROWSER / name).read_bytes())
        for name in ('inspector.html', 'inspector.css', 'embedding-contract.mjs', 'verified-cache.mjs', 'verified-stream.mjs'):
            (self.browser / name).write_bytes((existing.REPOSITORY_BROWSER / name).read_bytes())
        markup=(self.browser/'inspector.html').read_text(encoding='utf-8')
        # This isolated fixture has one tiny article. Full navigation tests own
        # the actual chapter/fragment closure, not this model-delivery fixture.
        markup=re.sub(r'href="\.\./[^"#]+\.html#[^"]+"','href="../index.html"',markup)
        (self.browser/'inspector.html').write_text(markup,encoding='utf-8')
        vendor = self.browser / 'vendor/noble-hashes'
        vendor.mkdir(parents=True)
        noble = json.loads((existing.REPOSITORY_BROWSER / 'noble-assets.json').read_bytes())
        for name in noble['files']:
            (vendor / name).write_bytes((existing.REPOSITORY_BROWSER / 'vendor/noble-hashes' / name).read_bytes())
        (self.browser / 'noble-assets.json').write_text(json.dumps(noble))
        self.qwen = self.browser / '.model-cache' / release.QWEN_REVISION
        self.qwen.mkdir(parents=True)
        self.model_bodies = {name: b'QWEN ' + name.encode() for name in release.QWEN_MODEL_FILES}
        self.notice_bodies = {name: b'QWEN NOTICE ' + name.encode() for name in release.QWEN_NOTICE_FILES}
        for name, data in self.model_bodies.items():
            path = self.qwen / name;path.parent.mkdir(parents=True, exist_ok=True);path.write_bytes(data)
        for name, data in self.notice_bodies.items():
            (self.qwen / release.QWEN_NOTICE_FILES[name]['cacheName']).write_bytes(data)
        self.fake_models = {name: existing.metadata(data) for name, data in self.model_bodies.items()}
        self.fake_notices = {name: {**release.QWEN_NOTICE_FILES[name], **existing.metadata(data)} for name, data in self.notice_bodies.items()}
        for attribute, value in (('QWEN_MODEL_FILES', self.fake_models), ('RUNTIME_FILES', self.embedding_registry['runtimeFiles']), ('QWEN_NOTICE_FILES', self.fake_notices)):
            control=patch.object(release, attribute, value);control.start();self.addCleanup(control.stop)
        (self.browser / 'acceptance').mkdir()
        self.registry = release.qwen_registry()
        self.write_qwen_registry()

    def write_qwen_registry(self):
        (self.browser / 'acceptance/generator-probe-assets.json').write_text(json.dumps(self.registry))

    def public(self): return build.build(public_release=True)
    def refuses(self):
        before=fixtures.file_snapshot(self.root / 'dist')
        with self.assertRaises((ValueError, FileNotFoundError)):self.public()
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'),before)
        self.assertEqual(list(self.root.glob('.dist-stage-*')),[])

    def test_public_profile_delivers_exact_production_graph_and_assets_without_private_diagnostics(self):
        for name in ('pdf-private-entry.mjs','unknown.mjs','acceptance/generator-probe.html','acceptance/native-private.json','acceptance/secret.pdf'):
            path=self.browser/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'EXCLUDED')
        (self.qwen/'onnx/model.onnx').write_bytes(b'UNPINNED MODEL')
        self.public();out=self.root/'dist/browser-rag'
        markup=(out/'inspector.html').read_text(encoding='utf-8');self.assertIn('src="pdf-public-entry.mjs"',markup);self.assertNotIn('src="pdf-entry.mjs"',markup)
        css=(out/'inspector.css').read_bytes().replace(b'\r\n',b'\n')
        self.assertIn(f'href="inspector.css?v={hashlib.sha256(css).hexdigest()[:16]}"',markup)
        graph=existing.static_mjs_graph(out,'pdf-public-entry.mjs');self.assertIn('financial-lookup-view.mjs',graph);self.assertIn('financial-generation-source.mjs',graph)
        self.assertIn('financial-annual-table-contract.mjs', graph)
        self.assertIn('bounded-text-view.mjs', graph)
        for name in ('asset-preparation-source.mjs','asset-preparation-view.mjs','asset-preparation-transport.mjs','pdf-worker-preparation.mjs','runtime-failure-contract.mjs'):
            self.assertIn(name,graph)
        preparation_worker=existing.static_mjs_graph(out,'asset-preparation.worker.mjs')
        for name in ('asset-preparation.worker.mjs','asset-preparation-source.mjs','asset-preparation-transport.mjs','embedding-runtime.mjs','generator-native-core.mjs'):
            self.assertIn(name,preparation_worker)
        for name in release.PUBLIC_MODULES:self.assertEqual((out/name).read_bytes(),(self.browser/name).read_bytes())
        self.assertTrue((out/'financial-generation.worker.mjs').is_file())
        self.assertEqual(json.loads((out/'acceptance/generator-probe-assets.json').read_bytes()),self.registry)
        for name,data in self.model_bodies.items():self.assertEqual((out/'models'/release.QWEN_REVISION/release.QWEN_MODEL_ID/name).read_bytes(),data)
        for name,data in self.notice_bodies.items():self.assertEqual((out/'notices'/name).read_bytes(),data)
        for name in ('pdf-private-entry.mjs','unknown.mjs','acceptance/generator-probe.html','acceptance/native-private.json','acceptance/secret.pdf','.model-cache','node_modules'):
            self.assertFalse((out/name).exists(),name)
        self.assertFalse((out/'models'/release.QWEN_REVISION/release.QWEN_MODEL_ID/'onnx/model.onnx').exists())
        self.assertTrue((self.root/'dist/.nojekyll').is_file())
        self.assertIn('Documentation · browser lab',(self.root/'dist/index.html').read_text(encoding='utf-8'))
        self.assertNotIn('Local draft · not published',(self.root/'dist/index.html').read_text(encoding='utf-8'))
        self.assertEqual((self.root/'dist/SITE-LICENSE.txt').read_bytes(),(self.root/'LICENSE').read_bytes())
        # Relative entry/module/model paths retain an arbitrary project prefix.
        self.assertNotRegex(markup,r'(?:src|href)="/browser-rag/');self.assertNotIn('https:',markup)

    def test_default_build_stays_off_and_excludes_public_production_graph_and_qwen(self):
        build.build();out=self.root/'dist/browser-rag'
        self.assertIn('src="pdf-entry.mjs"',(out/'inspector.html').read_text(encoding='utf-8'))
        self.assertEqual((out/'runtime-failure-contract.mjs').read_bytes(),(self.browser/'runtime-failure-contract.mjs').read_bytes())
        for name in release.PUBLIC_MODULES:self.assertFalse((out/name).exists(),name)
        self.assertFalse((out/'models'/release.QWEN_REVISION).exists());self.assertFalse((out/'acceptance').exists())
        self.assertIn('Local draft · not published',(self.root/'dist/index.html').read_text(encoding='utf-8'))

    def test_missing_each_public_module_retains_previous_dist(self):
        self.public()
        for name in release.PUBLIC_MODULES:
            path=self.browser/name;data=path.read_bytes();path.unlink()
            try:self.refuses()
            finally:path.write_bytes(data)

    def test_registry_unknown_model_extra_keys_and_pin_changes_refuse_without_fallback(self):
        self.public()
        for mutate in (lambda r:r['modelFiles'].update({'onnx/model.onnx':existing.metadata(b'X')}),lambda r:r.update({'unknown':1}),lambda r:r.update({'schemaVersion':True}),lambda r:r['modelFiles']['config.json'].update({'sha256':'a'*64})):
            self.registry=release.qwen_registry();mutate(self.registry);self.write_qwen_registry();self.refuses()
        self.registry=release.qwen_registry();self.write_qwen_registry()
        with (self.browser/'acceptance/generator-probe-assets.json').open('a') as stream:stream.write(' '*32769)
        self.refuses()

    def test_corrupt_model_missing_notice_and_shared_runtime_pin_mismatch_preserve_dist(self):
        self.public();path=self.qwen/'onnx/model_q4.onnx';data=path.read_bytes();path.write_bytes(bytes([data[0]^1])+data[1:]);self.refuses();path.write_bytes(data)
        path=self.qwen/'README.md';data=path.read_bytes();path.unlink();self.refuses();path.write_bytes(data)
        self.registry['runtimeFiles']['transformers.min.js']['sha256']='a'*64;self.write_qwen_registry();self.refuses()

    def test_public_size_gate_and_invalid_profile_refuse_before_promotion(self):
        self.public()
        with patch.object(build,'PUBLIC_SITE_MAX_BYTES',1):self.refuses()
        for value in (1,'public',None):
            with self.assertRaises(ValueError):build.build(public_release=value)

class MaterializerTest(unittest.TestCase):
    def setUp(self):
        fixtures.FreshBuildTest.setUp(self)
        self.body=b'fixed pinned bytes'*10
        self.asset={'relativePath':'browser-rag/.model-cache/test/file.bin','url':'https://huggingface.co/fixed/resolve/'+('a'*40)+'/file.bin',**existing.metadata(self.body)}
    def opener(self,url,timeout):return io.BytesIO(self.body)
    def test_bounded_cold_download_then_verified_warm_reuse_never_overwrites(self):
        calls=[]
        def open_url(url,timeout):calls.append(url);return self.opener(url,timeout)
        self.assertEqual(materializer.materialize_asset(self.root,self.asset,open_url),'downloaded')
        path=self.root/self.asset['relativePath'];self.assertEqual(path.read_bytes(),self.body)
        self.assertEqual(materializer.materialize_asset(self.root,self.asset,open_url),'verified-cache');self.assertEqual(calls,[self.asset['url']])
        path.write_bytes(b'EXISTING INVALID')
        with self.assertRaises(ValueError):materializer.materialize_asset(self.root,self.asset,open_url)
        self.assertEqual(path.read_bytes(),b'EXISTING INVALID');self.assertEqual(len(calls),1)
    def test_short_overlong_and_wrong_hash_downloads_leave_no_final_or_partial_file(self):
        for data in (self.body[:-1],self.body+b'x',bytes([self.body[0]^1])+self.body[1:]):
            with self.assertRaises(ValueError):materializer.materialize_asset(self.root,self.asset,lambda url,timeout:io.BytesIO(data))
            self.assertFalse((self.root/self.asset['relativePath']).exists());self.assertEqual(list((self.root/self.asset['relativePath']).parent.glob('*.part')),[])
    def test_fixed_plans_skip_qwen_in_embedding_only_and_use_immutable_https_urls(self):
        complete=release.download_plan();embedding=release.download_plan(embedding_only=True)
        self.assertEqual(len(complete),13);self.assertEqual(len(embedding),6)
        self.assertTrue(all(release.MINILM_REVISION in item['relativePath'] for item in embedding))
        for item in complete:
            self.assertRegex(item['url'],r'^https://huggingface\.co/.+/resolve/[a-f0-9]{40}/');self.assertGreater(item['bytes'],0);self.assertRegex(item['sha256'],r'^[a-f0-9]{64}$')
    def test_plan_destination_cannot_escape_repository(self):
        with self.assertRaises(ValueError):materializer.materialize_asset(self.root,{**self.asset,'relativePath':'../outside'},self.opener)
    def test_runtime_preflight_fails_before_any_network_for_missing_or_changed_package(self):
        calls=[]
        with self.assertRaises(FileNotFoundError):materializer.materialize(self.root,opener=lambda *args,**kwargs:calls.append(args))
        self.assertEqual(calls,[])
        for package,version in [('node_modules/@huggingface/transformers','3.8.1'),('node_modules/onnxruntime-web','wrong')]:
            path=self.root/'browser-rag'/package/'package.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'version':version}))
        with self.assertRaises(ValueError):materializer.materialize(self.root,opener=lambda *args,**kwargs:calls.append(args))
        self.assertEqual(calls,[])

class ActualPublicPinsTest(unittest.TestCase):
    def test_python_qwen_pins_match_existing_runtime_registry_and_notice_bodies(self):
        browser=existing.REPOSITORY_BROWSER
        self.assertEqual(release.qwen_registry(),json.loads((browser/'acceptance/generator-probe-assets.json').read_bytes()))
        embedding=json.loads((browser/'embedding-assets.json').read_bytes())
        self.assertEqual(release.MINILM_MODEL_FILES,embedding['modelFiles']);self.assertEqual(release.RUNTIME_FILES,embedding['runtimeFiles'])
        for name,descriptor in release.QWEN_NOTICE_FILES.items():
            source=browser/'.model-cache'/release.QWEN_REVISION/descriptor['cacheName']
            if source.exists():self.assertEqual(existing.metadata(source.read_bytes()),{key:descriptor[key] for key in ('bytes','sha256')})
