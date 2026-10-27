import type { Annotation, Book, ExtractedBook, Warning } from './model.js';
import type { Meta } from './result.js';
export type SourceCheckpoint={version:1;[channel:string]:unknown};
export interface SourceRead {source_id:string;kind:'full'|'delta';books:Book[];annotations:Annotation[];deleted_book_ids:string[];deleted_annotation_ids:string[];checkpoint:SourceCheckpoint;refreshed_at:string;coverage:Meta['coverage'];warnings:Warning[];file_versions?:Record<string,string|null>;}
export type FileResolution={status:'available';path:string;revision:string}|{status:'unavailable';code:string;message:string};
export interface LibrarySource {readonly mode:'local'|'cloud';readonly source_id:string;validateAccess?():Promise<void>;readSnapshot(previous:SourceCheckpoint|null,signal:AbortSignal):Promise<SourceRead>;resolveBookFile(book:Book,options:{acquire:boolean;signal:AbortSignal}):Promise<FileResolution>;}
export interface DocumentExtractor {extract(book:Book,file:FileResolution):Promise<ExtractedBook>;}
export interface RefreshReport {refreshed_at:string|null;indexed:number;warnings:Warning[];}
