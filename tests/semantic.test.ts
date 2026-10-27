import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openIndex} from '../dist/index/store.js';
import {inputSchemas} from '../dist/mcp/schemas.js';
import {blankLocation} from '../dist/domain/model.js';
import {chunkText,createLocalEmbedder,fetchModel} from '../dist/index/embeddings.js';
import {createRefreshCoordinator} from '../dist/index/refresh.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanups.splice(0).reverse())await f();});
const manifest={id:'test',revision:'one',dtype:'f32',dimensions:2,chunk_version:1};
async function fixture(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'readest-vectors-'));cleanups.push(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=openIndex({cache_dir:dir},'one');cleanups.push(async()=>store.close());
 const book={id:'b',source_key:'b',title:'Test',author:'Author',format:'EPUB',tags:['science'],group:null,reading:{status:null,current:null,total:null,location:null},created_at:null,updated_at:null,revision:null,availability:{file:'available',annotations:'available',index:'pending'}} as const;
 const read={source_id:'one',kind:'full',books:[book],annotations:[],deleted_book_ids:[],deleted_annotation_ids:[],checkpoint:{version:1},refreshed_at:new Date().toISOString(),coverage:{scope:'configured_source',completeness:'complete',known_books:1,covered_books:1},warnings:[]} as any;
 store.applySourceRead(read);
 const passages=['apple apple apple','A distant conceptual answer','Unrelated subject'].map((text,i)=>({passage_id:'p'+i,book_id:'b',revision:'r',title:'Test',author:'Author',text,source_kind:'book_text' as const,location:{...blankLocation('epub'),start:0,end:text.length},structure_id:'s',order:i}));
 store.replaceContent('b',{revision:'r',structure:[],passages,warnings:[],pages:[]});
 const vectors=[[0,1],[1,0],[0.6,0.8]];store.replaceEmbeddings('b',manifest,passages.map((p,i)=>({passage_id:p.passage_id,start:0,end:p.text.length,vector:Float32Array.from(vectors[i]!)})));
 return {store,dir,read,passages};
}
const query=(mode:string,extra={})=>inputSchemas.search_library.parse({query:'apple',mode,...extra});
it('ranks cosine vectors independently of lexical matches, with target/filter isolation',async()=>{
 const {store}=await fixture(),q={vector:Float32Array.of(1,0),manifest};
 expect((await store.search(query('semantic'),q)).items.map(h=>h.evidence.passage_id)).toEqual(['p1','p2','p0']);
 expect((await store.search(query('semantic',{targets:['notes']}),q)).items).toEqual([]);
 expect((await store.search(query('semantic',{filters:{tags:['other']}}),q)).items).toEqual([]);
 expect((await store.search(query('hybrid'),q)).items[0]?.evidence.passage_id).toBe('p0');
 expect((await store.search(query('hybrid'),q)).items[0]?.score).toBeCloseTo(1/61+1/63);
});
it('isolates manifests, sources, deleted books and changed evidence',async()=>{
 const f=await fixture(),q={vector:Float32Array.of(1,0),manifest};
 expect((await f.store.search(query('semantic'),{...q,manifest:{...manifest,revision:'two'}})).items).toEqual([]);
 const other=openIndex({cache_dir:f.dir},'two');try{expect((await other.search(query('semantic'),q)).items).toEqual([]);}finally{other.close();}
 f.store.replaceContent('b',{revision:'new',structure:[],passages:[],warnings:[],pages:[]});expect((await f.store.search(query('semantic'),q)).items).toEqual([]);
 expect(()=>f.store.replaceEmbeddings('b',manifest,[{passage_id:'p1',start:0,end:1,vector:q.vector}])).toThrow();
 f.store.applySourceRead({...f.read,books:[]});expect((await f.store.search(query('semantic'),q)).items).toEqual([]);
});
it('keeps vectors on unchanged metadata and rejects non-finite/wrong-sized vectors atomically',async()=>{
 const f=await fixture(),q={vector:Float32Array.of(1,0),manifest};f.store.applySourceRead(f.read);
 expect((await f.store.search(query('semantic'),q)).items).toHaveLength(3);
 expect(()=>f.store.replaceEmbeddings('b',manifest,[{passage_id:'p1',start:0,end:1,vector:Float32Array.of(NaN,0)}])).toThrow();
 expect((await f.store.search(query('semantic'),q)).items).toHaveLength(3);
 await expect(f.store.search(query('semantic'),null)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 expect((await f.store.search(query('hybrid'),null)).used_mode).toBe('keyword');
});
it('retains annotation vectors across an unchanged metadata refresh',async()=>{
 const f=await fixture();const read={...f.read,annotations:[{id:'a',book_id:'b',kind:'annotation',quote:'A quote',note:'My thought',color:null,style:null,locator:{cfi:null,page:null,xpointer0:null,xpointer1:null},created_at:null,updated_at:null,ink:null,ink_available:false}]};
 f.store.applySourceRead(read);f.store.replaceEmbeddings('b',manifest,f.store.evidenceForBook('b').map(p=>({passage_id:p.passage_id,start:0,end:p.text.length,vector:Float32Array.of(1,0)})));
 f.store.applySourceRead(read);expect((await f.store.search(query('semantic',{targets:['notes']}),{vector:Float32Array.of(1,0),manifest})).items).toHaveLength(1);
});
it('chunks multilingual text within token budget, retaining every character and exact ranges',async()=>{
 const text=('Italiano: perché? 日本語と中文 😀 '.repeat(250));
 const count=async(s:string)=>Array.from(s).length+2;
 const chunks=await chunkText(text,count);
 expect(chunks.length).toBeGreaterThan(1);expect(chunks.map(c=>text.slice(c.start,c.end)).join('')).toBe(text);
 for(const c of chunks){expect(await count(text.slice(c.start,c.end))).toBeLessThanOrEqual(128);expect(text.slice(c.start,c.end)).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);}
});
it('requires explicit valid model installation and never marks an interrupted download ready',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'readest-model-'));cleanups.push(()=>fs.rm(dir,{recursive:true,force:true}));const config={enabled:true,model_dir:dir};
 await expect(createLocalEmbedder(config)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 const abort=new AbortController();abort.abort();await expect(fetchModel(config,{signal:abort.signal})).rejects.toThrow();
 await expect(createLocalEmbedder(config)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
});
it('indexes vectors only during explicit refresh and includes annotation-only evidence',async()=>{
 const f=await fixture();const source={mode:'local' as const,source_id:'one',async readSnapshot(){return f.read;},async resolveBookFile(){return {status:'unavailable' as const,code:'CONTENT_UNAVAILABLE',message:'Not downloaded'};}};
 let calls=0;const embedder={manifest,countTokens:async(s:string)=>s.length,async embed(texts:string[]){calls+=texts.length;return texts.map(()=>Float32Array.of(1,0));}};
 f.store.replaceEmbeddings('b',manifest,[]);
 const refresh=createRefreshCoordinator({source,store:f.store,extractor:{async extract(){throw new Error('unused');}},embedder});
 await refresh.metadata(new AbortController().signal);expect(calls).toBe(0);
 await refresh.refresh({content:'available',rebuild:false},new AbortController().signal);expect(calls).toBe(3);
 expect((await f.store.search(query('semantic'),{manifest,vector:Float32Array.of(1,0)})).items).toHaveLength(3);
});
