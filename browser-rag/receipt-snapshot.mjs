import { GENERATION_SPEC, preflightGeneration, copyGenerationPreflight } from './generator-contract.mjs';

const READERS=new WeakSet();
const PREFLIGHT_SHAPE=preflightGeneration([0]);
const fail=()=>{throw new Error('The receipt snapshot is invalid.');};
const bounded=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const exactKeys=(keys,expected)=>keys.length===expected.length&&keys.every(key=>expected.includes(key));

// Internal, synchronous schema-directed observation only. Each caller object
// has one key/field/length observation within a copy. Reused observations must
// still satisfy every new role's schema and bounds. Nothing recursively clones
// arbitrary input or establishes tokenization, invocation or financial truth.
export function createReceiptSnapshot() {
  const observations=new WeakMap();
  function record(value,keys) {
    let observed=observations.get(value);
    if(!observed) {
      if(value===null||typeof value!=='object'||Array.isArray(value)
          ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
      const ownKeys=Reflect.ownKeys(value);
      // Validate the single key observation before reading any field value.
      if(!exactKeys(ownKeys,keys))fail();
      const fields={};for(const key of keys)fields[key]=value[key];
      observed={kind:'record',keys:ownKeys,fields:Object.freeze(fields)};
      observations.set(value,observed);
    }
    if(observed.kind!=='record'||!exactKeys(observed.keys,keys))fail();
    return observed.fields;
  }
  function length(value,min,max) {
    let observed=observations.get(value);
    if(!observed) {
      if(!Array.isArray(value))fail();
      const size=value.length;
      // A hostile huge length is refused before keys, values or iterators.
      if(!bounded(size,min,max)||Object.getPrototypeOf(value)!==Array.prototype)fail();
      observed={kind:'array',length:size};observations.set(value,observed);
    }
    if(observed.kind!=='array'||!bounded(observed.length,min,max))fail();
    return observed.length;
  }
  function array(value,min,max) {
    const size=length(value,min,max),observed=observations.get(value);
    if(!observed.entries) {
      const keys=Reflect.ownKeys(value),set=new Set(keys);
      if(keys.length!==size+1||!set.has('length'))fail();
      for(let index=0;index<size;index++)if(!set.has(String(index)))fail();
      const entries=[];for(let index=0;index<size;index++)entries.push(value[index]);
      observed.entries=Object.freeze(entries);
    }
    return observed.entries;
  }
  function ids(value,min,max) {
    const entries=array(value,min,max);
    if(entries.some(id=>typeof id!=='number'||!bounded(id,0,GENERATION_SPEC.vocabSize-1)))fail();
    return entries;
  }
  function mask(value,size) {
    const entries=array(value,size,size);if(entries.some(item=>item!==1))fail();return entries;
  }
  function matches(value,expected,active=new WeakSet()) {
    if(expected===null||typeof expected!=='object')return Object.is(value,expected);
    if(value===null||typeof value!=='object'||active.has(value))return false;
    active.add(value);
    try {
      if(Array.isArray(expected)) {
        const entries=array(value,expected.length,expected.length);
        return expected.every((item,index)=>matches(entries[index],item,active));
      }
      const keys=Object.keys(expected),fields=record(value,keys);
      return keys.every(key=>matches(fields[key],expected[key],active));
    } finally {active.delete(value);}
  }
  function preflight(value) {
    const fields=record(value,Object.keys(PREFLIGHT_SHAPE));
    const generation=record(fields.generation,Object.keys(GENERATION_SPEC));
    const settings=record(fields.settings,Object.keys(PREFLIGHT_SHAPE.settings));
    // Capture known bounded shapes only, then let the existing canonical
    // preflight validator own every pin, budget and effective setting check.
    return copyGenerationPreflight({...fields,
      promptTokenIds:ids(fields.promptTokenIds,1,GENERATION_SPEC.maxDeviceWindowTokens),generation,
      settings:{...settings,eos_token_id:ids(settings.eos_token_id,2,2),
        generation_kwargs:record(settings.generation_kwargs,[])}});
  }
  const reader=Object.freeze({record,length,array,ids,mask,matches,preflight});READERS.add(reader);return reader;
}

// Internal delegations accept only this module's frozen readers, never a
// caller-provided function that could bypass the canonical comparisons.
export function requireReceiptSnapshot(reader) {
  if(!READERS.has(reader))fail();
  return reader;
}
