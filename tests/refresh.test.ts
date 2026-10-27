import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openIndex} from '../dist/index/store.js';
import {createRefreshCoordinator} from '../dist/index/refresh.js';
import {createLocalSource} from '../dist/sources/local.js';
import {createDocumentExtractor} from '../dist/content/extract.js';
import {inputSchemas} from '../dist/mcp/schemas.js';
import {localLibrary,keys} from './helpers/local-library.js';
import {epub,pdf} from './helpers/books.js';
import {DatabaseSync} from 'node:sqlite';
import type {Book} from '../dist/domain/model.js';
import type {LibrarySource} from '../dist/domain/source.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
const signal=()=>new AbortController().signal;
async function fixture(){const f=await localLibrary();cleanups.push(f.cleanup);await fs.writeFile(path.join(f.library,keys.a,'book.epub'),await epub());const source=createLocalSource(f.config),store=openIndex(f.config,source.source_id);cleanups.push(async()=>store.close());const refresh=createRefreshCoordinator({source,store,extractor:createDocumentExtractor()});return {...f,source,store,refresh};}
it('keeps the last usable snapshot when a later source refresh fails',async()=>{
  const f=await fixture();await f.refresh.refresh({content:'available',rebuild:false},signal());const at=f.store.refreshedAt();await fs.writeFile(path.join(f.library,'library.json'),'{bad');
  const report=await f.refresh.metadata(signal());expect(report.warnings.some(w=>w.code==='REFRESH_FAILED')).toBe(true);expect(f.store.refreshedAt()).toBe(at);expect(f.store.status().known_books).toBe(4);
});
it('fails a first refresh instead of creating an empty successful library',async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.library,'library.json'),'{bad');await expect(f.refresh.metadata(signal())).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});expect(f.store.hasSnapshot()).toBe(false);
});
it('invalidates changed file evidence and rebuilds a new revision',async()=>{
  const f=await fixture();await f.refresh.refresh({content:'available',rebuild:false},signal());const old=(await f.store.search(inputSchemas.search_library.parse({query:'incertezza'}),null)).items[0]!.evidence;
  await fs.writeFile(path.join(f.library,keys.a,'book.epub'),await epub(3,'An entirely changed edition.'));await f.refresh.metadata(signal());expect(f.store.getPassage(old.passage_id)).toBeNull();
  await f.refresh.refresh({content:'available',rebuild:false},signal());const hits=await f.store.search(inputSchemas.search_library.parse({query:'changed'}),null);expect(hits.items[0]?.evidence.revision).not.toBe(old.revision);
});
it('retains explicitly cached notes when config is missing and removes a real tombstone',async()=>{
  const f=await fixture();await f.refresh.metadata(signal());const book=f.store.listBooks(inputSchemas.list_books.parse({})).items.find(b=>b.source_key===keys.b)!;
  const cfg=path.join(f.library,keys.b,'config.json'),raw=JSON.parse(await fs.readFile(cfg,'utf8'));await fs.rm(cfg);await f.refresh.metadata(signal());expect(f.store.listAnnotations(inputSchemas.list_annotations.parse({book_id:book.id})).items).toHaveLength(5);expect(f.store.warnings().some(w=>w.code==='USING_CACHE')).toBe(true);
  raw.booknotes[1].deletedAt=Date.now();await fs.writeFile(cfg,JSON.stringify(raw));await f.refresh.metadata(signal());expect(f.store.listAnnotations(inputSchemas.list_annotations.parse({book_id:book.id})).items).toHaveLength(4);
});
it('indexes available content after the first catalogue page',async()=>{
  const f=await fixture(),read=await f.source.readSnapshot(null,signal()),original=read.books[0]!;
  const books:Book[]=Array.from({length:53},(_,i)=>({...original,id:'page-'+String(i).padStart(3,'0'),source_key:String(i),availability:{...original.availability,file:i===52?'available':'unavailable'}}));
  const source:LibrarySource={...f.source,readSnapshot:async()=>({...read,books,annotations:[],file_versions:{},coverage:{...read.coverage,known_books:53,covered_books:53}}),resolveBookFile:async(book,options)=>book.id==='page-052'?f.source.resolveBookFile(original,options):{status:'unavailable',code:'CONTENT_UNAVAILABLE',message:'Not on this device.'}};
  await createRefreshCoordinator({source,store:f.store,extractor:createDocumentExtractor()}).refresh({content:'available',rebuild:false},signal());
  expect(f.store.status()).toMatchObject({known_books:53,text_indexed:1});expect((await f.store.search(inputSchemas.search_library.parse({query:'incertezza'}),null)).items[0]?.evidence.book_id).toBe('page-052');
});
it('propagates cancellation to the source and does not commit its cancelled snapshot',async()=>{
  const f=await fixture(),read=await f.source.readSnapshot(null,signal()),controller=new AbortController();
  const source:LibrarySource={...f.source,readSnapshot:async(_previous,requestSignal)=>{controller.abort();requestSignal.throwIfAborted();return read;}};
  await expect(createRefreshCoordinator({source,store:f.store,extractor:createDocumentExtractor()}).metadata(controller.signal)).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});expect(f.store.hasSnapshot()).toBe(false);
});
it('reports failed content without blocking a healthy book',async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.library,keys.a,'book.epub'),'broken epub');await fs.writeFile(path.join(f.library,keys.b,'book.pdf'),await pdf(['A healthy text-bearing PDF.']));
  await f.refresh.refresh({content:'available',rebuild:false},signal());expect(f.store.status()).toMatchObject({known_books:4,text_indexed:1,extraction_failed:1,unavailable_files:2,unindexed_books:3});
  expect((await f.store.search(inputSchemas.search_library.parse({query:'healthy'}),null)).items[0]?.evidence.text).toBe('A healthy text-bearing PDF.');
});
it('rebuilds derived search rows even when source records and file bytes did not change',async()=>{
  const f=await fixture();await f.refresh.refresh({content:'available',rebuild:false},signal());const db=new DatabaseSync(path.join(f.cache,f.source.source_id,'index.sqlite'));db.exec('DELETE FROM search_fts');db.close();
  await f.refresh.refresh({content:'available',rebuild:true},signal());expect((await f.store.search(inputSchemas.search_library.parse({query:'incertezza'}),null)).items).toHaveLength(1);expect((await f.store.search(inputSchemas.search_library.parse({query:'"comment 1"',targets:['notes']}),null)).items).toHaveLength(1);
});
