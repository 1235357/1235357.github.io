import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyAssetResponse} from '../verified-stream.mjs';

export const WASM_FILE='ort-wasm-simd-threaded.jsep.wasm';
export const WASM_PIN=Object.freeze({bytes:21596019,sha256:'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'});
// Installed paired runtime only: no model weights, download, GPU or inference.
const body=readFileSync(new URL(`../node_modules/onnxruntime-web/dist/${WASM_FILE}`,import.meta.url));
assert.equal(body.length,WASM_PIN.bytes);
assert.equal(createHash('sha256').update(body).digest('hex'),WASM_PIN.sha256);
export const wasmBytes=()=>new Uint8Array(body);
export function verifiedWasmRead(url,options={}){
  return verifyAssetResponse(new Response(body),{url,...WASM_PIN},options);
}
