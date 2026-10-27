import * as z from 'zod/v4';
import { LIMITS } from '../limits.js';
import { redact } from '../security/redact.js';
import type { Warning } from './model.js';
export const MetaSchema=z.object({source:z.enum(['local','cloud']),refreshed_at:z.string().nullable(),from_cache:z.boolean(),coverage:z.object({scope:z.literal('configured_source'),completeness:z.enum(['complete','partial','unknown']),known_books:z.number().int().nonnegative().nullable(),covered_books:z.number().int().nonnegative().nullable()})});
export type Meta=z.infer<typeof MetaSchema>;
export const ErrorSchema=z.object({code:z.string(),message:z.string(),retryable:z.boolean()});
export const WarningSchema=z.object({code:z.string(),message:z.string()});
export interface Result<T> {data:T|null;status:'ok'|'partial'|'error';warnings:Warning[];error:z.infer<typeof ErrorSchema>|null;meta:Meta;}
export function resultSchema<T extends z.ZodType>(data:T){
  return z.object({data:data.nullable(),status:z.enum(['ok','partial','error']),warnings:z.array(WarningSchema),error:ErrorSchema.nullable(),meta:MetaSchema}).superRefine((v,c)=>{
    const payload=(v as Record<string,unknown>)['data'];
    if((v.status==='error')!==(v.error!==null))c.addIssue({code:'custom',message:'Error status and error must agree.'});
    if(v.status==='error'&&payload!==null)c.addIssue({code:'custom',message:'Failed operations cannot return successful data.'});
    if(v.status!=='error'&&payload===null)c.addIssue({code:'custom',message:'Successful operations require data.'});
  });
}
export class DomainError extends Error {
  constructor(public code:string,message:string,public retryable=false){super(redact(message));this.name='DomainError';}
}
export function makeResult<T>(input:Result<T>):Result<T>{
  const value={...input,warnings:input.warnings.map(w=>({...w,message:redact(w.message)})),error:input.error?{...input.error,message:redact(input.error.message)}:null};
  resultSchema(z.unknown()).parse(value);
  if(Buffer.byteLength(JSON.stringify(value))>LIMITS.outputBytes)throw new DomainError('LIMIT_EXCEEDED','Response exceeds the output limit. Request a smaller page.');
  return value;
}
export function initialMeta(source:Meta['source']):Meta{return {source,refreshed_at:null,from_cache:false,coverage:{scope:'configured_source',completeness:'unknown',known_books:null,covered_books:null}};}
