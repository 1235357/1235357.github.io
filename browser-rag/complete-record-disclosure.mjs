import {createBoundedTextView} from './bounded-text-view.mjs';

const FAILED='RECORD_DISCLOSURE_FAILED · The complete record could not be displayed safely.';
const descendants=root=>[root,...Array.from(root.childNodes??root.children??[]).flatMap(descendants)];

// Each open owns a separate body and revision. Cleanup captures its nodes before
// calling an external disposer, which may synchronously reopen or replace a root.
export function createCompleteRecordDisclosure({document,title,read,current,filename,format='json',indent=2,textView=createBoundedTextView}){
  const node=document.createElement('details'),summary=document.createElement('summary');
  node.className='complete-record-disclosure';summary.textContent=typeof title==='string'?title:'Complete record';node.append(summary);
  let alive=true,revision=0,active=null;
  const openAt=attempt=>alive&&node.open===true&&revision===attempt;
  const owns=record=>openAt(record.revision)&&active===record&&!record.retired;
  function scrub(captured){
    for(const element of captured){
      if('disabled' in element)element.disabled=true;
      if('value' in element)element.value='';
      element.removeAttribute?.('href');element.removeAttribute?.('download');element.textContent='';
    }
  }
  function release(record){
    if(!record)return;
    const captured=descendants(record.body),viewer=record.viewer;
    record.retired=true;record.viewer=null;
    // Detach while this record still owns the body, before an external callback.
    if(active===record){active=null;node.replaceChildren(...(alive?[summary]:[]));}
    try{viewer?.dispose?.();}catch{/* Disposer diagnostics must not enter the DOM. */}
    finally{scrub(captured);}
  }
  function dispose(){
    if(!alive)return;
    alive=false;revision++;
    const previous=active;active=null;
    node.open=false;node.removeEventListener('toggle',toggle);
    summary.disabled=true;summary.setAttribute('aria-disabled','true');summary.setAttribute('tabindex','-1');summary.textContent='';
    node.replaceChildren();release(previous);
  }
  function owned(record){
    if(!owns(record))return false;
    let accepted=false;try{accepted=current()===true;}catch{/* Failed ownership revokes the record silently. */}
    // The predicate itself may close, reopen or permanently dispose this node.
    if(!owns(record))return false;
    if(!accepted){dispose();return false;}
    return true;
  }
  function failure(record){
    if(!owned(record)){release(record);return;}
    const attempt=record.revision;release(record);
    if(!openAt(attempt))return;
    const error={revision:attempt,body:document.createElement('p'),viewer:null,retired:false};active=error;
    if(!owned(error)){release(error);return;}
    error.body.className='complete-record-error hint';error.body.setAttribute('role','status');error.body.textContent=FAILED;
    node.append(error.body);if(!owned(error))release(error);
  }
  function toggle(){
    // Retained callbacks cannot resurrect a permanently revoked disclosure.
    if(!alive){node.open=false;return;}
    const attempt=++revision,previous=active;active=null;
    node.replaceChildren(summary);release(previous);
    if(!openAt(attempt))return;
    const record={revision:attempt,body:document.createElement('div'),viewer:null,retired:false};active=record;
    if(!owned(record)){release(record);return;}
    record.body.className='complete-record-body';node.append(record.body);
    try{
      if(!['json','text'].includes(format)||typeof read!=='function'||typeof textView!=='function')throw new TypeError();
      if(!owned(record)){release(record);return;}
      const value=read();
      if(!owned(record)){release(record);return;}
      // JSON getters/toJSON and indentation conversion are external callbacks.
      if(!owned(record)){release(record);return;}
      const text=format==='text'?value:JSON.stringify(value,null,indent);
      if(!owned(record)){release(record);return;}
      if(typeof text!=='string')throw new TypeError();
      if(!owned(record)){release(record);return;}
      const viewer=textView({document,root:record.body,text,current:()=>owned(record),filename,format});
      // Store even a late return so its disposer runs after a reentrant close.
      record.viewer=viewer;
      if(!owned(record)){release(record);return;}
      if(typeof viewer?.dispose!=='function')throw new TypeError();
      if(!owned(record))release(record);
    }catch{failure(record);}
  }
  node.addEventListener('toggle',toggle);
  return Object.freeze({node,dispose});
}
