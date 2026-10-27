import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openIndex} from '../dist/index/store.js';
import {createRefreshCoordinator} from '../dist/index/refresh.js';
import {createLocalSource} from '../dist/sources/local.js';
import {createCloudSource} from '../dist/sources/cloud.js';
import {createDocumentExtractor} from '../dist/content/extract.js';
import {inputSchemas} from '../dist/mcp/schemas.js';
import {localLibrary,keys} from './helpers/local-library.js';
import {cloudFixture} from './helpers/cloud-http.js';
import {epub} from './helpers/books.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
const signal=()=>new AbortController().signal;
async function fixture(){const f=await localLibrary();cleanups.push(f.cleanup);await fs.writeFile(path.join(f.library,keys.a,'book.epub'),await epub());const source=createLocalSource(f.config),store=openIndex(f.config,source.source_id);cleanups.push(async()=>store.close());const refresh=createRefreshCoordinator({source,store,extractor:createDocumentExtractor()});await refresh.refresh({content:'available',rebuild:false},signal());return {...f,source,store,refresh};}
describe('shared evidence index',()=>{
  it('searches text and personal notes separately, including annotation-only books',async()=>{
    const f=await fixture();const text=await f.store.search(inputSchemas.search_library.parse({query:'incertezza',targets:['book_text']}),null);
    expect(text.items.map(h=>h.evidence.text)).toEqual(['L’incertezza non impedisce una scelta ragionevole.']);
    const notes=await f.store.search(inputSchemas.search_library.parse({query:'"comment 1"',targets:['notes']}),null);
    expect(notes.items[0]?.evidence).toMatchObject({source_kind:'note',text:'comment 1'});
    const remote=f.store.listBooks(inputSchemas.list_books.parse({})).items.find(b=>b.source_key===keys.b)!;
    expect(f.store.listAnnotations(inputSchemas.list_annotations.parse({book_id:remote.id})).items).toHaveLength(5);
    expect(f.store.status()).toMatchObject({known_books:4,text_indexed:1,annotations_available:2});
  });
  it('uses the same extraction/index pipeline for cloud and local bytes',async()=>{
    const local=await fixture(),cloud=await cloudFixture();cleanups.push(cloud.close);cloud.state.bookBytes=await epub();
    const source=await createCloudSource(cloud.config),store=openIndex(cloud.config,source.source_id);cleanups.push(async()=>store.close());
    await createRefreshCoordinator({source,store,extractor:createDocumentExtractor()}).refresh({content:'all',rebuild:false},signal());
    const input=inputSchemas.search_library.parse({query:'incertezza',targets:['book_text']});const a=await local.store.search(input,null),b=await store.search(input,null);
    expect(b.items.map(h=>h.evidence.text)).toEqual(a.items.map(h=>h.evidence.text));expect(b.items[0]?.evidence.book_id).not.toBe(a.items[0]?.evidence.book_id);
  });
  it('invalidates pagination and removes evidence when a book is deleted',async()=>{
    const f=await fixture(),page=f.store.listBooks(inputSchemas.list_books.parse({limit:1}));expect(page.next_cursor).not.toBeNull();
    const old=(await f.store.search(inputSchemas.search_library.parse({query:'incertezza'}),null)).items[0]!.evidence;
    f.books[0]!.deletedAt=Date.now();await fs.writeFile(path.join(f.library,'library.json'),JSON.stringify(f.books));await f.refresh.metadata(signal());
    expect(f.store.getPassage(old.passage_id)).toBeNull();expect(()=>f.store.listBooks(inputSchemas.list_books.parse({limit:1,cursor:page.next_cursor}))).toThrow(/cursor/i);
    expect((await f.store.search(inputSchemas.search_library.parse({query:'incertezza'}),null)).items).toEqual([]);
  });
  it('rolls back malformed snapshots and reports competing writers without partial commits',async()=>{
    const f=await fixture(),read=await f.source.readSnapshot(f.store.getCheckpoint(),signal()),checkpoint=f.store.getCheckpoint();
    expect(()=>f.store.applySourceRead({...read,annotations:[{id:'invalid'}] as any})).toThrow();expect(f.store.status().known_books).toBe(4);expect(f.store.getCheckpoint()).toEqual(checkpoint);
    const blocker=new DatabaseSync(path.join(f.cache,f.source.source_id,'index.sqlite'));blocker.exec('BEGIN IMMEDIATE');try{expect(()=>f.store.applySourceRead(read)).toThrow(/busy|locked/i);}finally{blocker.exec('ROLLBACK');blocker.close();}
    f.store.applySourceRead(read);expect(f.store.status().known_books).toBe(4);
  });
});
