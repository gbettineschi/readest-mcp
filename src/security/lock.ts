import fs from 'node:fs/promises';
import path from 'node:path';
import {DomainError} from '../domain/result.js';
import {LIMITS} from '../limits.js';
export async function withFileLock<T>(lock:string,run:()=>Promise<T>):Promise<T>{
  await fs.mkdir(path.dirname(lock),{recursive:true,mode:0o700});const deadline=Date.now()+LIMITS.requestMs;
  for(;;){
    let handle;try{handle=await fs.open(lock,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    if(handle){try{await handle.writeFile(String(process.pid));return await run();}finally{await handle.close();await fs.rm(lock,{force:true});}}
    try{const pid=Number(await fs.readFile(lock,'utf8'));if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){await fs.rm(lock,{force:true});continue;}}}}catch{/* Another process may have released its lock. */}
    if(Date.now()>deadline)throw new DomainError('INDEX_BUSY','Another operation is using the private cache or session. Retry shortly.',true);
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
