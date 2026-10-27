import * as z from 'zod/v4';
import { AnnotationSchema,BookSchema,EvidenceSchema,StructureSchema } from '../domain/model.js';
import { resultSchema,type Result } from '../domain/result.js';
import { LIMITS } from '../limits.js';
export const toolNames=['library_status','list_books','get_book','list_annotations','search_library','read_content'] as const;
export type ToolName=typeof toolNames[number];
const id=z.string().min(1).max(2048);
const cursor=z.string().max(4096).nullable().default(null);
const pagination={limit:z.number().int().min(1).max(LIMITS.maxPage).default(LIMITS.page),cursor};
const filters=z.object({query:z.string().max(LIMITS.query).optional(),author:z.string().max(500).optional(),tags:z.array(z.string().max(200)).max(50).optional(),formats:z.array(z.string().max(20)).max(20).optional(),reading_status:z.enum(['unread','reading','finished','abandoned']).optional(),book_ids:z.array(id).max(100).optional()}).strict().optional();
export const inputSchemas={
  library_status:z.object({}).strict(),
  list_books:z.object({...pagination,filters}).strict(),
  get_book:z.object({book_id:id,include_structure:z.boolean().default(false),...pagination}).strict(),
  list_annotations:z.object({book_id:id,types:z.array(AnnotationSchema.shape.kind).max(5).optional(),colors:z.array(z.string().max(100)).max(50).optional(),created_after:z.iso.datetime({offset:true}).optional(),created_before:z.iso.datetime({offset:true}).optional(),...pagination}).strict(),
  search_library:z.object({query:z.string().trim().min(1).max(LIMITS.query),mode:z.enum(['keyword','semantic','hybrid']).default('keyword'),targets:z.array(z.enum(['book_text','quotes','notes'])).min(1).max(3).default(['book_text','quotes','notes']),filters,...pagination}).strict(),
  read_content:z.object({selector:z.object({kind:z.enum(['passage','structure','annotation']),id}).strict(),cursor,max_chars:z.number().int().min(1).max(LIMITS.maxContent).default(LIMITS.content),context_chars:z.number().int().min(0).max(LIMITS.maxContent).default(0)}).strict()
};
const page=<T extends z.ZodType>(item:T)=>z.object({items:z.array(item),next_cursor:z.string().nullable()});
export const dataSchemas={
  library_status:z.object({known_books:z.number().int(),annotations_available:z.number().int(),text_indexed:z.number().int(),formats:z.record(z.string(),z.number().int()),capabilities:z.object({semantic:z.boolean()}),last_refresh_error:z.string().nullable()}),
  list_books:page(BookSchema),
  get_book:z.object({book:BookSchema,structure:page(StructureSchema).nullable()}),
  list_annotations:page(AnnotationSchema),
  search_library:z.object({items:z.array(z.object({evidence:EvidenceSchema,score:z.number()})),next_cursor:z.string().nullable(),requested_mode:z.enum(['keyword','semantic','hybrid']),used_mode:z.enum(['keyword','semantic','hybrid'])}),
  read_content:z.object({items:z.array(EvidenceSchema),annotation:AnnotationSchema.nullable(),match:z.enum(['exact','ambiguous','unresolved']).nullable(),next_cursor:z.string().nullable()})
};
export const outputSchemas={library_status:resultSchema(dataSchemas.library_status),list_books:resultSchema(dataSchemas.list_books),get_book:resultSchema(dataSchemas.get_book),list_annotations:resultSchema(dataSchemas.list_annotations),search_library:resultSchema(dataSchemas.search_library),read_content:resultSchema(dataSchemas.read_content)};
export type Inputs={[K in ToolName]:z.infer<typeof inputSchemas[K]>};
export type Outputs={[K in ToolName]:z.infer<typeof dataSchemas[K]>};
export type ToolHandlers={[K in ToolName]:(input:Inputs[K])=>Promise<Result<Outputs[K]>>};
export const descriptions:Record<ToolName,string>={library_status:'Get library availability and indexing status.',list_books:'List books known to the configured source.',get_book:'Get available information about a book.',list_annotations:'List saved annotations for a book.',search_library:'Search available book text and annotations.',read_content:'Read available book content.'};
