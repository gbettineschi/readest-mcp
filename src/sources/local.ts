import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {hash,scopedId,type Book,type Warning} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import type {LocalConfig} from '../config.js';
import type {LibrarySource,SourceRead,FileResolution} from '../domain/source.js';
import {readStableJson,resolveAllowedPath,snapshotFile,within} from '../security/paths.js';
import {record,normalizeBook,normalizeAnnotation,savedNotes,type Raw} from './local-format.js';
export function createLocalSource(config:LocalConfig):LibrarySource{
  let root=path.resolve(config.library_dir);try{root=realpathSync(root);}catch{/* Keep discovery available while a configured library is offline. */}
  if(within(path.resolve(config.cache_dir),root))throw new DomainError('INVALID_CONFIG','Cache must be outside the Readest library.');
  const source_id='local_'+hash(root).slice(0,24);let records=new Map<string,Raw>();
  const contentPath=async(raw:Raw):Promise<string>=>{
    if(typeof raw.filePath==='string'&&raw.filePath){if(/^[a-z][a-z0-9+.-]*:/i.test(raw.filePath)&&!path.isAbsolute(raw.filePath))throw new DomainError('CONTENT_UNAVAILABLE','Remote or URI content is not supported by the local adapter.');return resolveAllowedPath(raw.filePath,[root,...config.content_roots]);}
    const dir=await resolveAllowedPath(path.join(root,String(raw.hash)),[root]);
    const files=await fs.readdir(dir,{withFileTypes:true});const ext='.'+String(raw.format).toLowerCase();
    const matches=files.filter(f=>(f.isFile()||f.isSymbolicLink())&&f.name.toLowerCase().endsWith(ext));
    if(matches.length!==1)throw new DomainError('CONTENT_UNAVAILABLE',matches.length?'More than one book file matches this record.':'Download the book in Readest, then refresh.');
    return resolveAllowedPath(path.join(dir,matches[0]!.name),[root]);
  };
  return {mode:'local',source_id,
    async readSnapshot(_previous,signal):Promise<SourceRead>{
      signal.throwIfAborted();let saved:unknown;try{saved=await readStableJson(await resolveAllowedPath(path.join(root,'library.json'),[root]));}catch{throw new DomainError('SOURCE_UNAVAILABLE','Saved Readest library is missing, changing or unreadable.',true);}
      if(!Array.isArray(saved))throw new DomainError('SOURCE_UNAVAILABLE','Saved Readest catalogue has an unsupported format.');
      const books:Book[]=[],annotations:SourceRead['annotations']=[],deleted_book_ids:string[]=[],deleted_annotation_ids:string[]=[],warnings:Warning[]=[];const next=new Map<string,Raw>();let invalid=false;
      for(const value of saved){signal.throwIfAborted();const raw=record(value);if(typeof raw.hash!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(raw.hash)){invalid=true;warnings.push({code:'INVALID_RECORD',message:'A catalogue entry could not be identified.'});continue;}
        const book_id=scopedId('b',source_id,raw.hash);if(raw.deletedAt){deleted_book_ids.push(book_id);continue;}
        let conf:Raw={};try{conf=record(await readStableJson(await resolveAllowedPath(path.join(root,raw.hash,'config.json'),[root])));}catch{warnings.push({code:'ANNOTATIONS_UNAVAILABLE',message:'Saved annotation data is unavailable for a book.'});}
        const book=normalizeBook(raw,conf,source_id);next.set(book.id,raw);
        try{await contentPath(raw);book.availability.file='available';}catch{book.availability.file='unavailable';}
        for(const note of savedNotes(conf)){const normalized=normalizeAnnotation(note,book.id,source_id);if(!normalized){warnings.push({code:'ANNOTATION_UNSUPPORTED',message:'An annotation record could not be interpreted.'});continue;}if(note.deletedAt)deleted_annotation_ids.push(normalized.id);else annotations.push(normalized);}
        books.push(book);
      }
      if(invalid&&books.length===0&&saved.length>0)throw new DomainError('SOURCE_UNAVAILABLE','No saved catalogue entries could be interpreted.');
      records=next;return {source_id,kind:invalid?'delta':'full',books,annotations,deleted_book_ids,deleted_annotation_ids,checkpoint:{version:1},refreshed_at:new Date().toISOString(),coverage:{scope:'configured_source',completeness:invalid?'partial':'complete',known_books:books.length,covered_books:books.length},warnings};
    },
    async resolveBookFile(book,options):Promise<FileResolution>{
      try{options.signal.throwIfAborted();const raw=records.get(book.id);if(!raw)throw new DomainError('CONTENT_UNAVAILABLE','Refresh the saved catalogue before reading this book.');
        const file=await contentPath(raw);const snapshot=await snapshotFile(file,[root,...config.content_roots],path.join(config.cache_dir,source_id,'files'),options.signal);return {status:'available',...snapshot};
      }catch(error){return {status:'unavailable',code:error instanceof DomainError?error.code:'CONTENT_UNAVAILABLE',message:error instanceof DomainError?error.message:'Book file is unavailable. Download it in Readest, then refresh.'};}
    }
  };
}
