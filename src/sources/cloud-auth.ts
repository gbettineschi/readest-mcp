import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClient,type Session} from '@supabase/supabase-js';
import * as z from 'zod/v4';
import type {CloudConfig} from '../config.js';
import {DomainError} from '../domain/result.js';
import {LIMITS} from '../limits.js';
const sessionSchema=z.object({user_id:z.string().min(1),access_token:z.string().min(1),refresh_token:z.string().min(1),expires_at:z.number(),api_base:z.string(),auth_url:z.string()});
export type StoredSession=z.infer<typeof sessionSchema>;
export class CredentialStore {
  constructor(public readonly file:string){}
  async load():Promise<StoredSession|null>{
    try{const info=await fs.lstat(this.file);if(!info.isFile()||info.size>64*1024||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw new DomainError('AUTH_REQUIRED','Use a private credential file owned by your account.');return sessionSchema.parse(JSON.parse(await fs.readFile(this.file,'utf8')));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;if(error instanceof DomainError)throw error;throw new DomainError('AUTH_REQUIRED','Saved cloud session is invalid. Sign in again.');}
  }
  async save(value:StoredSession):Promise<void>{
    const session=sessionSchema.parse(value),dir=path.dirname(this.file);await fs.mkdir(dir,{recursive:true,mode:0o700});
    if(process.platform!=='win32'&&((await fs.stat(dir)).mode&0o077)!==0)throw new DomainError('INVALID_CONFIG','Choose a private credentials directory.');
    const tmp=this.file+'.'+randomUUID()+'.part';await fs.writeFile(tmp,JSON.stringify(session),{flag:'wx',mode:0o600});await fs.rename(tmp,this.file);
  }
  async clear():Promise<void>{await fs.rm(this.file,{force:true});}
  async locked<T>(run:()=>Promise<T>):Promise<T>{
    await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const lock=this.file+'.lock';const deadline=Date.now()+LIMITS.requestMs;
    for(;;){
      let handle;try{handle=await fs.open(lock,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      if(handle){try{await handle.writeFile(String(process.pid));return await run();}finally{await handle.close();await fs.rm(lock,{force:true});}}
      try{const pid=Number(await fs.readFile(lock,'utf8'));if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){await fs.rm(lock,{force:true});continue;}}}}catch{/* Owner may have released the lock. */}
      if(Date.now()>deadline)throw new DomainError('AUTH_REQUIRED','Cloud session renewal is busy. Retry shortly.',true);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
}
export function createCloudAuth(config:CloudConfig,store=new CredentialStore(config.credential_file)){
  const client=createClient(config.auth_url,config.anon_key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(LIMITS.requestMs),redirect:'error'})}});
  let pending:Promise<string>|null=null;
  const check=(session:StoredSession|null)=>{if(!session)throw new DomainError('AUTH_REQUIRED','Sign in with readest-mcp login.');if(session.api_base!==config.api_base||session.auth_url!==config.auth_url)throw new DomainError('AUTH_REQUIRED','Session belongs to a different cloud configuration. Sign in again.');return session;};
  const persist=async(session:Session|null)=>{if(!session?.refresh_token||!session.user?.id)throw new DomainError('AUTH_REQUIRED','Cloud sign-in could not be renewed. Sign in again.');const saved={user_id:session.user.id,access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at??0,api_base:config.api_base,auth_url:config.auth_url};await store.save(saved);return saved.access_token;};
  return {
    store,
    async signIn(email:string,password:string):Promise<void>{await store.locked(async()=>{const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw new DomainError('AUTH_REQUIRED','Sign-in failed. Check your Readest account credentials.');await persist(data.session);});},
    async token(rejected?:string):Promise<string>{
      const current=check(await store.load());if(current.expires_at>Date.now()/1000+60&&(!rejected||current.access_token!==rejected))return current.access_token;
      if(pending)return pending;
      pending=store.locked(async()=>{const latest=check(await store.load());if(latest.expires_at>Date.now()/1000+60&&(!rejected||latest.access_token!==rejected))return latest.access_token;const {data,error}=await client.auth.refreshSession({refresh_token:latest.refresh_token});if(error)throw new DomainError('AUTH_REQUIRED','Cloud session expired. Sign in again.');return persist(data.session);});
      try{return await pending;}finally{pending=null;}
    }
  };
}
