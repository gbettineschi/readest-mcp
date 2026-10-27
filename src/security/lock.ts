import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {DomainError} from '../domain/result.js';
import {LIMITS} from '../limits.js';
export async function withFileLock<T>(lock:string,run:()=>Promise<T>,busyFailure=new DomainError('INDEX_BUSY','Another operation is using the private cache or session. Retry shortly.',true)):Promise<T>{
  await fs.mkdir(path.dirname(lock),{recursive:true,mode:0o700});const deadline=Date.now()+LIMITS.requestMs;
  // SQLite owns the cross-process exclusion and releases it on process death.
  // Never unlink this guard: replacing its inode would split the lock domain.
  const guard=new DatabaseSync(lock+'.sqlite',{timeout:0});
  try{
    await fs.chmod(lock+'.sqlite',0o600);
    for(;;){
      try{guard.exec('BEGIN EXCLUSIVE');break;}catch(error){if(!/\b(?:busy|locked)\b/i.test(String((error as Error).message)))throw error;}
      if(Date.now()>deadline)throw busyFailure;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    try{return await withOwnerFile(lock,run,busyFailure,deadline);}finally{guard.exec('ROLLBACK');}
  }finally{guard.close();}
}
// Retain the PID file protocol for cooperative clients from the prior release.
// The guard serializes new clients before inspecting/removing an abandoned PID,
// preventing competing recoverers from removing a newly acquired owner's lock.
async function withOwnerFile<T>(lock:string,run:()=>Promise<T>,busyFailure:DomainError,deadline:number):Promise<T>{
  // Publish a fully initialized owner atomically. An interrupted creator can leave
  // a private staging file, but never an empty lock that has no recoverable PID.
  const owner=lock+'.'+randomUUID()+'.owner';let created=false;
  try{
    const handle=await fs.open(owner,'wx',0o600);created=true;
    try{await handle.writeFile(String(process.pid));}finally{await handle.close();}
    for(;;){
    let acquired=false;try{await fs.link(owner,lock);acquired=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    if(acquired){try{return await run();}finally{await fs.rm(lock,{force:true});}}
    try{const pid=Number(await fs.readFile(lock,'utf8'));if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){await fs.rm(lock,{force:true});continue;}}}}catch{/* Another process may have released its lock. */}
    if(Date.now()>deadline)throw busyFailure;
    await new Promise(resolve=>setTimeout(resolve,25));
  }}finally{if(created)await fs.rm(owner,{force:true});}
}
