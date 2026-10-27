import type {Book,ExtractedBook,Warning,Embedder} from '../domain/model.js';
import {embedPassages} from './embeddings.js';
import {DomainError} from '../domain/result.js';
import type {LibrarySource,DocumentExtractor,RefreshReport} from '../domain/source.js';
import type {IndexStore} from './store.js';
export interface RefreshCoordinator {metadata(signal:AbortSignal):Promise<RefreshReport>;refresh(options:{content:'available'|'all';rebuild:boolean},signal:AbortSignal):Promise<RefreshReport>;prepare(book:Book,signal:AbortSignal):Promise<ExtractedBook>;}
export function createRefreshCoordinator(deps:{source:LibrarySource;store:IndexStore;extractor:DocumentExtractor;embedder?:Embedder|null}):RefreshCoordinator{
  const {source,store,extractor}=deps;let pending:Promise<RefreshReport>|null=null;
  const asError=(error:unknown)=>error instanceof DomainError?error:new DomainError('SOURCE_UNAVAILABLE','Source refresh could not be completed.',true);
  async function vectors(book_id:string,signal:AbortSignal){if(deps.embedder&&!store.hasEmbeddings(book_id,deps.embedder.manifest)){const chunks=await embedPassages(deps.embedder,store.evidenceForBook(book_id),signal);signal.throwIfAborted();store.replaceEmbeddings(book_id,deps.embedder.manifest,chunks);}}
  async function metadata(signal:AbortSignal,rebuild=false):Promise<RefreshReport>{
    if(extractor.cacheKey)store.reconcileExtractionProfiles(extractor.cacheKey);
    try{const read=await source.readSnapshot(rebuild?null:store.getCheckpoint(),signal);signal.throwIfAborted();store.applySourceRead(read);if(extractor.cacheKey)store.reconcileExtractionProfiles(extractor.cacheKey);return {refreshed_at:read.refreshed_at,indexed:0,warnings:store.warnings()};}
    catch(error){const failure=asError(error);if(failure.code==='ACCOUNT_CHANGED'||!store.hasSnapshot())throw failure;store.recordRefreshFailure(failure);return {refreshed_at:store.refreshedAt(),indexed:0,warnings:store.warnings()};}
  }
  async function prepare(book:Book,acquire:boolean,signal:AbortSignal,rebuild=false):Promise<ExtractedBook>{
    const current=store.getBook(book.id);if(!current)throw new DomainError('CONTENT_UNAVAILABLE','Book is no longer in the catalogue.');
    const file=await source.resolveBookFile(current,{acquire,signal});if(file.status!=='available')throw new DomainError(file.code,file.message);
    const saved=store.getContent(current.id);if(!rebuild&&saved?.revision===file.revision&&saved.extraction_key===extractor.cacheKey?.(current))return saved;
    const content=await extractor.extract(current,file);signal.throwIfAborted();store.replaceContent(current.id,content);return content;
  }
  return {
    async metadata(signal){if(pending)return pending;pending=store.withWriter(async()=>{signal.throwIfAborted();return metadata(signal);});try{return await pending;}finally{pending=null;}},
    async refresh(options,signal){return store.withWriter(async()=>{signal.throwIfAborted();const report=await metadata(signal,options.rebuild);if(options.rebuild)store.rebuildSearch();const warnings:Warning[]=[...report.warnings];let cursor:string|null=null,indexed=0;const ids:string[]=[];
      do{const page=store.listBooks({limit:50,cursor});cursor=page.next_cursor;ids.push(...page.items.map(b=>b.id));}while(cursor);
      for(const id of ids){const book=store.getBook(id)!;signal.throwIfAborted();if(['EPUB','PDF'].includes(book.format))try{await prepare(book,options.content==='all',signal,options.rebuild);indexed++;}catch(error){const failure=asError(error);warnings.push({code:failure.code,message:failure.message});if(!['CONTENT_UNAVAILABLE','PATH_NOT_ALLOWED'].includes(failure.code))store.markContentError(book.id,failure);}try{await vectors(id,signal);}catch{warnings.push({code:'SEMANTIC_INCOMPLETE',message:'Some evidence has no current semantic vector. Keyword search remains available.'});}}
      return {refreshed_at:store.refreshedAt(),indexed,warnings:[...new Map(warnings.map(w=>[w.code+'\0'+w.message,w])).values()]};});},
    async prepare(book,signal){return store.withWriter(async()=>{const content=await prepare(book,true,signal);await vectors(book.id,signal);return content;});}
  };
}
