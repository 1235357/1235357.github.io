"""Fixed public browser asset metadata; no caller/registry chooses destinations."""
MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
MINILM_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9'
QWEN_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct'
QWEN_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'
QWEN_BASE_LICENSE_REVISION = '7ae557604adf67be50417f59c2c2f167def9a775'
MINILM_MODEL_FILES = {
    'config.json': {'bytes': 650, 'sha256': '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7'},
    'tokenizer.json': {'bytes': 711661, 'sha256': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0'},
    'tokenizer_config.json': {'bytes': 366, 'sha256': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3'},
    'special_tokens_map.json': {'bytes': 125, 'sha256': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3'},
    'onnx/model.onnx': {'bytes': 90387606, 'sha256': '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e'},
}
QWEN_MODEL_FILES = {
    'config.json': {'bytes': 678, 'sha256': '777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5'},
    'tokenizer.json': {'bytes': 7031673, 'sha256': 'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf'},
    'tokenizer_config.json': {'bytes': 7849, 'sha256': '6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430'},
    'generation_config.json': {'bytes': 242, 'sha256': 'f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3'},
    'onnx/model_q4.onnx': {'bytes': 786156820, 'sha256': '09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296'},
}
RUNTIME_FILES = {
    'transformers.min.js': {'bytes': 888173, 'sha256': 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'},
    'ort-wasm-simd-threaded.jsep.mjs': {'bytes': 44484, 'sha256': '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'},
    'ort-wasm-simd-threaded.jsep.wasm': {'bytes': 21596019, 'sha256': 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'},
}
MINILM_CARD = {'bytes': 1767, 'sha256': '63ea99bf681a2e9eda4f6a537d5ed8fda95d1677111656da37e9cfd080c3af02'}
QWEN_NOTICE_FILES = {
    'QWEN-MODEL-CARD.txt': {'cacheName': 'README.md', 'bytes': 545, 'sha256': 'd7312dfc364cad2634eefaaf3aefd9cfda3cc27cda03332e18d09e600394ed75',
        'url': f'https://huggingface.co/{QWEN_MODEL_ID}/resolve/{QWEN_REVISION}/README.md'},
    'QWEN-LICENSE.txt': {'cacheName': 'LICENSE-QWEN.txt', 'bytes': 11343, 'sha256': '832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e',
        'url': f'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/resolve/{QWEN_BASE_LICENSE_REVISION}/LICENSE'},
}
PUBLIC_MODULES = (
    'pdf-public-entry.mjs', 'generator-contract.mjs', 'generator-native-core.mjs', 'receipt-snapshot.mjs',
    'financial-generation-input.mjs', 'financial-generation-source.mjs', 'financial-generation.worker.mjs',
    'financial-generator-runtime.mjs', 'financial-generator-contract.mjs', 'prompt-contract.mjs', 'financial-output-contract.mjs',
    'financial-geometry-source.mjs', 'financial-geometry-view.mjs', 'financial-table-contract.mjs', 'financial-lookup-view.mjs',
    'asset-preparation-source.mjs', 'asset-preparation.worker.mjs', 'asset-preparation-view.mjs',
)

def qwen_registry():
    return {'schemaVersion': 1, 'modelId': QWEN_MODEL_ID, 'revision': QWEN_REVISION,
            'modelFiles': {name: dict(pin) for name, pin in QWEN_MODEL_FILES.items()},
            'runtimeFiles': {name: dict(pin) for name, pin in RUNTIME_FILES.items()}}

def download_plan(*, embedding_only=False):
    if type(embedding_only) is not bool: raise ValueError('Invalid asset profile')
    assets = []
    for model, revision, pins in [(MINILM_MODEL_ID, MINILM_REVISION, MINILM_MODEL_FILES)] + ([] if embedding_only else [(QWEN_MODEL_ID, QWEN_REVISION, QWEN_MODEL_FILES)]):
        for name, pin in pins.items():
            assets.append({'relativePath': f'browser-rag/.model-cache/{revision}/{name}',
                           'url': f'https://huggingface.co/{model}/resolve/{revision}/{name}', **pin})
    assets.append({'relativePath': f'browser-rag/.model-cache/{MINILM_REVISION}/README.md',
                   'url': f'https://huggingface.co/{MINILM_MODEL_ID}/resolve/{MINILM_REVISION}/README.md', **MINILM_CARD})
    if not embedding_only:
        for pin in QWEN_NOTICE_FILES.values():
            assets.append({'relativePath': f'browser-rag/.model-cache/{QWEN_REVISION}/{pin["cacheName"]}',
                           **{key: pin[key] for key in ('url', 'bytes', 'sha256')}})
    return assets
