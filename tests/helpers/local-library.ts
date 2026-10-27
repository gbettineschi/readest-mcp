import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export const keys={a:'a'.repeat(32),b:'b'.repeat(32),c:'c'.repeat(32),d:'d'.repeat(32)};
export async function localLibrary(){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'readest-fixture-')));const library=path.join(root,'Books'),cache=path.join(root,'cache');await fs.mkdir(library);
  const books:Record<string,unknown>[]=[{hash:keys.a,title:'Decisioni e incertezza',author:'Autore A',format:'EPUB',readingStatus:'reading',progress:[2,10],tags:['ricerca']},{hash:keys.b,title:'Remote',author:'B',format:'PDF'},{hash:keys.c,title:'No config',author:'C',format:'EPUB'},{hash:keys.d,title:'Unsupported',author:'D',format:'MOBI'}];
  await fs.writeFile(path.join(library,'library.json'),JSON.stringify(books));
  for(const key of Object.values(keys))await fs.mkdir(path.join(library,key));
  await fs.writeFile(path.join(library,keys.a,'book.epub'),'synthetic fixture bytes');
  await fs.writeFile(path.join(library,keys.a,'config.json'),JSON.stringify({schemaVersion:3,progress:[3,10],location:'epubcfi(/6/2)',booknotes:[]}));
  await fs.writeFile(path.join(library,keys.b,'config.json'),JSON.stringify({schemaVersion:3,booknotes:['bookmark','annotation','excerpt','notebook','ink'].map((type,i)=>({id:'note-'+i,type,cfi:'epubcfi(/6/'+i+')',text:'quote '+i,note:'comment '+i,color:'yellow',style:'highlight',ink:type==='ink'?[{points:[{x:1,y:2}]}]:undefined,createdAt:1000+i}))}));
  return {root,library,cache,books,config:{source:'local' as const,library_dir:library,cache_dir:cache,content_roots:[],embeddings:{enabled:false,model_dir:path.join(cache,'models')}},cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
