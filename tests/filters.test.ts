import {afterEach,expect,it} from 'vitest';
import {localLibrary} from './helpers/local-library.js';
import {openIndex} from '../dist/index/store.js';
import {inputSchemas} from '../dist/mcp/schemas.js';
import type {Annotation,Book} from '../dist/domain/model.js';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function fixture(){
 const f=await localLibrary();cleanup.push(f.cleanup);const store=openIndex(f.config,'filter-fixture');cleanup.push(async()=>store.close());
 const books:Book[]=[
  {id:'a',source_key:'a',title:'Astral Choices',author:'Ada Lovelace',format:'EPUB',tags:['research','space'],reading:{status:'reading',current:1,total:10,location:null}},
  {id:'b',source_key:'b',title:'Practical Choices',author:'Ada Lovelace',format:'PDF',tags:['research'],reading:{status:'finished',current:10,total:10,location:null}},
  {id:'c',source_key:'c',title:'Deep Research',author:'Grace Hopper',format:'EPUB',tags:['research','space'],reading:{status:'unread',current:0,total:10,location:null}},
  {id:'d',source_key:'d',title:'Other Matters',author:'Ada Lovelace',format:'EPUB',tags:['other'],reading:{status:'abandoned',current:2,total:10,location:null}}
 ].map(b=>({...b,group:null,created_at:null,updated_at:null,revision:null,availability:{annotations:'available',file:'unavailable',index:'pending'}})) as Book[];
 const annotations:Annotation[]=[
  {id:'n1',kind:'annotation',color:'yellow',created_at:'2026-10-27T10:00:00.000Z'},
  {id:'n2',kind:'bookmark',color:null,created_at:'2026-10-27T11:00:00.000Z'},
  {id:'n3',kind:'excerpt',color:'blue',created_at:'2026-10-27T12:00:00.000Z'},
  {id:'n4',kind:'notebook',color:'yellow',created_at:null},
  {id:'n5',kind:'ink',color:'yellow',created_at:'2026-10-27T13:00:00.000Z'}
 ].map(n=>({...n,book_id:'a',quote:'Shared quartz quotation',note:'Personal quartz comment',style:null,updated_at:null,locator:{cfi:null,page:null,xpointer0:null,xpointer1:null},ink:null,ink_available:false})) as Annotation[];
 for(const b of books.slice(1))annotations.push({...annotations[0]!,id:'note-'+b.id,book_id:b.id});
 store.applySourceRead({source_id:'filter-fixture',kind:'full',books,annotations,deleted_book_ids:[],deleted_annotation_ids:[],checkpoint:{version:1},refreshed_at:'2026-10-27T14:00:00.000Z',warnings:[],coverage:{scope:'configured_source',completeness:'complete',known_books:4,covered_books:4}});
 return store;
}

it.each([
 [{query:'CHOICES'},['a','b']], [{author:'LOVELACE'},['a','b','d']], [{tags:['research','space']},['a','c']],
 [{formats:['PDF']},['b']], [{reading_status:'reading'},['a']], [{reading_status:'finished'},['b']],
 [{reading_status:'unread'},['c']], [{reading_status:'abandoned'},['d']], [{book_ids:['c','a']},['a','c']],
 [{author:'ada',tags:['research'],formats:['EPUB'],reading_status:'reading',query:'astral',book_ids:['a','b']},['a']],
 [{author:'Grace',formats:['PDF']},[]]
] as const)('applies metadata filters consistently to catalogue and annotation search: %j',async(filters,want)=>{
 const store=await fixture();expect(store.listBooks(inputSchemas.list_books.parse({filters})).items.map(b=>b.id)).toEqual(want);
 const hits=await store.search(inputSchemas.search_library.parse({query:'quartz',targets:['notes'],filters}),null);expect([...new Set(hits.items.map(h=>h.evidence.book_id))].sort()).toEqual(want);
});

it.each([
 [{types:['bookmark']},['n2']], [{types:['annotation','excerpt']},['n1','n3']],
 [{colors:['yellow']},['n1','n4','n5']], [{colors:['blue']},['n3']],
 [{created_after:'2026-10-27T11:30:00Z'},['n3','n5']],
 [{created_before:'2026-10-27T10:30:00Z'},['n1']],
 [{created_after:'2026-10-27T13:30:00+02:00'},['n3','n5']],
 [{created_before:'2026-10-27T06:30:00-04:00'},['n1']],
 [{created_after:'2026-10-27T10:00:00Z',created_before:'2026-10-27T10:00:00.000Z'},['n1']],
 [{types:['annotation','ink'],colors:['yellow'],created_after:'2026-10-27T11:00:00Z'},['n5']],
 [{colors:['absent']},[]]
] as const)('filters annotations by their actual type, color and creation instant: %j',async(filters,want)=>{
 const store=await fixture();expect(store.listAnnotations(inputSchemas.list_annotations.parse({book_id:'a',...filters})).items.map(n=>n.id)).toEqual(want);
});

it('binds filtered annotation pagination to its book and filters',async()=>{
 const store=await fixture(),input=inputSchemas.list_annotations.parse({book_id:'a',colors:['yellow'],limit:1});
 const a=store.listAnnotations(input),b=store.listAnnotations({...input,cursor:a.next_cursor}),c=store.listAnnotations({...input,cursor:b.next_cursor});
 expect([a.items[0]!.id,b.items[0]!.id,c.items[0]!.id]).toEqual(['n1','n4','n5']);expect(c.next_cursor).toBeNull();
 expect(()=>store.listAnnotations({...input,colors:['blue'],cursor:a.next_cursor})).toThrow(/cursor/i);
 expect(()=>store.listAnnotations({...input,book_id:'b',cursor:a.next_cursor})).toThrow(/cursor/i);
});
