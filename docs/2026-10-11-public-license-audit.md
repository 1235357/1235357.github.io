# Public runtime license and inclusion audit — 2026-10-11

This audit concerns the exact three-file Transformers.js / ONNX Runtime browser distribution below. Root independently inspected the complete source map and mapped ONNX Runtime content, then approved the bounded attribution correction. No library, model, runtime pin, generation contract or artifact was changed by this audit. This is a static inclusion and notice-preservation review; it does not establish network privacy, financial accuracy, license clearance for every installed package, or rights in reader-selected PDFs.

## Result and scope

`guid-typescript@1.0.9` is an installed transitive dependency of `onnxruntime-web`. Its actual installed use is the legacy `lib/onnxjs/tensor.ts` import at line 4 and `Guid.create()` default data identifier at line 174. That legacy module and the GUID implementation are absent from the complete source map of the exact distributed Transformers.js browser bundle. The embedded ONNX Runtime source equals the installed `dist/ort.bundle.min.mjs` byte for byte. The public build copies only the named pinned runtime files, rather than `node_modules`, the npm tarball or the legacy ONNXJS tree.

The installed package's license text remains unresolved. The appropriate current status is **installed dependency with unresolved license-text provenance; not redistributed in this exact pinned browser runtime graph**. It is not a claim that the dependency's license has been solved or that the full project has no other distribution obligations. A future WebGL/legacy bundle, a different library version, or redistribution of an npm tree requires a fresh inclusion/license review.

## Exact inspected files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `transformers.min.js` | 888,173 | `aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa` |
| `ort-wasm-simd-threaded.jsep.mjs` | 44,484 | `08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9` |
| `ort-wasm-simd-threaded.jsep.wasm` | 21,596,019 | `c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39` |
| Installed `transformers.min.js.map` (review evidence; excluded from public runtime allowlist) | 2,692,154 | `d269386859935e9eb88f719adabbc61a51fcf6503520338f56eb81fce328adee` |
| Installed/mapped `onnxruntime-web/dist/ort.bundle.min.mjs` | 398,170 | `96e80b413dda387fbcefbd2bb0015f6708323767cc0dd5383260106582e77781` |
| Installed `guid-typescript/dist/guid.js` (not distributed) | 1,969 | `cc9ee817672ea380cdff2cfa4e8e734d6597eb153e7a9a9955a773495a5524a0` |
| Installed legacy `onnxruntime-web/lib/onnxjs/tensor.ts` (not distributed) | 15,190 | `4955067036ee3a20f8f448ba3020a0eea6f97190c33dbc92128921f0fead47d9` |

All three runtime fingerprints equal the current accepted manifest pins. The map has exactly 131 source names and 131 non-null string contents. Source names contain no `guid-typescript` or `onnxjs` entry. Complete source contents and the mapped ORT file contain no `guid-typescript`, `Guid.create`, `isGuid(`, `emptyguid`, or the GUID implementation's empty-value/constructor signatures. The concrete map-to-installed equality provides evidence beyond a text search of minified identifiers. This establishes the bounded exclusion above; searching strings alone is not a general license classifier.

## Primary-source metadata and failed license provenance

