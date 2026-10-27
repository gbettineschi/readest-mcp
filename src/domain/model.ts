import * as z from 'zod/v4';
import { createHash } from 'node:crypto';
export const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const scopedId=(kind:string,source:string,key:string)=>kind+'_'+hash(source+'\0'+key).slice(0,32);
const text=z.string().nullable();
const nonnegative=z.number().int().nonnegative();
export const ReadingSchema=z.object({status:z.enum(['unread','reading','finished','abandoned']).nullable(),current:z.number().nullable(),total:z.number().nullable(),location:text});
export const AvailabilitySchema=z.object({file:z.enum(['available','unavailable','unknown']),annotations:z.enum(['available','unavailable','unknown']),index:z.enum(['ready','pending','failed','unsupported'])});
export const BookSchema=z.object({id:z.string(),source_key:z.string(),title:z.string(),author:z.string(),format:z.string(),tags:z.array(z.string()),group:z.object({id:text,name:text}).nullable(),reading:ReadingSchema,created_at:text,updated_at:text,revision:text,availability:AvailabilitySchema});
export type Book=z.infer<typeof BookSchema>;
export const AnnotationSchema=z.object({id:z.string(),book_id:z.string(),kind:z.enum(['bookmark','annotation','excerpt','notebook','ink']),quote:text,note:text,color:text,style:text,locator:z.object({cfi:text,page:z.number().nullable(),xpointer0:text,xpointer1:text}),created_at:text,updated_at:text,ink:z.array(z.unknown()).nullable(),ink_available:z.boolean()});
export type Annotation=z.infer<typeof AnnotationSchema>;
export const LocationSchema=z.object({kind:z.enum(['epub','pdf','annotation']),chapter:text,href:text,spine_index:z.number().int().nullable(),paragraph:z.number().int().nullable(),page:z.number().int().nullable(),page_label:text,start:nonnegative,end:nonnegative,cfi:text});
export type Location=z.infer<typeof LocationSchema>;
export const StructureSchema=z.object({id:z.string(),book_id:z.string(),revision:z.string(),kind:z.enum(['chapter','page']),label:z.string(),parent_id:text,order:nonnegative,href:text,page:z.number().int().nullable()});
export type StructureItem=z.infer<typeof StructureSchema>;
export const EvidenceSchema=z.object({passage_id:z.string(),book_id:z.string(),revision:z.string(),title:z.string(),author:z.string(),source_kind:z.enum(['book_text','quote','note']),text:z.string(),location:LocationSchema});
export type Evidence=z.infer<typeof EvidenceSchema>;
export interface Passage extends Evidence {structure_id:string;order:number;}
export interface ExtractedBook {revision:string;structure:StructureItem[];passages:Passage[];warnings:Warning[];pages:{page:number;status:'text'|'empty'|'failed'}[];}
export interface Warning {code:string;message:string;}
export interface Page<T> {items:T[];next_cursor:string|null;}
export interface ModelManifest {id:string;revision:string;dtype:string;dimensions:number;chunk_version:number;}
export interface EmbeddedChunk {passage_id:string;start:number;end:number;vector:Float32Array;}
export interface QueryEmbedding {vector:Float32Array;manifest:ModelManifest;}
export interface Embedder {manifest:ModelManifest;embed(texts:string[],kind:'query'|'passage'):Promise<Float32Array[]>;}
export interface EvidenceReference {passage_id:string;revision:string;}
export const blankLocation=(kind:Location['kind']):Location=>({kind,chapter:null,href:null,spine_index:null,paragraph:null,page:null,page_label:null,start:0,end:0,cfi:null});
