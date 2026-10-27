import type {Book,Evidence,Embedder,ExtractedBook,Warning} from './domain/model.js';
import {hash,scopedId} from './domain/model.js';
import {DomainError,makeResult,type Result,type Meta} from './domain/result.js';
import type {LibrarySource} from './domain/source.js';
import type {IndexStore} from './index/store.js';
import type {RefreshCoordinator} from './index/refresh.js';
import {cursorKey,readCursor,writeCursor} from './index/search.js';
import {matchAnnotationContext} from './content/references.js';
import type {ToolHandlers,Inputs,Outputs,ToolName} from './mcp/schemas.js';
export function createToolHandlers(deps:{source:LibrarySource;store:IndexStore;refresh:RefreshCoordinator;embedder?:Embedder|null;clock?:()=>number}):ToolHandlers{
 const {source,store,refresh,embedder}=deps,clock=deps.clock??Date.now;let attempted:number|null=null,pending:Promise<void>|null=null;
 const signal=()=>new AbortController().signal;
 async function ensure(){if(attempted!==null&&clock()-attempted<300_000&&store.hasSnapshot())return;if(pending)return pending;attempted=clock();pending=refresh.metadata(signal()).then(()=>{});try{await pending;}finally{pending=null;}}
 function book(id:string):Book{const b=store.getBook(id);if(!b)throw new DomainError('BOOK_NOT_FOUND','Book is not in the current catalogue.');return b;}
 async function content(b:Book,warnings:Warning[]):Promise<ExtractedBook>{try{return await refresh.prepare(b,signal());}catch(error){const cached=store.getContent(b.id);if(!cached)throw error;warnings.push({code:'USING_CACHE',message:'Using the last indexed book revision; the source file could not be revalidated.'});return cached;}}
 async function run<K extends ToolName>(name:K,work:(warnings:Warning[])=>Promise<Outputs[K]>,targets:string[]=[],filters?:Inputs['list_books']['filters']):Promise<Result<Outputs[K]>>{
  const warnings:Warning[]=[];const meta=():Meta=>({source:source.mode,refreshed_at:store.refreshedAt(),from_cache:warnings.some(w=>w.code==='USING_CACHE'),coverage:store.coverage(targets,filters)});
  try{await ensure();const coverage=store.coverage(targets,filters);warnings.push(...store.warnings().filter(w=>!w.code.startsWith('ANNOTATION')||(targets.some(t=>t==='quotes'||t==='notes')&&coverage.completeness!=='complete')));
   const data=await work(warnings);if(coverage.completeness==='partial'&&targets.length)warnings.push({code:'COVERAGE_INCOMPLETE',message:'Some requested evidence is unavailable or has not been indexed.'});
   return makeResult({data,status:warnings.length?'partial':'ok',warnings:[...new Map(warnings.map(w=>[w.code+'\0'+w.message,w])).values()],error:null,meta:meta()});
  }catch(error){const failure=error instanceof DomainError?error:new DomainError('OPERATION_FAILED','The reading operation could not be completed.',true);return makeResult<Outputs[K]>({data:null,status:'error',warnings:[],error:{code:failure.code,message:failure.message,retryable:failure.retryable},meta:meta()});}
 }
 return {
  library_status:()=>run('library_status',async()=>({...store.status(),capabilities:{semantic:Boolean(embedder)}})),
  list_books:input=>run('list_books',async()=>store.listBooks(input),[],input.filters),
  get_book:input=>run('get_book',async warnings=>{let b=book(input.book_id);if(input.include_structure){await content(b,warnings);b=book(b.id);}return {book:b,structure:input.include_structure?store.getStructure(b.id,input):null};},[],{book_ids:[input.book_id]}),
  list_annotations:input=>run('list_annotations',async warnings=>{const b=book(input.book_id),page=store.listAnnotations(input);if(b.availability.annotations!=='available'){if(!page.items.length)throw new DomainError('ANNOTATIONS_UNAVAILABLE','Saved annotation data is unavailable for this book. Sync it in Readest, then refresh.');warnings.push({code:'USING_CACHE',message:'Using previously saved annotation data.'});}return page;},['quotes','notes'],{book_ids:[input.book_id]}),
  search_library:input=>run('search_library',async warnings=>{
   let semantic=null;if(input.mode!=='keyword'){try{if(!embedder)throw new DomainError('CAPABILITY_UNAVAILABLE','Local semantic search is unavailable. Enable embeddings and fetch the model.');const [vector]=await embedder.embed([input.query],'query');if(!vector)throw new DomainError('CAPABILITY_UNAVAILABLE','Embedding backend returned no query vector.');semantic={vector,manifest:embedder.manifest};}catch(error){if(input.mode==='semantic')throw error;warnings.push({code:'SEMANTIC_UNAVAILABLE',message:'Semantic search is unavailable; returning keyword results.'});}}
   if(semantic){const books=store.listBooks({...input,limit:50,cursor:null}).items;if(books.some(b=>!store.hasEmbeddings(b.id,semantic!.manifest)))warnings.push({code:'SEMANTIC_INCOMPLETE',message:'Some evidence has no current semantic vector. Run refresh to index it.'});}
   return store.search(input,semantic);
  },input.targets,input.filters),
  read_content:input=>run('read_content',async warnings=>{
   const {selector}=input;let items:Evidence[]=[],revision='',annotation=null,match:null|'exact'|'ambiguous'|'unresolved'=null;
   if(selector.kind==='annotation'){
    const note=store.getAnnotation(selector.id);if(!note)throw new DomainError('STALE_REFERENCE','Annotation reference is no longer available.');annotation={...note};revision=hash(JSON.stringify(note));
    const ids=new Set(['quote','note'].map(kind=>scopedId('p',note.id,revision+'\0'+kind)));items=store.evidenceForBook(note.book_id).filter(p=>ids.has(p.passage_id));
    if(input.context_chars){try{const extracted=await content(book(note.book_id),warnings);const context=matchAnnotationContext(note,extracted);match=context.status;
      if(context.items.length)items=context.items.map(p=>{const at=Math.max(0,p.text.indexOf(note.quote??'')-input.context_chars),end=Math.min(p.text.length,at+(note.quote?.length??0)+2*input.context_chars);return {...p,text:p.text.slice(at,end),location:{...p.location,start:p.location.start+at,end:p.location.start+end}};});
     }catch{match='unresolved';warnings.push({code:'CONTEXT_UNAVAILABLE',message:'Annotation is available, but surrounding book text could not be resolved.'});}}
    for(const key of ['quote','note'] as const)if(annotation[key]&&annotation[key]!.length>input.max_chars){annotation[key]=annotation[key]!.slice(0,input.max_chars);warnings.push({code:'TRUNCATED',message:'Annotation summary is truncated; follow evidence continuation for its text.'});}
    if(JSON.stringify(annotation.ink).length>input.max_chars){annotation.ink=null;warnings.push({code:'TRUNCATED',message:'Ink strokes exceed the requested content bound.'});}
   }else{
    const before=selector.kind==='passage'?store.getPassage(selector.id):store.findStructure(selector.id);if(!before)throw new DomainError('STALE_REFERENCE','Content reference is no longer available. Get a current book structure or search result.');
    if(selector.kind==='passage'&&'source_kind' in before&&before.source_kind!=='book_text'){items=[before];revision=before.revision;}
    else{const extracted=await content(book(before.book_id),warnings);revision=extracted.revision;
    if(before.revision!==revision)throw new DomainError('STALE_REFERENCE','Reference belongs to a different book revision or edition.');
    if(selector.kind==='passage'){const p=store.getPassage(selector.id);if(!p)throw new DomainError('STALE_REFERENCE','Passage is no longer available.');items=[p];}
    else items=extracted.passages.filter(p=>p.structure_id===selector.id).sort((a,b)=>a.order-b.order);}
   }
   const key=cursorKey({selector,revision,max_chars:input.max_chars,context_chars:input.context_chars}),offset=readCursor(input.cursor,0,key);let skip=offset,remaining=input.max_chars,total=0;const output:Evidence[]=[];
   for(const p of items){total+=p.text.length;if(skip>=p.text.length){skip-=p.text.length;continue;}if(!remaining)continue;const end=Math.min(p.text.length,skip+remaining);output.push({...p,text:p.text.slice(skip,end),location:{...p.location,start:p.location.start+skip,end:p.location.start+end}});remaining-=end-skip;skip=0;}
   if(offset>total)throw new DomainError('INVALID_CURSOR','Content cursor is outside the selected text.');return {items:output,annotation,match,next_cursor:total>offset+input.max_chars?writeCursor(0,key,offset+input.max_chars):null};
  })
 };
}