The [npm version metadata](https://registry.npmjs.org/guid-typescript/1.0.9), read on 2026-10-11, declares version 1.0.9, license identifier ISC, author name `nicolas`, npm tarball integrity `sha512-Y8T4vYhEfwJOTbouREvG+3XDsjr8E3kIr7uf+JZ0BYloFsttiHU0WfvANVsR7TxNUJa/WpCnw/Ino/p+DeBhBQ==`, and gitHead `1870de806c3db7ba46c5b8a1387c60fc9dda9284`. The installed four-file package contains its README, package metadata, JavaScript and declaration file; no license text is bundled. SPDX metadata does not supply the missing copyright/permission notice.

The historical `NicolasDeveloper/guid-typescript` repository now redirects to [snico-dev/guid-typescript](https://github.com/snico-dev/guid-typescript). Fresh GitHub connector reads of the recorded [commit](https://api.github.com/repos/snico-dev/guid-typescript/commits/1870de806c3db7ba46c5b8a1387c60fc9dda9284) returned 422 / no commit, and [package.json at that ref](https://api.github.com/repos/snico-dev/guid-typescript/contents/package.json?ref=1870de806c3db7ba46c5b8a1387c60fc9dda9284) returned 404 / no ref. This preserves the earlier failed pinned-ref provenance rather than converting it into an invented notice.

The complete, nontruncated [upstream tree at f110c1f42b5c784511e322531e97928c2d8ffb1c](https://api.github.com/repos/snico-dev/guid-typescript/git/trees/f110c1f42b5c784511e322531e97928c2d8ffb1c?recursive=1) has no LICENSE or NOTICE file. Its [package.json](https://github.com/snico-dev/guid-typescript/blob/f110c1f42b5c784511e322531e97928c2d8ffb1c/package.json) declares version **1.0.8**, author `nicolas` and ISC; its [lib/guid.ts](https://github.com/snico-dev/guid-typescript/blob/f110c1f42b5c784511e322531e97928c2d8ffb1c/lib/guid.ts) has the same named GUID class/method family, but this older source is not promoted to an authenticated source/license for npm 1.0.9. No copyright year, license text or upstream matching-commit claim was manufactured.

## Reproduction and preservation

After installing the existing npm lock with `npm --prefix browser-rag ci`, read the installed bundle/map and `onnxruntime-web/dist/ort.bundle.min.mjs`. Recompute SHA-256 and lengths, require all 131 source contents, locate the exact mapped ORT entry and compare its UTF-8 content to the installed file. Inspect the complete source list below. The reproducible evidence comes from the accepted package/pins, not a newly compiled substitute runtime.

The map's entry 15 is `webpack://@huggingface/transformers/./node_modules/onnxruntime-web/dist/ort.bundle.min.mjs`. Its content is exactly 398,170 UTF-8 bytes and has the ORT hash recorded above. The existing `build.py` named-asset delivery and manifest hash checks must continue excluding npm trees, source maps, legacy ONNXJS files, tests and caches. Preserve the upstream runtime and third-party notices already copied by the build. The existing ATTRIBUTION notice records this scope and the unresolved installed dependency separately.

The site-root MIT LICENSE applies to original site code and authored explanations/figures to the extent owned by the project. Third-party runtimes, fonts, marks, model files and source documents retain their own terms; the site license does not relicense them. Qwen model/conversion provenance and copied license text are maintained in their separately named notices. Course PDFs, private classroom records, selected financial excerpts and complete acceptance archives are outside the public runtime/site asset allowlist.

## Complete source-map inclusion list

This list is copied from the inspected source map without filtering. It records the static distribution evidence used by both reviews.

```text
000 webpack://@huggingface/transformers/webpack/runtime/create fake namespace object
001 webpack://@huggingface/transformers/./node_modules/@huggingface/jinja/dist/index.js
002 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/backend-impl.js
003 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/env-impl.js
004 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/env.js
005 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/inference-session-impl.js
006 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/inference-session.js
007 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/tensor-conversion-impl.js
008 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/tensor-factory-impl.js
009 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/tensor-impl-type-mapping.js
010 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/tensor-impl.js
011 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/tensor-utils-impl.js
012 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/tensor.js
013 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/trace.js
014 webpack://@huggingface/transformers/./node_modules/onnxruntime-common/dist/esm/version.js
015 webpack://@huggingface/transformers/./node_modules/onnxruntime-web/dist/ort.bundle.min.mjs
016 webpack://@huggingface/transformers/./src/backends/onnx.js
017 webpack://@huggingface/transformers/./src/base/feature_extraction_utils.js
018 webpack://@huggingface/transformers/./src/base/image_processors_utils.js
019 webpack://@huggingface/transformers/./src/base/processing_utils.js
020 webpack://@huggingface/transformers/./src/configs.js
021 webpack://@huggingface/transformers/./src/env.js
022 webpack://@huggingface/transformers/./src/generation/configuration_utils.js
023 webpack://@huggingface/transformers/./src/generation/logits_process.js
024 webpack://@huggingface/transformers/./src/generation/logits_sampler.js
025 webpack://@huggingface/transformers/./src/generation/stopping_criteria.js
026 webpack://@huggingface/transformers/./src/generation/streamers.js
027 webpack://@huggingface/transformers/./src/models.js
028 webpack://@huggingface/transformers/./src/models/audio_spectrogram_transformer/feature_extraction_audio_spectrogram_transformer.js
029 webpack://@huggingface/transformers/./src/models/auto/feature_extraction_auto.js
030 webpack://@huggingface/transformers/./src/models/auto/image_processing_auto.js
031 webpack://@huggingface/transformers/./src/models/auto/processing_auto.js
032 webpack://@huggingface/transformers/./src/models/beit/image_processing_beit.js
033 webpack://@huggingface/transformers/./src/models/bit/image_processing_bit.js
034 webpack://@huggingface/transformers/./src/models/chinese_clip/image_processing_chinese_clip.js
035 webpack://@huggingface/transformers/./src/models/clap/feature_extraction_clap.js
036 webpack://@huggingface/transformers/./src/models/clip/image_processing_clip.js
037 webpack://@huggingface/transformers/./src/models/convnext/image_processing_convnext.js
038 webpack://@huggingface/transformers/./src/models/dac/feature_extraction_dac.js
039 webpack://@huggingface/transformers/./src/models/deit/image_processing_deit.js
040 webpack://@huggingface/transformers/./src/models/detr/image_processing_detr.js
041 webpack://@huggingface/transformers/./src/models/dinov3_vit/image_processing_dinov3_vit.js
042 webpack://@huggingface/transformers/./src/models/donut/image_processing_donut.js
043 webpack://@huggingface/transformers/./src/models/dpt/image_processing_dpt.js
044 webpack://@huggingface/transformers/./src/models/efficientnet/image_processing_efficientnet.js
045 webpack://@huggingface/transformers/./src/models/encodec/feature_extraction_encodec.js
046 webpack://@huggingface/transformers/./src/models/florence2/processing_florence2.js
047 webpack://@huggingface/transformers/./src/models/gemma3n/feature_extraction_gemma3n.js
048 webpack://@huggingface/transformers/./src/models/gemma3n/processing_gemma3n.js
049 webpack://@huggingface/transformers/./src/models/glpn/image_processing_glpn.js
050 webpack://@huggingface/transformers/./src/models/grounding_dino/image_processing_grounding_dino.js
051 webpack://@huggingface/transformers/./src/models/grounding_dino/processing_grounding_dino.js
052 webpack://@huggingface/transformers/./src/models/idefics3/image_processing_idefics3.js
053 webpack://@huggingface/transformers/./src/models/idefics3/processing_idefics3.js
054 webpack://@huggingface/transformers/./src/models/janus/image_processing_janus.js
055 webpack://@huggingface/transformers/./src/models/janus/processing_janus.js
056 webpack://@huggingface/transformers/./src/models/jina_clip/image_processing_jina_clip.js
057 webpack://@huggingface/transformers/./src/models/jina_clip/processing_jina_clip.js
058 webpack://@huggingface/transformers/./src/models/llava/processing_llava.js
059 webpack://@huggingface/transformers/./src/models/llava_onevision/image_processing_llava_onevision.js
060 webpack://@huggingface/transformers/./src/models/mask2former/image_processing_mask2former.js
061 webpack://@huggingface/transformers/./src/models/maskformer/image_processing_maskformer.js
062 webpack://@huggingface/transformers/./src/models/mgp_str/processing_mgp_str.js
063 webpack://@huggingface/transformers/./src/models/mobilenet_v1/image_processing_mobilenet_v1.js
064 webpack://@huggingface/transformers/./src/models/mobilenet_v2/image_processing_mobilenet_v2.js
065 webpack://@huggingface/transformers/./src/models/mobilenet_v3/image_processing_mobilenet_v3.js
066 webpack://@huggingface/transformers/./src/models/mobilenet_v4/image_processing_mobilenet_v4.js
067 webpack://@huggingface/transformers/./src/models/mobilevit/image_processing_mobilevit.js
068 webpack://@huggingface/transformers/./src/models/moonshine/feature_extraction_moonshine.js
069 webpack://@huggingface/transformers/./src/models/moonshine/processing_moonshine.js
070 webpack://@huggingface/transformers/./src/models/nougat/image_processing_nougat.js
071 webpack://@huggingface/transformers/./src/models/owlv2/image_processing_owlv2.js
072 webpack://@huggingface/transformers/./src/models/owlvit/image_processing_owlvit.js
073 webpack://@huggingface/transformers/./src/models/owlvit/processing_owlvit.js
074 webpack://@huggingface/transformers/./src/models/paligemma/processing_paligemma.js
075 webpack://@huggingface/transformers/./src/models/parakeet/feature_extraction_parakeet.js
076 webpack://@huggingface/transformers/./src/models/phi3_v/image_processing_phi3_v.js
077 webpack://@huggingface/transformers/./src/models/phi3_v/processing_phi3_v.js
078 webpack://@huggingface/transformers/./src/models/pixtral/image_processing_pixtral.js
079 webpack://@huggingface/transformers/./src/models/pixtral/processing_pixtral.js
080 webpack://@huggingface/transformers/./src/models/pvt/image_processing_pvt.js
081 webpack://@huggingface/transformers/./src/models/pyannote/feature_extraction_pyannote.js
082 webpack://@huggingface/transformers/./src/models/pyannote/processing_pyannote.js
083 webpack://@huggingface/transformers/./src/models/qwen2_vl/image_processing_qwen2_vl.js
084 webpack://@huggingface/transformers/./src/models/qwen2_vl/processing_qwen2_vl.js
085 webpack://@huggingface/transformers/./src/models/rt_detr/image_processing_rt_detr.js
086 webpack://@huggingface/transformers/./src/models/sam/image_processing_sam.js
087 webpack://@huggingface/transformers/./src/models/sam/processing_sam.js
088 webpack://@huggingface/transformers/./src/models/sam2/processing_sam2.js
089 webpack://@huggingface/transformers/./src/models/seamless_m4t/feature_extraction_seamless_m4t.js
090 webpack://@huggingface/transformers/./src/models/segformer/image_processing_segformer.js
091 webpack://@huggingface/transformers/./src/models/siglip/image_processing_siglip.js
092 webpack://@huggingface/transformers/./src/models/snac/feature_extraction_snac.js
093 webpack://@huggingface/transformers/./src/models/speecht5/feature_extraction_speecht5.js
094 webpack://@huggingface/transformers/./src/models/speecht5/processing_speecht5.js
095 webpack://@huggingface/transformers/./src/models/swin2sr/image_processing_swin2sr.js
096 webpack://@huggingface/transformers/./src/models/ultravox/processing_ultravox.js
097 webpack://@huggingface/transformers/./src/models/vit/image_processing_vit.js
098 webpack://@huggingface/transformers/./src/models/vitmatte/image_processing_vitmatte.js
099 webpack://@huggingface/transformers/./src/models/vitpose/image_processing_vitpose.js
100 webpack://@huggingface/transformers/./src/models/voxtral/processing_voxtral.js
101 webpack://@huggingface/transformers/./src/models/wav2vec2/feature_extraction_wav2vec2.js
102 webpack://@huggingface/transformers/./src/models/wav2vec2/processing_wav2vec2.js
103 webpack://@huggingface/transformers/./src/models/wav2vec2_with_lm/processing_wav2vec2_with_lm.js
104 webpack://@huggingface/transformers/./src/models/wespeaker/feature_extraction_wespeaker.js
105 webpack://@huggingface/transformers/./src/models/whisper/common_whisper.js
106 webpack://@huggingface/transformers/./src/models/whisper/feature_extraction_whisper.js
107 webpack://@huggingface/transformers/./src/models/whisper/generation_whisper.js
108 webpack://@huggingface/transformers/./src/models/whisper/processing_whisper.js
109 webpack://@huggingface/transformers/./src/models/yolos/image_processing_yolos.js
110 webpack://@huggingface/transformers/./src/ops/registry.js
111 webpack://@huggingface/transformers/./src/pipelines.js
112 webpack://@huggingface/transformers/./src/tokenizers.js
113 webpack://@huggingface/transformers/./src/utils/audio.js
114 webpack://@huggingface/transformers/./src/utils/constants.js
115 webpack://@huggingface/transformers/./src/utils/core.js
116 webpack://@huggingface/transformers/./src/utils/data-structures.js
117 webpack://@huggingface/transformers/./src/utils/devices.js
118 webpack://@huggingface/transformers/./src/utils/dtypes.js
119 webpack://@huggingface/transformers/./src/utils/generic.js
120 webpack://@huggingface/transformers/./src/utils/hub.js
121 webpack://@huggingface/transformers/./src/utils/image.js
122 webpack://@huggingface/transformers/./src/utils/maths.js
123 webpack://@huggingface/transformers/./src/utils/tensor.js
124 webpack://@huggingface/transformers/./src/utils/video.js
125 webpack://@huggingface/transformers/webpack/bootstrap
126 webpack://@huggingface/transformers/webpack/runtime/define property getters
127 webpack://@huggingface/transformers/webpack/runtime/hasOwnProperty shorthand
128 webpack://@huggingface/transformers/webpack/runtime/make namespace object
129 webpack://@huggingface/transformers/webpack/runtime/publicPath
130 webpack://@huggingface/transformers/webpack/runtime/base uri
```
