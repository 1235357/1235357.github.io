import assert from 'node:assert/strict';
import {byTag,nodes} from './pdf-app-dom-fixture.mjs';
import {createBoundedTextView} from '../bounded-text-view.mjs';

// Reconstruct through actual navigation handlers, including the final partial page.
// No hidden viewer state or sampled/truncated text can satisfy full source equality.
export function completeText(detail){
  const pre=byTag(detail,'pre')[0];assert.ok(pre);
  if(pre.className!=='bounded-text-page')return pre.textContent;
  const button=name=>byTag(detail,'button').find(node=>node.textContent===name);
  const previous=button('Previous page'),next=button('Next page');assert.ok(previous);assert.ok(next);
  while(!previous.disabled)previous.dispatch('click');
  const chunks=[];
  for(let count=0;count<100000;count++){
    assert.equal(byTag(detail,'pre').length,1);
    assert.ok(pre.textContent.length<=24*1024);
    assert.ok(pre.textContent.split('\n').length<=160);
    chunks.push(pre.textContent);
    if(next.disabled)return chunks.join('');
    next.dispatch('click');
  }
  assert.fail('Text pages did not reach a finite end');
}

export function boundedNode(detail,className){return nodes(detail).find(node=>node.className===className);}

export function downloadHarness(document){
  const create=document.createElement.bind(document),blobs=[],revoked=[],clicked=[];
  document.createElement=tag=>{
    const node=create(tag);
    if(tag==='a')node.click=()=>{node.dispatch('click');clicked.push(node.attributes.get('download'));};
    return node;
  };
  const URL={createObjectURL(blob){blobs.push(blob);return `blob:test-export-${blobs.length}`;},revokeObjectURL(url){revoked.push(url);}};
  return {blobs,revoked,clicked,textView:args=>createBoundedTextView({...args,URL})};
}
