import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {keys} from './local-library.js';
export const userId='00000000-0000-4000-8000-000000000001';
export const jwt=(label='initial')=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',label})).toString('base64url')+'.fixture';
export async function cloudFixture(){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'readest-cloud-')));
  const state={requests:[] as {method:string;url:string;authorization:string|undefined}[],timeout:false,notesError:false,malformed:false,authOnce:false,deny:false,renewals:0,downloads:0,signedExpired:false,largePage:false,deleted:false,oversized:false,interrupted:false,bookBytes:Buffer.from('fixture book bytes') as Buffer};
  let origin='';
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url!,origin);state.requests.push({method:req.method!,url:req.url!,authorization:req.headers.authorization});
    res.setHeader('content-type','application/json');
    const send=(data:unknown,status=200)=>{res.statusCode=status;res.end(JSON.stringify(data));};
    if(url.pathname==='/auth/v1/token'){
      let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
      if(url.searchParams.get('grant_type')==='refresh_token')state.renewals++;
      if(input.password&&input.password!=='fixture-password')return send({msg:'Invalid credentials'},400);
      return send({access_token:jwt('renewed'),refresh_token:'fixture-refresh-rotated',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}});
    }
    if(url.pathname==='/api/sync'){
      if(state.timeout)return;
      if(state.deny)return send({error:'Access denied'},403);
      if(state.authOnce){state.authOnce=false;return send({error:'Not authenticated'},403);}
      if(state.oversized)res.setHeader('content-length',String(40*1024*1024));
      const type=url.searchParams.get('type');if(state.notesError&&type==='notes')return send({error:'unavailable'},500);
      if(state.malformed)return send({unexpected:true});
      const book={user_id:userId,book_hash:keys.a,title:'Cloud decisions',author:'A',format:'EPUB',tags:['research'],group_id:null,group_name:null,reading_status:'reading',progress:[1,5],created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',synced_at:'2026-01-03T00:00:00Z',deleted_at:state.deleted?'2026-01-04T00:00:00Z':null};
      const books=state.largePage&&Number(url.searchParams.get('since'))===0?Array.from({length:1001},(_,i)=>({...book,book_hash:i.toString(16).padStart(32,'0')})):[book];
      const since=Number(url.searchParams.get('since'));const current=Date.parse(book.synced_at);
      return send({books:type==='books'?(since>=current?[]:books):[],configs:type==='configs'?[{user_id:userId,book_hash:keys.a,progress:'[2,5]',location:'epubcfi(/6/2)',updated_at:'2026-01-02T00:00:00Z'}]:[],notes:type==='notes'?[{user_id:userId,book_hash:keys.a,id:'note-1',type:'annotation',cfi:'epubcfi(/6/2)',page:null,text:'An uncertain outcome',note:'my comment',style:'highlight',color:'yellow',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',deleted_at:state.deleted?'2026-01-04T00:00:00Z':null}]:[],statBooks:[],statPages:[]});
    }
    if(url.pathname==='/api/storage/download'){state.downloads++;return send({downloadUrl:origin+'/file.epub?signature=fixture'});}
    if(url.pathname==='/file.epub'){
      if(state.signedExpired){state.signedExpired=false;res.statusCode=403;return res.end('expired');}
      if(state.interrupted){res.setHeader('content-length','10000');res.write('partial');return res.destroy();}
      res.setHeader('content-type','application/epub+zip');return res.end(state.bookBytes);
    }
    send({error:'Unexpected endpoint'},404);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const config={source:'cloud' as const,api_base:origin+'/api',auth_url:origin,anon_key:'public-fixture-key',credential_file:path.join(root,'private','credentials.json'),cache_dir:path.join(root,'cache'),embeddings:{enabled:false,model_dir:path.join(root,'models')}};
  await fs.mkdir(path.dirname(config.credential_file),{mode:0o700});
  const session={user_id:userId,access_token:jwt(),refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,api_base:config.api_base,auth_url:config.auth_url};await fs.writeFile(config.credential_file,JSON.stringify(session),{mode:0o600});
  return {root,config,state,session,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));await fs.rm(root,{recursive:true,force:true});}};
}
