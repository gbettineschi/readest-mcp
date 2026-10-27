import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,scopedId,type Book,type Warning} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import type {CloudConfig} from '../config.js';
import type {LibrarySource,SourceCheckpoint,SourceRead,FileResolution} from '../domain/source.js';
import {record,normalizeBook,normalizeAnnotation,type Raw} from './local-format.js';
import {CredentialStore,createCloudAuth} from './cloud-auth.js';
import {CloudClient} from './cloud-client.js';
const ms=(v:unknown)=>typeof v==='number'?v:typeof v==='string'?(Date.parse(v)||0):0;
const stamp=(r:Raw)=>Math.max(ms(r.updated_at??r.updatedAt),ms(r.deleted_at??r.deletedAt),ms(r.synced_at));
const fields={books:['user_id','book_hash','meta_hash','title','author','format','tags','group_id','group_name','reading_status','progress','created_at','updated_at','deleted_at','synced_at','uploaded_at'],configs:['user_id','book_hash','meta_hash','progress','location','updated_at','deleted_at'],notes:['user_id','book_hash','meta_hash','id','type','cfi','page','xpointer0','xpointer1','text','note','color','style','global','ink','created_at','updated_at','deleted_at']};
type Channel=keyof typeof fields;
const selected=(r:Raw,c:Channel):Raw=>Object.fromEntries(fields[c].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const decode=(value:unknown)=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return undefined;}};
export async function createCloudSource(config:CloudConfig,credentials=new CredentialStore(config.credential_file)):Promise<LibrarySource>{
  const initial=await credentials.load(),user=initial?.user_id??null;
  const source_id='cloud_'+hash(config.api_base+'\0'+(user??config.credential_file)).slice(0,24);
  const auth=createCloudAuth(config,credentials),client=new CloudClient(config,auth);
  const account=async()=>{const current=await credentials.load();if(!current)throw new DomainError('AUTH_REQUIRED','Sign in with readest-mcp login.');if(current.user_id!==user)throw new DomainError('ACCOUNT_CHANGED','Restart the MCP after changing the signed-in account.');if(current.api_base!==config.api_base||current.auth_url!==config.auth_url)throw new DomainError('AUTH_REQUIRED','Session belongs to another cloud configuration. Sign in again.');};
  async function pull(channel:Channel,since:number,signal:AbortSignal):Promise<Raw[]>{
    const rows:Raw[]=[];let cursor=since;
    for(let pages=0;pages<10000;pages++){
      const data=await client.get('/sync',{type:channel,since:String(cursor),...(channel==='books'?{limit:'1000'}:{})},signal);
      const values=data[channel];if(!Array.isArray(values))throw new DomainError('SOURCE_UNAVAILABLE','Cloud returned an unsupported sync response.');
      const page=values.map(record);
      for(const r of page)if(r.user_id!==user||typeof r.book_hash!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(r.book_hash)||(channel==='notes'&&typeof r.id!=='string'))throw new DomainError('SOURCE_UNAVAILABLE','Cloud returned an invalid or mismatched record.');
      rows.push(...page.map(r=>selected(r,channel)));
      if(channel!=='books'||page.length<1000)return rows;
      const next=Math.max(cursor,...page.map(r=>ms(r.synced_at)));
      if(next<=cursor)throw new DomainError('SOURCE_UNAVAILABLE','Cloud pagination did not advance. Refresh cannot be marked complete.',true);cursor=next;
    }
    throw new DomainError('LIMIT_EXCEEDED','Cloud library exceeds the supported paging limit.');
  }
  return {mode:'cloud',source_id,validateAccess:account,
    async readSnapshot(previous,signal):Promise<SourceRead>{
      await account();signal.throwIfAborted();if(previous?.source_id&&previous.source_id!==source_id)throw new DomainError('ACCOUNT_CHANGED','Cached source identity does not match this account.');
      const prior=previous??{version:1};const channels:Channel[]=['books','configs','notes'];
      const outcomes=await Promise.allSettled(channels.map(c=>pull(c,Math.max(0,Number(prior[c+'_cursor']??0)-(c==='books'?0:1)),signal)));
      const checkpoint:SourceCheckpoint={...prior,version:1,source_id};const maps={} as Record<Channel,Map<string,Raw>>;const warnings:Warning[]=[];const deleted_book_ids:string[]=[],deleted_annotation_ids:string[]=[];
      for(let i=0;i<channels.length;i++){
        const c=channels[i]!,old=Array.isArray(prior[c+'_records'])?(prior[c+'_records'] as unknown[]).map(record):[];const map=new Map(old.map(r=>[String(c==='notes'?r.id:r.book_hash),r]));maps[c]=map;
        const outcome=outcomes[i]!;
        if(outcome.status==='rejected'){
          if(c==='books'&&!Array.isArray(prior.books_records))throw outcome.reason;
          if(outcome.reason instanceof DomainError&&['AUTH_REQUIRED','ACCESS_DENIED','ACCOUNT_CHANGED'].includes(outcome.reason.code))throw outcome.reason;
          const targets=c==='notes'?['quotes','notes']:c==='configs'?['metadata']:undefined;
          warnings.push({code:'CHANNEL_UNAVAILABLE',message:'Cloud '+c+' could not be refreshed.',targets});if(Array.isArray(prior[c+'_records']))warnings.push({code:'USING_CACHE',message:'Previously saved '+c+' are being used.',targets});continue;
        }
        for(const row of outcome.value){const key=String(c==='notes'?row.id:row.book_hash),old=map.get(key);if(!old||stamp(row)>=stamp(old))map.set(key,row);}
        checkpoint[c+'_records']=[...map.values()];checkpoint[c+'_cursor']=Math.max(Number(prior[c+'_cursor']??0),...outcome.value.map(r=>c==='books'?ms(r.synced_at)||stamp(r):stamp(r)));
      }
      const books:Book[]=[];const file_versions:Record<string,string|null>={};const notesOk=outcomes[2]?.status==='fulfilled'||Array.isArray(prior.notes_records);
      for(const raw of maps.books.values()){
        const id=scopedId('b',source_id,String(raw.book_hash));if(raw.deleted_at){deleted_book_ids.push(id);continue;}
        const cfg=maps.configs.get(String(raw.book_hash))??{};
        const book=normalizeBook({hash:raw.book_hash,title:raw.title,author:raw.author,format:raw.format,tags:raw.tags,groupId:raw.group_id,groupName:raw.group_name,readingStatus:raw.reading_status,progress:raw.progress,createdAt:raw.created_at,updatedAt:raw.updated_at},{progress:decode(cfg.progress),location:cfg.location,booknotes:notesOk?[]:undefined},source_id);books.push(book);file_versions[book.id]=typeof raw.uploaded_at==='string'?raw.uploaded_at:null;
      }
      const annotations:SourceRead['annotations']=[];
      for(const row of maps.notes.values()){
        const note=normalizeAnnotation({...row,createdAt:row.created_at,updatedAt:row.updated_at},scopedId('b',source_id,String(row.book_hash)),source_id);
        if(!note){warnings.push({code:'ANNOTATION_UNSUPPORTED',message:'A cloud annotation type could not be interpreted.',book_id:scopedId('b',source_id,String(row.book_hash)),targets:['quotes','notes']});continue;}
        if(row.deleted_at)deleted_annotation_ids.push(note.id);else annotations.push(note);
      }
      const refreshed_at=outcomes.some(r=>r.status==='fulfilled')?new Date().toISOString():typeof prior.refreshed_at==='string'?prior.refreshed_at:null;
      if(refreshed_at===null)throw new DomainError('SOURCE_UNAVAILABLE','No cloud channel could be refreshed.',true);checkpoint.refreshed_at=refreshed_at;
      return {source_id,kind:previous?'delta':'full',books,annotations,deleted_book_ids,deleted_annotation_ids,checkpoint,refreshed_at,coverage:{scope:'configured_source',completeness:outcomes[0]?.status==='fulfilled'?'complete':'partial',known_books:books.length,covered_books:books.length},warnings,file_versions};
    },
    async resolveBookFile(book,options):Promise<FileResolution>{
      try{await account();options.signal.throwIfAborted();if(!['EPUB','PDF'].includes(book.format))throw new DomainError('UNSUPPORTED_CONTENT','Only EPUB and PDF content is supported.');
        const dir=path.join(config.cache_dir,source_id,'files'),ext='.'+book.format.toLowerCase();
        if(book.revision){const cached=path.join(dir,book.revision+ext);if(await fs.stat(cached).then(s=>s.isFile()).catch(()=>false))return {status:'available',path:cached,revision:book.revision};}
        if(!options.acquire)throw new DomainError('CONTENT_UNAVAILABLE','Book has not been downloaded into the MCP cache.');
        for(let attempt=0;attempt<2;attempt++){
          const data=await client.get('/storage/download',{fileKey:book.source_key+'/'+book.source_key+ext},options.signal);
          if(typeof data.downloadUrl!=='string')throw new DomainError('CONTENT_UNAVAILABLE','No uploaded book file is available in Readest Cloud.');
          let bytes:Buffer;try{bytes=await client.download(data.downloadUrl,options.signal);}catch(error){if(attempt===0&&error instanceof DomainError&&error.code==='SIGNED_URL_EXPIRED')continue;throw error;}
          const revision=hash(bytes);await fs.mkdir(dir,{recursive:true,mode:0o700});const target=path.join(dir,revision+ext),temp=target+'.'+randomUUID()+'.part';await fs.writeFile(temp,bytes,{mode:0o600,flag:'wx'});await fs.rename(temp,target);return {status:'available',path:target,revision};
        }
        throw new DomainError('SOURCE_UNAVAILABLE','Book download could not be renewed.',true);
      }catch(error){return {status:'unavailable',code:error instanceof DomainError?error.code:'SOURCE_UNAVAILABLE',message:error instanceof DomainError?error.message:'Book download failed.'};}
    }
  };
}
