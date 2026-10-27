import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {localLibrary,keys} from './helpers/local-library.js';
import {cloudFixture} from './helpers/cloud-http.js';
import {epub} from './helpers/books.js';
import {stdioClient} from './helpers/stdio-client.js';
import {outputSchemas,type ToolName} from '../dist/mcp/schemas.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
it('runs all six real tools over stdio with identical local/cloud definitions and typed results',async()=>{
 const local=await localLibrary(),cloud=await cloudFixture();cleanups.push(local.cleanup,cloud.close);const bytes=await epub(3,'An uncertain outcome');await fs.writeFile(path.join(local.library,keys.a,'book.epub'),bytes);cloud.state.bookBytes=bytes;
 const connections=[];
 for(const f of [local,cloud]){const file=path.join(f.root,'config.json');await fs.writeFile(file,JSON.stringify(f.config));const c=await stdioClient(file);connections.push(c);cleanups.push(c.close);}
 expect((await connections[0]!.client.listTools()).tools).toEqual((await connections[1]!.client.listTools()).tools);
 for(const [i,c]of connections.entries()){
  const call=async(name:ToolName,args={})=>{const result=await c.client.callTool({name,arguments:args});const parsed=outputSchemas[name].parse(result.structuredContent);expect(JSON.parse((result.content[0] as {text:string}).text)).toEqual(parsed);expect(Buffer.byteLength(JSON.stringify(parsed))).toBeLessThanOrEqual(65536);return parsed as any;};
  expect((await call('library_status')).data.known_books).toBe(i?1:4);
  const list=await call('list_books');expect(list.status).toBe('ok');expect(cloud.state.downloads).toBe(0);const book=list.data.items.find((b:any)=>b.source_key===keys.a);
  const detail=await call('get_book',{book_id:book.id,include_structure:true});expect(detail.data.structure.items.length).toBeGreaterThan(0);
  const found=await call('search_library',{query:'uncertain',targets:['book_text']});expect(found.data.items[0].evidence.text).toContain('uncertain');
  const content=await call('read_content',{selector:{kind:'passage',id:found.data.items[0].evidence.passage_id}});expect(content.data.items[0].text).toBe('An uncertain outcome');
  await call('list_annotations',{book_id:book.id});
  const unavailable=await call('search_library',{query:'meaning',mode:'semantic'});expect(unavailable.error.code).toBe('CAPABILITY_UNAVAILABLE');
  const hybrid=await call('search_library',{query:'uncertain',mode:'hybrid'});expect(hybrid.status).toBe('partial');expect(hybrid.data.used_mode).toBe('keyword');
  const unknown=await call('get_book',{book_id:'unknown'});expect(unknown.error.code).toBe('BOOK_NOT_FOUND');
  const invalid=await c.client.callTool({name:'list_books',arguments:{limit:999}});expect(invalid.isError).toBe(true);
  expect(c.stderr()).not.toMatch(/fixture-refresh|signature=|password|Bearer /i);
  if(i){const notes=await call('list_annotations',{book_id:book.id});const context=await call('read_content',{selector:{kind:'annotation',id:notes.data.items[0].id},context_chars:400});expect(context.data.match).toBe('exact');expect(context.data.annotation.note).toBe('my comment');expect(cloud.state.downloads).toBe(1);}
 }
},30_000);
