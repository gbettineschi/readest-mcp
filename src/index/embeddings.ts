import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import type {EmbeddingConfig} from '../config.js';
import type {Embedder,ModelManifest,EmbeddedChunk,Passage} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import {withFileLock} from '../security/lock.js';
import pinned from './model.json' with {type:'json'};
export const modelManifest:ModelManifest={id:pinned.id,revision:pinned.revision,dtype:pinned.dtype,dimensions:pinned.dimensions,chunk_version:pinned.chunk_version};
const modelPath=(config:EmbeddingConfig)=>path.join(config.model_dir,pinned.revision);
async function valid(file:string,expected:{size:number;sha256:string}):Promise<boolean>{try{if((await fs.stat(file)).size!==expected.size)return false;const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex')===expected.sha256;}catch{return false;}}
export async function fetchModel(config:EmbeddingConfig,options:{signal?:AbortSignal}={}):Promise<ModelManifest>{
 const dir=modelPath(config);return withFileLock(path.join(config.model_dir,'download.lock'),async()=>{
  options.signal?.throwIfAborted();await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.rm(path.join(dir,'ready.json'),{force:true});
  for(const file of pinned.files){options.signal?.throwIfAborted();const target=path.join(dir,file.name);if(await valid(target,file))continue;
   await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});const temp=target+'.part';const handle=await fs.open(temp,'w',0o600);
   try{const response=await fetch(`https://huggingface.co/${pinned.id}/resolve/${pinned.revision}/${file.name}`,{signal:AbortSignal.any([options.signal??new AbortController().signal,AbortSignal.timeout(300_000)])});if(!response.ok||!response.body)throw new Error('Download failed');
    let size=0;const digest=createHash('sha256');for await(const chunk of response.body){size+=chunk.length;if(size>file.size)throw new Error('Unexpected model size');digest.update(chunk);await handle.write(chunk);}
    if(size!==file.size||digest.digest('hex')!==file.sha256)throw new Error('Model checksum mismatch');await handle.close();await fs.rename(temp,target);
   }catch{await handle.close().catch(()=>{});await fs.rm(temp,{force:true});throw new DomainError('MODEL_DOWNLOAD_FAILED','Pinned model download failed or was interrupted. Retry models fetch.',true);}
  }
  await fs.writeFile(path.join(dir,'ready.json'),JSON.stringify(modelManifest),{mode:0o600});return modelManifest;
 });
}
export async function chunkText(text:string,count:(text:string)=>Promise<number>):Promise<{start:number;end:number}[]>{
 const ranges:{start:number;end:number}[]=[];let start=0;
 while(start<text.length){let end=Math.min(text.length,start+1600);
  if(end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1]!))end--;
  while(await count('passage: '+text.slice(start,end))>512){end=start+Math.floor((end-start)*0.75);if(end<=start)throw new DomainError('CAPABILITY_UNAVAILABLE','Tokenizer cannot fit a passage.');if(/[\uD800-\uDBFF]/u.test(text[end-1]!))end--;}
  ranges.push({start,end});start=end;
 }return ranges;
}
export async function embedPassages(embedder:Embedder,passages:Passage[],signal:AbortSignal):Promise<EmbeddedChunk[]>{
 const chunks:EmbeddedChunk[]=[];for(const passage of passages){for(const range of await chunkText(passage.text,embedder.countTokens)){signal.throwIfAborted();const [vector]=await embedder.embed([passage.text.slice(range.start,range.end)],'passage');if(!vector)throw new DomainError('CAPABILITY_UNAVAILABLE','Embedding backend returned no vector.');chunks.push({passage_id:passage.passage_id,...range,vector});}}return chunks;
}
export async function createLocalEmbedder(config:EmbeddingConfig):Promise<Embedder>{
 const unavailable=()=>new DomainError('CAPABILITY_UNAVAILABLE','Local semantic model is unavailable. Enable embeddings and run models fetch.');
 if(!config.enabled)throw unavailable();const dir=modelPath(config);
 try{if(JSON.stringify(JSON.parse(await fs.readFile(path.join(dir,'ready.json'),'utf8')))!==JSON.stringify(modelManifest))throw unavailable();for(const file of pinned.files)if(!await valid(path.join(dir,file.name),file))throw unavailable();
  const {env,pipeline}=await import('@huggingface/transformers');env.allowRemoteModels=false;env.useBrowserCache=false;env.useFSCache=false;
  const extract=await pipeline('feature-extraction',dir,{dtype:'q8',device:'cpu',local_files_only:true,session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
  const countTokens=async(text:string)=>extract.tokenizer(text,{truncation:false}).input_ids.size;
  return {manifest:modelManifest,countTokens,close:()=>extract.dispose(),async embed(texts,kind){const vectors:Float32Array[]=[];for(const text of texts){const prefixed=kind+': '+text;if(await countTokens(prefixed)>512)throw new DomainError('QUERY_TOO_LONG','Text exceeds the semantic model token budget. Use a shorter query.');const result=await extract(prefixed,{pooling:'mean',normalize:true});const vector=Float32Array.from(result.data as Float32Array);if(vector.length!==384||!vector.every(Number.isFinite))throw unavailable();vectors.push(vector);}return vectors;}};
 }catch(error){if(error instanceof DomainError)throw error;throw unavailable();}
}
