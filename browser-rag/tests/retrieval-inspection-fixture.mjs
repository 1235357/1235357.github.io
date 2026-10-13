import {inputOf} from './financial-generation-fixture.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {chunkSource} from '../chunking.mjs';

// Controlled source records and synthetic accepted vectors only. No encoder runs.
export const axis=(coordinate=0,scale=1)=>Array.from({length:384},(_,index)=>index===coordinate?scale:0);
export function inspectionInput({count=3,topK=2,query=axis(),vectors}={}){
  const input=count<=128?inputOf(Array.from({length:count},(_,index)=>`Controlled source passage ${index+1}`)):
    inputOf(['x'.repeat(count*64)]);
  if(count>128){
    input.chunkArtifact=chunkSource(input.source,{maxChunkUtf16:64,overlapUtf16:0});
    input.embeddingArtifact.chunkIds=input.chunkArtifact.chunks.map(chunk=>chunk.id);
    input.embeddingArtifact.tokenIds=input.chunkArtifact.chunks.map(()=>[101,42,102]);
    input.embeddingArtifact.counts.chunks=count;input.embeddingArtifact.counts.totalTokens=count*3;
  }
  input.embeddingArtifact.vectors=vectors??Array.from({length:count},(_,index)=>axis(index%384));
  input.queryResult.query.vector=query;
  const q=input.queryResult.query;
  const retrieval=rankCandidates(input.chunkArtifact,input.embeddingArtifact,
    {representationId:q.representationId,representation:q.representation,vector:q.vector},{topK});
  return structuredClone({source:input.source,chunkArtifact:input.chunkArtifact,embeddingArtifact:input.embeddingArtifact,query:q,retrieval});
}
