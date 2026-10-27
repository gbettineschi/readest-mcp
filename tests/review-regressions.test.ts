import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {localLibrary,keys} from './helpers/local-library.js';
import {cloudFixture} from './helpers/cloud-http.js';
import {epub,pdf} from './helpers/books.js';
import {createLocalSource} from '../dist/sources/local.js';
import {createCloudSource} from '../dist/sources/cloud.js';
import {openIndex} from '../dist/index/store.js';
import {createRefreshCoordinator} from '../dist/index/refresh.js';
import {createDocumentExtractor} from '../dist/content/extract.js';
import {createToolHandlers} from '../dist/service.js';
import {inputSchemas} from '../dist/mcp/schemas.js';
import {blankLocation} from '../dist/domain/model.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
const signal=()=>new AbortController().signal;
async function fixture(options:{body?:string;pdf?:boolean;notes?:unknown[]}={}){
 const f=await localLibrary();cleanups.push(f.cleanup);const file=path.join(f.library,keys.a,options.pdf?'book.pdf':'book.epub');await fs.rm(path.join(f.library,keys.a,'book.epub'));
 f.books[0]!.format=options.pdf?'PDF':'EPUB';await fs.writeFile(path.join(f.library,'library.json'),JSON.stringify(f.books));await fs.writeFile(file,options.pdf?await pdf(['Known evidence',null]):await epub(3,options.body??'Known evidence'));
 if(options.notes)await fs.writeFile(path.join(f.library,keys.a,'config.json'),JSON.stringify({schemaVersion:3,booknotes:options.notes}));
 const source=createLocalSource(f.config),store=openIndex(f.config,source.source_id);cleanups.push(async()=>store.close());const refresh=createRefreshCoordinator({source,store,extractor:createDocumentExtractor()});await refresh.refresh({content:'available',rebuild:false},signal());
 const handlers=createToolHandlers({source,store,refresh});const id=store.listBooks(inputSchemas.list_books.parse({})).items.find(b=>b.source_key===keys.a)!.id;return {...f,file,source,store,refresh,handlers,id};
}
const note=(value:string)=>({id:'n',type:'notebook',note:value,text:'Needle',cfi:null});
it('exposes mixed PDF gaps in search, structure and an empty page read',async()=>{
 const f=await fixture({pdf:true}),found=await f.handlers.search_library(inputSchemas.search_library.parse({query:'Known',targets:['book_text'],filters:{book_ids:[f.id]}}));
 expect(found.status).toBe('partial');expect(found.warnings.some(w=>w.code==='TEXT_GAPS')).toBe(true);expect(found.meta.coverage.completeness).toBe('partial');
 const book=await f.handlers.get_book(inputSchemas.get_book.parse({book_id:f.id,include_structure:true}));expect(book.warnings.some(w=>w.code==='TEXT_GAPS')).toBe(true);
 const page=book.data!.structure!.items.find(s=>s.page===2)!;const read=await f.handlers.read_content(inputSchemas.read_content.parse({selector:{kind:'structure',id:page.id}}));expect(read.status).toBe('partial');expect(read.warnings.some(w=>w.code==='PAGE_TEXT_UNAVAILABLE')).toBe(true);
});
it('checks semantic coverage after the first 50 books, with target-specific vectors',async()=>{
 const f=await fixture();const base=f.store.getBook(f.id)!,books=Array.from({length:51},(_,i)=>({...base,id:'b'+String(i).padStart(2,'0'),source_key:'k'+i,availability:{...base.availability,index:'pending' as const}}));
 const notes=books.map(b=>({id:'n'+b.id,book_id:b.id,kind:'notebook' as const,quote:null,note:'My thought',color:null,style:null,locator:{cfi:null,page:null,xpointer0:null,xpointer1:null},created_at:null,updated_at:null,ink:null,ink_available:false}));
 const snapshot={source_id:f.source.source_id,kind:'full' as const,books,annotations:notes,deleted_book_ids:[],deleted_annotation_ids:[],checkpoint:{version:1 as const},refreshed_at:new Date().toISOString(),coverage:{scope:'configured_source' as const,completeness:'complete' as const,known_books:51,covered_books:51},warnings:[]};f.store.applySourceRead(snapshot);
 const manifest={id:'test',revision:'r',dtype:'f32',dimensions:2,chunk_version:1},embedder={manifest,countTokens:async(s:string)=>s.length,embed:async(texts:string[])=>texts.map(()=>Float32Array.of(1,0))};
 for(const [i,b] of books.entries()){f.store.replaceContent(b.id,{revision:'r',structure:[],pages:[],warnings:[],passages:[{passage_id:'p'+i,book_id:b.id,revision:'r',text:'Known evidence',source_kind:'book_text',title:b.title,author:b.author,structure_id:'s'+i,order:0,location:{...blankLocation('epub'),end:14}}]});
  f.store.replaceEmbeddings(b.id,manifest,f.store.evidenceForBook(b.id).filter(p=>p.source_kind==='note'||i<50).map(p=>({passage_id:p.passage_id,start:0,end:p.text.length,vector:Float32Array.of(1,0)})));}
 const refresh={metadata:async()=>({refreshed_at:snapshot.refreshed_at,indexed:0,warnings:[]}),refresh:f.refresh.refresh,prepare:f.refresh.prepare};const handlers=createToolHandlers({source:f.source,store:f.store,refresh,embedder});
 const text=await handlers.search_library(inputSchemas.search_library.parse({query:'idea',mode:'semantic',targets:['book_text']}));expect(text.status).toBe('partial');expect(text.warnings.some(w=>w.code==='SEMANTIC_INCOMPLETE')).toBe(true);expect(text.meta.coverage).toMatchObject({known_books:51,covered_books:50,completeness:'partial'});
 const personal=await handlers.search_library(inputSchemas.search_library.parse({query:'idea',mode:'semantic',targets:['notes']}));expect(personal.status).toBe('ok');expect(personal.meta.coverage.completeness).toBe('complete');
});
it('binds annotation-context continuation to the actual book edition and resolution',async()=>{
 const f=await fixture({body:'a'.repeat(100)+'Needle'+'b'.repeat(200),notes:[note('My thought')]});const notes=await f.handlers.list_annotations(inputSchemas.list_annotations.parse({book_id:f.id})),id=notes.data!.items[0]!.id;
 const args={selector:{kind:'annotation',id},context_chars:200,max_chars:40};const first=await f.handlers.read_content(inputSchemas.read_content.parse(args));expect(first.data!.next_cursor).not.toBeNull();
 await fs.writeFile(f.file,await epub(3,'c'.repeat(100)+'Needle'+'d'.repeat(200)));const changed=await f.handlers.read_content(inputSchemas.read_content.parse({...args,cursor:first.data!.next_cursor}));expect(changed.error?.code).toBe('STALE_CURSOR');
 const next=await f.handlers.read_content(inputSchemas.read_content.parse(args));await fs.writeFile(f.file,await epub(3,'The quoted phrase has disappeared.'));expect((await f.handlers.read_content(inputSchemas.read_content.parse({...args,cursor:next.data!.next_cursor}))).error?.code).toBe('STALE_CURSOR');
});
it('labels retained offloaded text as cached and unvalidated while retaining its revision',async()=>{
 const f=await fixture(),revision=f.store.getContent(f.id)!.revision;await fs.rm(f.file);await f.refresh.metadata(signal());const result=await f.handlers.search_library(inputSchemas.search_library.parse({query:'Known',targets:['book_text'],filters:{book_ids:[f.id]}}));
 expect(result.data!.items[0]!.evidence.revision).toBe(revision);expect(result.status).toBe('partial');expect(result.meta.from_cache).toBe(true);expect(result.meta.coverage.completeness).not.toBe('complete');
});
it('marks a successfully cached empty cloud catalogue and empty notes as cached after channel failure',async()=>{
 const f=await cloudFixture();cleanups.push(f.close);f.state.empty=true;const source=await createCloudSource(f.config),store=openIndex(f.config,source.source_id);cleanups.push(async()=>store.close());const refresh=createRefreshCoordinator({source,store,extractor:createDocumentExtractor()});await refresh.metadata(signal());f.state.malformed=true;await refresh.metadata(signal());
 const handlers=createToolHandlers({source,store,refresh}),result=await handlers.list_books(inputSchemas.list_books.parse({}));expect(result.data?.items).toEqual([]);expect(result.status).toBe('partial');expect(result.meta.from_cache).toBe(true);
});
it('lists bounded notebook summaries and retrieves the full text through continuation',async()=>{
 const text='N'.repeat(70000),f=await fixture({notes:[note(text)]});const list=await f.handlers.list_annotations(inputSchemas.list_annotations.parse({book_id:f.id,limit:1}));expect(list.error).toBeNull();expect(list.data!.items[0]!.note!.length).toBeLessThanOrEqual(320);expect(list.warnings.some(w=>w.code==='TRUNCATED')).toBe(true);
 let cursor:string|null=null,read='';do{const result=await f.handlers.read_content(inputSchemas.read_content.parse({selector:{kind:'annotation',id:list.data!.items[0]!.id},max_chars:12000,cursor}));expect(result.error).toBeNull();read+=result.data!.items.filter(p=>p.source_kind==='note').map(p=>p.text).join('');cursor=result.data!.next_cursor;}while(cursor);expect(read).toBe(text);
});
it('keeps cached annotation warnings in another book out of healthy filtered results',async()=>{
 const f=await fixture();await fs.rm(path.join(f.library,keys.b,'config.json'));await f.refresh.metadata(signal());const result=await f.handlers.search_library(inputSchemas.search_library.parse({query:'Known',targets:['book_text'],filters:{book_ids:[f.id]}}));expect(result.status).toBe('ok');expect(result.meta.from_cache).toBe(false);
 const passage=result.data!.items[0]!.evidence.passage_id,read=await f.handlers.read_content(inputSchemas.read_content.parse({selector:{kind:'passage',id:passage}}));expect(read.meta.coverage).toMatchObject({known_books:1,covered_books:1});expect(read.status).toBe('ok');
});
it('accepts bounded continuation beyond one million source characters',async()=>{
 const f=await fixture(),text='x'.repeat(1100000),content={revision:'long',structure:[{id:'long-structure',book_id:f.id,revision:'long',kind:'chapter' as const,label:'Long chapter',parent_id:null,order:0,href:null,page:null}],passages:[{passage_id:'long-passage',book_id:f.id,revision:'long',text,source_kind:'book_text' as const,title:'Long',author:'A',structure_id:'long-structure',order:0,location:{...blankLocation('epub'),end:text.length}}],pages:[],warnings:[]};f.store.replaceContent(f.id,content);
 const refresh={metadata:async()=>({refreshed_at:f.store.refreshedAt(),indexed:0,warnings:[]}),refresh:f.refresh.refresh,prepare:async()=>content};const handlers=createToolHandlers({source:f.source,store:f.store,refresh});const args={selector:{kind:'structure',id:'long-structure'},max_chars:12000};const first=await handlers.read_content(inputSchemas.read_content.parse(args));const cursor=JSON.parse(Buffer.from(first.data!.next_cursor!,'base64url').toString());cursor.o=1008000;
 const continued=await handlers.read_content(inputSchemas.read_content.parse({...args,cursor:Buffer.from(JSON.stringify(cursor)).toString('base64url')}));expect(continued.error).toBeNull();expect(continued.data!.items[0]!.location.start).toBe(1008000);
});
