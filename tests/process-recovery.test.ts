import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const roots:string[]=[],children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0)){if(child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(r=>child.once('exit',()=>r()));child.kill('SIGKILL');await ended;}}for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const moduleUrl=pathToFileURL(fileURLToPath(new URL('../dist/security/lock.js',import.meta.url))).href;
function worker(lock:string,mode:'hold'|'journal',journal='',protocol='guarded'){
 const script=`import fs from 'node:fs/promises';const {withFileLock}=await import(process.argv[1]);
 const run=async()=>{if(process.argv[4])await fs.appendFile(process.argv[4],'start '+process.pid+'\\n');if(process.argv[3]==='hold'){console.log('entered');process.stdin.resume();await new Promise(r=>process.stdin.once('end',r));}else await new Promise(r=>setTimeout(r,10));if(process.argv[4])await fs.appendFile(process.argv[4],'end '+process.pid+'\\n');if(process.argv[3]!=='hold')console.log('entered');};
 const operation=process.argv[5]==='legacy'?(async()=>{await fs.writeFile(process.argv[2],String(process.pid),{flag:'wx'});try{await run();}finally{await fs.rm(process.argv[2]);}})():withFileLock(process.argv[2],run);console.log('started');await operation;`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,moduleUrl,lock,mode,journal,protocol],{stdio:['pipe','pipe','pipe']});children.push(child);let output='',errors='';child.stderr!.on('data',d=>errors+=d);child.stdout!.on('data',d=>output+=d);
 const exited=new Promise<number|null>(resolve=>child.once('exit',resolve));
 const signal=(token:string)=>new Promise<void>((resolve,reject)=>{child.once('error',reject);child.stdout!.on('data',()=>{if(output.includes(token))resolve();});child.once('exit',code=>{if(!output.includes(token))reject(new Error('Lock child exited '+code+': '+errors));});});
 const started=signal('started'),entered=signal('entered');return {child,started,entered,exited};
}
it('recovers a lock held by a killed process while a different real process is waiting',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'readest-crash-'));roots.push(root);const lock=path.join(root,'refresh.lock'),first=worker(lock,'hold');await first.entered;expect(await fs.readFile(lock,'utf8')).toBe(String(first.child.pid));
 const second=worker(lock,'hold');await second.started;first.child.kill('SIGKILL');await first.exited;await second.entered;expect(await fs.readFile(lock,'utf8')).toBe(String(second.child.pid));second.child.stdin!.end();expect(await second.exited).toBe(0);expect(await fs.stat(lock).then(()=>true).catch(()=>false)).toBe(false);
},20000);
it('waits for an active prior-release PID owner before entering its critical section',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'readest-legacy-'));roots.push(root);const lock=path.join(root,'refresh.lock'),journal=path.join(root,'journal'),legacy=worker(lock,'hold',journal,'legacy');await legacy.entered;
 const current=worker(lock,'journal',journal);await current.started;const deadline=Date.now()+5000;
 while(!(await fs.readdir(root)).some(n=>n.endsWith('.owner'))){if(Date.now()>deadline)throw new Error('Current client did not reach the prior-release owner');await new Promise(r=>setTimeout(r,10));}
 expect(await fs.readFile(lock,'utf8')).toBe(String(legacy.child.pid));expect((await fs.readFile(journal,'utf8')).trim().split('\n')).toEqual(['start '+legacy.child.pid]);
 legacy.child.stdin!.end();expect(await legacy.exited).toBe(0);await current.entered;expect(await current.exited).toBe(0);expect((await fs.readFile(journal,'utf8')).trim().split('\n')).toEqual(['start '+legacy.child.pid,'end '+legacy.child.pid,'start '+current.child.pid,'end '+current.child.pid]);
},20000);
it('keeps independent process contenders exclusive after an abandoned owner',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'readest-contenders-'));roots.push(root);const lock=path.join(root,'refresh.lock'),journal=path.join(root,'journal'),owner=worker(lock,'hold');await owner.entered;owner.child.kill('SIGKILL');await owner.exited;
 const contenders=Array.from({length:8},()=>worker(lock,'journal',journal));await Promise.all(contenders.map(c=>c.entered));expect(await Promise.all(contenders.map(c=>c.exited))).toEqual(Array(8).fill(0));
 const events=(await fs.readFile(journal,'utf8')).trim().split('\n');expect(events).toHaveLength(16);let active:string|null=null;for(const event of events){const [kind,pid]=event.split(' ');if(kind==='start'){expect(active,'overlapping critical sections').toBeNull();active=pid!;}else{expect(active).toBe(pid);active=null;}}expect(active).toBeNull();
},20000);
