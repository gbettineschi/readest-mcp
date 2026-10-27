import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as z from 'zod/v4';
import {DomainError} from './domain/result.js';
import {within,plannedRealPath} from './security/paths.js';
export interface CacheConfig {cache_dir:string;}
export interface EmbeddingConfig {enabled:boolean;model_dir:string;}
interface BaseConfig extends CacheConfig {embeddings:EmbeddingConfig;}
export interface LocalConfig extends BaseConfig {source:'local';library_dir:string;content_roots:string[];}
export interface CloudConfig extends BaseConfig {source:'cloud';api_base:string;auth_url:string;anon_key:string;credential_file:string;}
export type Config=LocalConfig|CloudConfig;
const base={cache_dir:z.string().optional(),embeddings:z.object({enabled:z.boolean().default(false),model_dir:z.string().optional()}).optional()};
const schema=z.discriminatedUnion('source',[
  z.object({source:z.literal('local'),library_dir:z.string().optional(),content_roots:z.array(z.string()).default([]),...base}).strict(),
  z.object({source:z.literal('cloud'),api_base:z.url(),auth_url:z.url(),anon_key:z.string().min(1),credential_file:z.string(),...base}).strict()
]);
const expand=(p:string,base:string)=>path.resolve(base,p==='~'?os.homedir():p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):p);
export function standardLibraryPaths(home=os.homedir(),platform=process.platform):string[]{
  if(platform==='darwin')return ['Library/Application Support/com.bilingify.readest/Readest/Books','Library/Containers/com.bilingify.readest/Data/Library/Application Support/com.bilingify.readest/Readest/Books'].map(p=>path.join(home,p));
  if(platform==='win32')return [path.join(process.env.APPDATA??path.join(home,'AppData','Roaming'),'com.bilingify.readest','Readest','Books')];
  return [path.join(process.env.XDG_DATA_HOME??path.join(home,'.local','share'),'com.bilingify.readest','Readest','Books')];
}
export async function detectLibrary():Promise<string>{
  const found=[];for(const p of standardLibraryPaths())if(await fs.stat(path.join(p,'library.json')).then(s=>s.isFile()).catch(()=>false))found.push(p);
  if(found.length!==1)throw new DomainError('INVALID_CONFIG',found.length?'Multiple Readest libraries found. Set library_dir.':'No saved Readest library found. Set library_dir after importing or syncing books.');
  return found[0]!;
}
export async function loadConfig(file:string):Promise<Config>{
  let parsed:z.infer<typeof schema>;try{parsed=schema.parse(JSON.parse(await fs.readFile(file,'utf8')));}catch{throw new DomainError('INVALID_CONFIG','Configuration is missing or invalid.');}
  const dir=path.dirname(path.resolve(file));const cache_dir=expand(parsed.cache_dir??path.join(os.homedir(),'.cache','readest-mcp'),dir);
  const embeddings={enabled:parsed.embeddings?.enabled??false,model_dir:expand(parsed.embeddings?.model_dir??path.join(cache_dir,'models'),dir)};
  if(parsed.source==='local'){
    const library_dir=parsed.library_dir?expand(parsed.library_dir,dir):await detectLibrary();const content_roots=parsed.content_roots.map(p=>expand(p,dir));
    for(const root of [library_dir,...content_roots]){const real=await plannedRealPath(root);if(within(await plannedRealPath(cache_dir),real)||within(await plannedRealPath(embeddings.model_dir),real))throw new DomainError('INVALID_CONFIG','Cache and model directories must be outside source content roots.');}
    return {source:'local',library_dir,content_roots,cache_dir,embeddings};
  }
  for(const p of [parsed.api_base,parsed.auth_url])if(new URL(p).protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(new URL(p).hostname))throw new DomainError('INVALID_CONFIG','Cloud connections require HTTPS.');
  return {...parsed,cache_dir,embeddings,credential_file:expand(parsed.credential_file,dir)};
}
