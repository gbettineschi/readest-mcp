import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {localLibrary,keys} from './helpers/local-library.js';
import {epub} from './helpers/books.js';
import {stdioClient} from './helpers/stdio-client.js';
const exec=promisify(execFile);
const npmCli=process.env.npm_execpath;
it('packs only distributable files and runs a production-only isolated install through an exact-reference round trip',async()=>{
 const f=await localLibrary();try{
  if(!npmCli)throw new Error('Run the clean-install check through npm test.');
  const packed=JSON.parse((await exec(process.execPath,[npmCli,'pack','--json','--pack-destination',f.root])).stdout)[0];const files=packed.files.map((f:{path:string})=>f.path);
  for(const required of ['README.md','LICENSE','THIRD_PARTY_NOTICES.md','dist/cli.js'])expect(files).toContain(required);
  expect(files.some((f:string)=>/credentials|library\.json|index\.sqlite|model_quantized|node_modules|\.superpowers|^tests\//.test(f))).toBe(false);
  const install=path.join(f.root,'install');await fs.mkdir(install);await fs.writeFile(path.join(install,'package.json'),' {"private":true}');
  await exec(process.execPath,[npmCli,'install','--ignore-scripts','--omit=dev','--omit=optional','--no-audit','--no-fund',path.join(f.root,packed.filename)],{cwd:install,timeout:120000});
  const entry=path.join(install,'node_modules','readest-mcp','dist','cli.js');if(process.platform!=='win32')expect((await fs.stat(entry)).mode&0o111).not.toBe(0);
  for(const name of files){if(!/\.(js|json|md)$/.test(name))continue;const content=await fs.readFile(path.join(install,'node_modules','readest-mcp',name),'utf8');expect(content).not.toMatch(/\/Users\/[^/]+\//);}
  await fs.writeFile(path.join(f.library,keys.a,'book.epub'),await epub());const config=path.join(f.root,'config.json');await fs.writeFile(config,JSON.stringify(f.config));const c=await stdioClient(config,entry);
  try{expect((await c.client.listTools()).tools).toHaveLength(6);const call=async(name:string,args={})=>(await c.client.callTool({name,arguments:args})).structuredContent as any;
   const list=await call('list_books'),book=list.data.items.find((b:any)=>b.source_key===keys.a);const detail=await call('get_book',{book_id:book.id,include_structure:true});expect(detail.error).toBeNull();
   const hit=(await call('search_library',{query:'incertezza',targets:['book_text']})).data.items[0].evidence;
   const result=await call('read_content',{selector:{kind:'passage',id:hit.passage_id}});expect(result.data.items[0].text).toBe('L’incertezza non impedisce una scelta ragionevole.');expect(result.data.items[0].revision).toBe(hit.revision);
   const doctor=await exec(process.execPath,[entry,'doctor','--config',config]);expect(JSON.parse(doctor.stdout).data.text_indexed).toBe(1);
  }finally{await c.close();}
 }finally{await f.cleanup();}
},180000);
