import {copyValidatedChunkArtifact} from './compute-source.mjs';
import {projectEmbeddingInput} from './embedding-source.mjs';
import {copyQueryPassages,copyQueryResult} from './query-source.mjs';
import {rankCandidates} from './retrieval.mjs';

const INPUT_KEYS=['source','chunkArtifact','embeddingArtifact','query','retrieval'];
const exact=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Reflect.ownKeys(value).length===INPUT_KEYS.length&&Reflect.ownKeys(value).every(key=>INPUT_KEYS.includes(key));
const freeze=value=>{
  if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
export class RetrievalInspectionError extends Error {
  constructor(){super('The retained retrieval artifacts do not agree.');this.name='RetrievalInspectionError';this.code='INVALID_RETRIEVAL_INSPECTION';}
}

// A post-acceptance calculation, not a new worker event or inference result.
// Shared production copiers validate source mappings, representation, receipts,
// selected fields and tie order before any inspection data is returned.
export function createRetrievalInspection(input){
  try{
    if(!exact(input))throw new RetrievalInspectionError();
    const owned={};for(const key of INPUT_KEYS)owned[key]=input[key];
    const chunks=copyValidatedChunkArtifact(owned.source,owned.chunkArtifact),projection=projectEmbeddingInput(chunks);
    const passages=copyQueryPassages(owned.embeddingArtifact,projection);
    const topK=owned.retrieval?.requestedTopK,downloadTotal=owned.query?.receipt?.verifiedBytes;
    const result=copyQueryResult({query:owned.query,retrieval:owned.retrieval},projection,passages,topK,downloadTotal);
    const all=rankCandidates(projection,passages,{representationId:result.query.representationId,
      representation:result.query.representation,vector:result.query.vector},{topK:passages.counts.chunks});
    // Exact equality uses the same accumulation order as the accepted ranker.
    if(all.queryNorm!==result.retrieval.queryNorm
        ||result.retrieval.candidates.some((row,index)=>['chunkId','ordinal','score','dotProduct','chunkNorm']
          .some(key=>row[key]!==all.candidates[index][key])))throw new RetrievalInspectionError();
    const rankedChunks=all.candidates.map((row,index)=>({rank:index+1,...row,selected:index<result.retrieval.returnedCount,
      physicalPageNumber:chunks.chunks[row.ordinal].physicalPageNumber,pageLabel:chunks.chunks[row.ordinal].pageLabel}));
    const record=freeze({schemaVersion:1,status:'inspection-recomputed',source:{...chunks.source},
      representationId:all.representationId,dimensions:result.query.vector.length,chunkCount:rankedChunks.length,
      requestedTopK:topK,returnedCount:result.retrieval.returnedCount,queryNorm:all.queryNorm,rankedChunks});
    return Object.freeze({record,components(ordinal){
      if(!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=passages.counts.chunks)throw new RetrievalInspectionError();
      const row=rankedChunks.find(candidate=>candidate.ordinal===ordinal),passage=passages.vectors[ordinal],query=result.query.vector;
      let cumulativeDot=0,querySquared=0,passageSquared=0;
      const components=query.map((value,index)=>{
        const product=value*passage[index];cumulativeDot+=product;querySquared+=value*value;passageSquared+=passage[index]*passage[index];
        return {dimension:index+1,queryValue:value,passageValue:passage[index],product,cumulativeDot};
      });
      const queryNorm=Math.sqrt(querySquared),chunkNorm=Math.sqrt(passageSquared),denominator=queryNorm*chunkNorm;
      if(cumulativeDot!==row.dotProduct||queryNorm!==record.queryNorm||chunkNorm!==row.chunkNorm
          ||cumulativeDot/denominator!==row.score)throw new RetrievalInspectionError();
      return freeze({schemaVersion:1,status:'inspection-recomputed',sourceSha256:record.source.sha256,
        representationId:record.representationId,...row,dimensions:query.length,queryNorm,
        querySquared,passageSquared,denominator,components});
    }});
  }catch{throw new RetrievalInspectionError();}
}
