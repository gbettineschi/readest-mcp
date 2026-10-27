import {expect,it} from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {stdioClient} from './helpers/stdio-client.js';
it.skipIf(process.env.READEST_TEST_LIVE!=='1')('connects to the privately configured source and retrieves available evidence without printing personal data',async()=>{
 const config=process.env.READEST_CONFIG??path.join(os.homedir(),'.config','readest-mcp','config.json'),c=await stdioClient(config);
 try{const call=async(name:string,args={})=>(await c.client.callTool({name,arguments:args})).structuredContent as any;const status=await call('library_status');expect(status.status,'Source must authenticate/reach its catalogue').not.toBe('error');
  const list=await call('list_books');expect(list.status).not.toBe('error');let epub=false,pdf=false,annotations=false,roundtrip=false;
  for(const book of list.data.items){const notes=await call('list_annotations',{book_id:book.id});if(notes.data?.items.length)annotations=true;if(!['EPUB','PDF'].includes(book.format))continue;
   const detail=await call('get_book',{book_id:book.id,include_structure:true});if(!detail.data?.structure?.items.length)continue;
   const content=await call('read_content',{selector:{kind:'structure',id:detail.data.structure.items[0].id}});const evidence=content.data?.items.find((p:any)=>p.text.length);if(!evidence)continue;
   const exact=await call('read_content',{selector:{kind:'passage',id:evidence.passage_id}});expect(exact.error).toBeNull();expect(exact.data.items[0].revision===evidence.revision).toBe(true);roundtrip=true;if(book.format==='EPUB')epub=true;else pdf=true;
   if(epub&&pdf&&annotations)break;
  }
  console.log(JSON.stringify({source:status.meta.source,known_books:status.data.known_books,epub,pdf,annotations,roundtrip}));
 }finally{await c.close();}
},180000);
