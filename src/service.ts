import type {Book,Evidence,Embedder,ExtractedBook,Warning} from './domain/model.js';
import {hash,scopedId} from './domain/model.js';
import {DomainError,makeResult,type Result,type Meta} from './domain/result.js';
import type {LibrarySource} from './domain/source.js';
import type {IndexStore} from './index/store.js';
import type {RefreshCoordinator} from './index/refresh.js';
import {cursorKey,readCursor,writeCursor} from './index/search.js';
import {matchAnnotationContext} from './content/references.js';
import type {ToolHandlers,Inputs,Outputs,ToolName} from './mcp/schemas.js';
import {LIMITS} from './limits.js';
interface Scope {targets:string[];filters?:Inputs['list_books']['filters'];coverage?:()=>Meta['coverage'];}
export function createToolHandlers(deps:{source:LibrarySource;store:IndexStore;refresh:RefreshCoordinator;embedder?:Embedder|null;clock?:()=>number}):ToolHandlers{
 const {source,store,refresh,embedder}=deps,clock=deps.clock??Date.now;let attempted:number|null=null,pending:Promise<void>|null=null;
 const signal=()=>new AbortController().signal;
 async function ensure(){if(attempted!==null&&clock()-attempted<300_000&&store.hasSnapshot())return;if(pending)return pending;attempted=clock();pending=refresh.metadata(signal()).then(()=>{});try{await pending;}finally{pending=null;}}
 function book(id:string):Book{const b=store.getBook(id);if(!b)throw new DomainError('BOOK_NOT_FOUND','Book is not in the current catalogue.');return b;}
 async function content(b:Book,warnings:Warning[]):Promise<ExtractedBook>{let extracted;try{extracted=await refresh.prepare(b,signal());}catch(error){const cached=store.getContent(b.id);if(!cached)throw error;warnings.push({code:'USING_CACHE',message:'Using the last indexed book revision; the source file could not be revalidated.'});extracted=cached;}warnings.push(...extracted.warnings);return extracted;}
 async function run<K extends ToolName>(name:K,work:(warnings:Warning[])=>Promise<Outputs[K]>,targets:string[]=[],filters?:Inputs['list_books']['filters'],resolveScope?:()=>Scope):Promise<Result<Outputs[K]>>{
  const warnings:Warning[]=[];const scope=()=>resolveScope?.()??{targets,filters};const meta=():Meta=>{const s=scope();return {source:source.mode,refreshed_at:store.refreshedAt(),from_cache:warnings.some(w=>w.code==='USING_CACHE'),coverage:s.coverage?.()??store.coverage(s.targets,s.filters)};};
  try{await ensure();const data=await work(warnings),s=scope(),coverage=s.coverage?.()??store.coverage(s.targets,s.filters);warnings.push(...store.warningsFor(s.targets,s.filters));if(s.targets.includes('book_text'))warnings.push(...store.contentWarnings(s.filters));
   if(coverage.completeness==='partial'&&s.targets.length)warnings.push({code:'COVERAGE_INCOMPLETE',message:'Some requested evidence is unavailable or has not been indexed.'});
   return makeResult({data,status:warnings.length?'partial':'ok',warnings:[...new Map(warnings.map(({code,message})=>[code+'\0'+message,{code,message}])).values()],error:null,meta:meta()});
  }catch(error){const failure=error instanceof DomainError?error:new DomainError('OPERATION_FAILED','The reading operation could not be completed.',true);return makeResult<Outputs[K]>({data:null,status:'error',warnings:[],error:{code:failure.code,message:failure.message,retryable:failure.retryable},meta:meta()});}
 }
 return {
  library_status:()=>run('library_status',async()=>({...store.status(),capabilities:{semantic:Boolean(embedder)}})),
  list_books:input=>run('list_books',async()=>store.listBooks(input),[],input.filters),
  get_book:input=>run('get_book',async warnings=>{let b=book(input.book_id);if(input.include_structure){await content(b,warnings);b=book(b.id);}return {book:b,structure:input.include_structure?store.getStructure(b.id,input):null};},input.include_structure?['metadata','book_text']:['metadata'],{book_ids:[input.book_id]}),
  list_annotations:input=>run('list_annotations',async warnings=>{const b=book(input.book_id),page=store.listAnnotations(input);if(b.availability.annotations!=='available'){if(!page.items.length)throw new DomainError('ANNOTATIONS_UNAVAILABLE','Saved annotation data is unavailable for this book. Sync it in Readest, then refresh.');warnings.push({code:'USING_CACHE',message:'Using previously saved annotation data.'});}if(page.items.some(n=>{const saved=store.getAnnotation(n.id)!;return (saved.note?.length??0)>LIMITS.excerpt||(saved.quote?.length??0)>LIMITS.excerpt;}))warnings.push({code:'TRUNCATED',message:'Annotation summaries are shortened. Read an annotation by ID for its full text.'});return page;},['quotes','notes'],{book_ids:[input.book_id]}),
  search_library:input=>{let semantic:import('./domain/model.js').QueryEmbedding|null=null;return run('search_library',async warnings=>{
   if(input.mode!=='keyword'){try{if(!embedder)throw new DomainError('CAPABILITY_UNAVAILABLE','Local semantic search is unavailable. Enable embeddings and fetch the model.');const [vector]=await embedder.embed([input.query],'query');if(!vector)throw new DomainError('CAPABILITY_UNAVAILABLE','Embedding backend returned no query vector.');semantic={vector,manifest:embedder.manifest};}catch(error){if(input.mode==='semantic')throw error;warnings.push({code:'SEMANTIC_UNAVAILABLE',message:'Semantic search is unavailable; returning keyword results.'});}}
   if(semantic){const coverage=store.semanticCoverage(semantic.manifest,input.targets,input.filters);if((coverage.covered_books??0)<(coverage.known_books??0))warnings.push({code:'SEMANTIC_INCOMPLETE',message:'Some requested evidence has no current semantic vector or is unavailable. Run refresh to index it.'});}
   return store.search(input,semantic);
  },input.targets,input.filters,()=>({targets:input.targets,filters:input.filters,coverage:()=>semantic?store.semanticCoverage(semantic.manifest,input.targets,input.filters):store.coverage(input.targets,input.filters)}));},
  read_content:input=>run('read_content',async warnings=>{
   const {selector}=input;let items:Evidence[]=[],revision='',annotation=null,match:null|'exact'|'ambiguous'|'unresolved'=null;
   if(selector.kind==='annotation'){
    const note=store.getAnnotation(selector.id);if(!note)throw new DomainError('STALE_REFERENCE','Annotation reference is no longer available.');annotation={...note};revision=hash(JSON.stringify(note));
    const ids=new Set(['quote','note'].map(kind=>scopedId('p',note.id,revision+'\0'+kind)));items=store.evidenceForBook(note.book_id).filter(p=>ids.has(p.passage_id));
    if(input.context_chars){try{const extracted=await content(book(note.book_id),warnings);const context=matchAnnotationContext(note,extracted);match=context.status;
      if(context.items.length)items=context.items.map(p=>{const at=Math.max(0,p.text.indexOf(note.quote??'')-input.context_chars),end=Math.min(p.text.length,at+(note.quote?.length??0)+2*input.context_chars);return {...p,text:p.text.slice(at,end),location:{...p.location,start:p.location.start+at,end:p.location.start+end}};});
     }catch{match='unresolved';warnings.push({code:'CONTEXT_UNAVAILABLE',message:'Annotation is available, but surrounding book text could not be resolved.'});}}
    for(const key of ['quote','note'] as const)if(annotation[key]&&annotation[key]!.length>LIMITS.excerpt){annotation[key]=annotation[key]!.slice(0,LIMITS.excerpt);warnings.push({code:'TRUNCATED',message:'Annotation summary is truncated; follow evidence continuation for its text.'});}
    if(Buffer.byteLength(JSON.stringify(annotation.ink))>4096){annotation.ink=null;warnings.push({code:'TRUNCATED',message:'Ink strokes exceed the bounded annotation summary.'});}
   }else{
    const before=selector.kind==='passage'?store.getPassage(selector.id):store.findStructure(selector.id);if(!before)throw new DomainError('STALE_REFERENCE','Content reference is no longer available. Get a current book structure or search result.');
    if(selector.kind==='passage'&&'source_kind' in before&&before.source_kind!=='book_text'){items=[before];revision=before.revision;}
    else{const extracted=await content(book(before.book_id),warnings);revision=extracted.revision;
    if(before.revision!==revision)throw new DomainError('STALE_REFERENCE','Reference belongs to a different book revision or edition.');
    if(selector.kind==='passage'){const p=store.getPassage(selector.id);if(!p)throw new DomainError('STALE_REFERENCE','Passage is no longer available.');items=[p];}
    else {items=extracted.passages.filter(p=>p.structure_id===selector.id).sort((a,b)=>a.order-b.order);if('page' in before&&before.page&&extracted.pages.some(p=>p.page===before.page&&p.status!=='text'))warnings.push({code:'PAGE_TEXT_UNAVAILABLE',message:'This PDF page has no extractable text or could not be read. It may be blank or require OCR.'});}}
   }
   const total=items.reduce((n,p)=>n+p.text.length,0),material=items.map(p=>[p.passage_id,p.revision,p.location.start,p.location.end]);const key=cursorKey({selector,revision,material,match,max_chars:input.max_chars,context_chars:input.context_chars}),offset=readCursor(input.cursor,0,key,total);let skip=offset,remaining=input.max_chars,consumed=0,bytes=Buffer.byteLength(JSON.stringify(annotation));const output:Evidence[]=[];
   for(const p of items){if(skip>=p.text.length){skip-=p.text.length;continue;}if(!remaining)break;const end=Math.min(p.text.length,skip+remaining),candidate={...p,text:p.text.slice(skip,end),location:{...p.location,start:p.location.start+skip,end:p.location.start+end}},size=Buffer.byteLength(JSON.stringify(candidate));if(bytes+size>LIMITS.outputBytes-8192){if(!output.length)throw new DomainError('LIMIT_EXCEEDED','Selected evidence exceeds the response budget. Request a smaller max_chars.');break;}output.push(candidate);bytes+=size;remaining-=end-skip;consumed+=end-skip;skip=0;}
   return {items:output,annotation,match,next_cursor:total>offset+consumed?writeCursor(0,key,offset+consumed):null};
  },[],undefined,()=>{const selected=input.selector,record=selected.kind==='annotation'?store.getAnnotation(selected.id):selected.kind==='passage'?store.getPassage(selected.id):store.findStructure(selected.id);const targets=selected.kind==='annotation'?input.context_chars?['book_text','quotes','notes']:['quotes','notes']:record&&'source_kind' in record&&record.source_kind!=='book_text'?[record.source_kind==='quote'?'quotes':'notes']:['book_text'];return {targets,filters:{book_ids:record?[record.book_id]:[]}};})
 };
}
