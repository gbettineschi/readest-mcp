import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {localLibrary,keys} from './helpers/local-library.js';
import {epub} from './helpers/books.js';
import {createLocalSource} from '../dist/sources/local.js';
import {openIndex} from '../dist/index/store.js';
import {createRefreshCoordinator} from '../dist/index/refresh.js';
import {createDocumentExtractor} from '../dist/content/extract.js';
import {createToolHandlers} from '../dist/service.js';
import {inputSchemas} from '../dist/mcp/schemas.js';
import {createCloudSource} from '../dist/sources/cloud.js';
import {cloudFixture} from './helpers/cloud-http.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function fixture(body='A searchable paragraph'){
 const f=await localLibrary();cleanups.push(f.cleanup);await fs.writeFile(path.join(f.library,keys.a,'book.epub'),await epub(3,body));const source=createLocalSource(f.config),store=openIndex(f.config,source.source_id);cleanups.push(async()=>store.close());const refresh=createRefreshCoordinator({source,store,extractor:createDocumentExtractor()});let now=0;const handlers=createToolHandlers({source,store,refresh,clock:()=>now});return {...f,source,store,refresh,handlers,advance:()=>{now+=300_001;}};
}
it('continues a long chapter without skipped/duplicated ranges and rejects an edition-bound cursor',async()=>{
 const f=await fixture('A long paragraph. '.repeat(1000)),list=await f.handlers.list_books(inputSchemas.list_books.parse({})),id=list.data!.items.find(b=>b.source_key===keys.a)!.id;
 const detail=await f.handlers.get_book(inputSchemas.get_book.parse({book_id:id,include_structure:true}));const structure=detail.data!.structure!.items[0]!;
 const expected=f.store.getContent(id)!.passages.filter(p=>p.structure_id===structure.id).map(p=>p.text).join('');let cursor:string|null=null,body='',first:string|null=null;
 do{const result=await f.handlers.read_content(inputSchemas.read_content.parse({selector:{kind:'structure',id:structure.id},max_chars:12000,cursor}));expect(result.error).toBeNull();body+=result.data!.items.map(i=>i.text).join('');cursor=result.data!.next_cursor;first??=cursor;}while(cursor);
 expect(body).toBe(expected);expect(first).not.toBeNull();
 await fs.writeFile(path.join(f.library,keys.a,'book.epub'),await epub(3,'Changed edition'));
 const changed=await f.handlers.read_content(inputSchemas.read_content.parse({selector:{kind:'structure',id:structure.id},cursor:first}));expect(changed.error?.code).toBe('STALE_REFERENCE');
});
it('distinguishes empty/missing notes and gives actionable missing-file results',async()=>{
 const f=await fixture();const books=(await f.handlers.list_books(inputSchemas.list_books.parse({}))).data!.items;
 const empty=books.find(b=>b.source_key===keys.a)!,missing=books.find(b=>b.source_key===keys.c)!;
 expect((await f.handlers.list_annotations(inputSchemas.list_annotations.parse({book_id:empty.id}))).data?.items).toEqual([]);
 expect((await f.handlers.list_annotations(inputSchemas.list_annotations.parse({book_id:missing.id}))).error?.code).toBe('ANNOTATIONS_UNAVAILABLE');
 const unavailable=await f.handlers.get_book(inputSchemas.get_book.parse({book_id:missing.id,include_structure:true}));expect(unavailable.error?.message).toMatch(/Readest/);
});
it('keeps cached data and freshness on failed refresh; a first failure never becomes an empty library',async()=>{
 const f=await fixture();const before=await f.handlers.list_books(inputSchemas.list_books.parse({}));await fs.writeFile(path.join(f.library,'library.json'),'invalid');f.advance();
 const after=await f.handlers.list_books(inputSchemas.list_books.parse({}));expect(after.status).toBe('partial');expect(after.meta.from_cache).toBe(true);expect(after.meta.refreshed_at).toBe(before.meta.refreshed_at);expect(after.data?.items).toEqual(before.data?.items);
 const other=await fixture();await fs.writeFile(path.join(other.library,'library.json'),'invalid');const failed=await other.handlers.list_books(inputSchemas.list_books.parse({}));expect(failed.status).toBe('error');expect(failed.data).toBeNull();
});
it('reads a note returned by search even when its book file is unavailable',async()=>{
 const f=await fixture();const hit=await f.handlers.search_library(inputSchemas.search_library.parse({query:'comment',targets:['notes']}));const evidence=hit.data!.items[0]!.evidence;
 const result=await f.handlers.read_content(inputSchemas.read_content.parse({selector:{kind:'passage',id:evidence.passage_id}}));expect(result.error).toBeNull();expect(result.data?.items[0]?.text).toBe(evidence.text);
});
it('returns typed cloud timeout results with cached freshness or no data on first connection',async()=>{
 const f=await cloudFixture();cleanups.push(f.close);
 async function app(cache_dir:string){const config={...f.config,cache_dir},source=await createCloudSource(config),store=openIndex(config,source.source_id);cleanups.push(async()=>store.close());const refresh=createRefreshCoordinator({source,store,extractor:createDocumentExtractor()});let now=0;return {handlers:createToolHandlers({source,store,refresh,clock:()=>now}),advance:()=>now+=300001};}
 const cached=await app(f.config.cache_dir),fresh=await app(path.join(f.root,'fresh'));const before=await cached.handlers.library_status({});cached.advance();f.state.timeout=true;
 const [a,b]=await Promise.all([cached.handlers.list_books(inputSchemas.list_books.parse({})),fresh.handlers.list_books(inputSchemas.list_books.parse({}))]);
 expect(a.status).toBe('partial');expect(a.meta.from_cache).toBe(true);expect(a.meta.refreshed_at).toBe(before.meta.refreshed_at);expect(b.status).toBe('error');expect(b.data).toBeNull();
},25000);
it('runs semantic query embedding through the shared service and reports actual mode',async()=>{
 const f=await fixture(),embedder={manifest:{id:'test',revision:'r',dtype:'f32',dimensions:2,chunk_version:1},countTokens:async(s:string)=>s.length,embed:async(texts:string[])=>texts.map(()=>Float32Array.of(1,0))};
 const refresh=createRefreshCoordinator({source:f.source,store:f.store,extractor:createDocumentExtractor(),embedder});await refresh.refresh({content:'available',rebuild:false},new AbortController().signal);
 const handlers=createToolHandlers({source:f.source,store:f.store,refresh,embedder}),result=await handlers.search_library(inputSchemas.search_library.parse({query:'conceptual paraphrase',mode:'semantic',targets:['book_text']}));
 expect(result.data?.used_mode).toBe('semantic');expect(result.data?.items.length).toBeGreaterThan(0);expect(result.warnings.some(w=>w.code==='SEMANTIC_UNAVAILABLE')).toBe(false);
});
