import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import {LIMITS} from '../limits.js';
export function within(file:string,root:string):boolean {const r=path.relative(root,file);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
export async function plannedRealPath(file:string):Promise<string>{
  let parent=path.resolve(file);const suffix:string[]=[];
  for(;;){try{return path.join(await fs.realpath(parent),...suffix);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const next=path.dirname(parent);if(next===parent)throw error;suffix.unshift(path.basename(parent));parent=next;}}
}
export async function resolveAllowedPath(file:string,roots:string[]):Promise<string>{
  const real=await fs.realpath(file);const allowed=await Promise.all(roots.map(r=>fs.realpath(r).catch(()=>null)));
  if(!allowed.some(r=>r!==null&&within(real,r)))throw new DomainError('PATH_NOT_ALLOWED','Content is outside the configured content roots.');
  return real;
}
export async function readStableJson(file:string):Promise<unknown>{
  for(let attempt=0;attempt<2;attempt++){
    const before=await fs.stat(file);if(before.size>LIMITS.metadataBytes)throw new DomainError('LIMIT_EXCEEDED','Metadata exceeds the supported size limit.');
    const raw=await fs.readFile(file,'utf8'),after=await fs.stat(file);
    if(before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ino===after.ino)return JSON.parse(raw);
  }
  throw new DomainError('SOURCE_CHANGED','Saved data changed while being read. Retry after Readest finishes saving.');
}
export async function snapshotFile(file:string,roots:string[],cache:string,signal:AbortSignal):Promise<{path:string;revision:string}>{
  const destination=await plannedRealPath(cache);
  for(const root of roots)if(within(destination,await plannedRealPath(root)))throw new DomainError('INVALID_CONFIG','Cache must be outside source content roots.');
  for(let attempt=0;attempt<2;attempt++){
    signal.throwIfAborted();const real=await resolveAllowedPath(file,roots);const before=await fs.stat(real);
    if(!before.isFile()||before.size>LIMITS.sourceBytes)throw new DomainError('LIMIT_EXCEEDED','Book exceeds the supported file limit.');
    const bytes=await fs.readFile(real,{signal}),after=await fs.stat(real);await resolveAllowedPath(file,roots);
    if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==after.size)continue;
    const revision=hash(bytes);await fs.mkdir(cache,{recursive:true,mode:0o700});
    const target=path.join(cache,revision+path.extname(real).toLowerCase());const temp=target+'.'+randomUUID()+'.part';
    await fs.writeFile(temp,bytes,{mode:0o600,flag:'wx'});await fs.rename(temp,target);return {path:target,revision};
  }
  throw new DomainError('SOURCE_CHANGED','Book changed while being read. Retry after its transfer finishes.');
}
