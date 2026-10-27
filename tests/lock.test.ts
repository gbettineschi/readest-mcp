import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {withFileLock} from '../dist/security/lock.js';
import {CredentialStore} from '../dist/sources/cloud-auth.js';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const directories:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const d of directories.splice(0))await fs.rm(d,{recursive:true,force:true});});
it.each(['cache','credentials'] as const)('publishes an initialized owner atomically for the %s lock',async kind=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'readest-lock-'));directories.push(dir);const file=path.join(dir,'credentials.json'),lock=kind==='cache'?path.join(dir,'refresh.lock'):file+'.lock',opened=gate(),entered=gate(),write=gate(),finish=gate(),open=fs.open.bind(fs);
 // Pause the real filesystem boundary between creating the lock path and initializing its owner.
 vi.spyOn(fs,'open').mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const handle=await open(...args);if(String(args[0])===lock&&args[1]==='wx'){const original=handle.writeFile.bind(handle);handle.writeFile=async(...data:Parameters<typeof handle.writeFile>)=>{await write.promise;return original(...data);};opened.resolve();}return handle;});
 const critical=async()=>{entered.resolve();await finish.promise;},task=kind==='cache'?withFileLock(lock,critical):new CredentialStore(file).locked(critical);
 try{await Promise.race([opened.promise,entered.promise,task]);expect(await fs.readFile(lock,'utf8')).toBe(String(process.pid));}
 finally{write.resolve();finish.resolve();await task;}
 expect(await fs.stat(lock).then(()=>true).catch(()=>false)).toBe(false);
});
it('serializes simultaneous contenders and releases the lock after a failed operation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'readest-lock-'));directories.push(dir);const lock=path.join(dir,'refresh.lock');let active=0,peak=0;
 await Promise.all(Array.from({length:8},()=>withFileLock(lock,async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;})));expect(peak).toBe(1);
 await expect(withFileLock(lock,async()=>{throw new Error('failed');})).rejects.toThrow('failed');expect(await withFileLock(lock,async()=>42)).toBe(42);
});
it('cleans its staged owner if initialization fails after creating the file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'readest-lock-'));directories.push(dir);const lock=path.join(dir,'refresh.lock'),write=fs.writeFile.bind(fs),open=fs.open.bind(fs),failure=Object.assign(new Error('disk full'),{code:'ENOSPC'});
 vi.spyOn(fs,'writeFile').mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{if(String(args[0]).endsWith('.owner')){await write(args[0],'',args[2]);throw failure;}return write(...args);});
 vi.spyOn(fs,'open').mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const handle=await open(...args);if(String(args[0]).endsWith('.owner'))handle.writeFile=async()=>{throw failure;};return handle;});
 await expect(withFileLock(lock,async()=>42)).rejects.toMatchObject({code:'ENOSPC'});expect(await fs.readdir(dir)).toEqual(['refresh.lock.sqlite']);if(process.platform!=='win32')expect((await fs.stat(lock+'.sqlite')).mode&0o777).toBe(0o600);
});
