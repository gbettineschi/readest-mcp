import {AnnotationSchema,BookSchema,scopedId,type Annotation,type Book} from '../domain/model.js';
export type Raw=Record<string,unknown>;
export const record=(x:unknown):Raw=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Raw:{};
export const string=(x:unknown):string|null=>typeof x==='string'?x:null;
export const timestamp=(x:unknown):string|null=>{if(x===null||x===undefined)return null;const d=new Date(typeof x==='number'||typeof x==='string'?x:NaN);return Number.isFinite(d.getTime())?d.toISOString():null;};
/** Read legacy split records as one view; never persist a migration or create new timestamps. */
export function savedNotes(config:Raw):Raw[]{
  const notes=(Array.isArray(config.booknotes)?config.booknotes:[]).map(record);
  if(Number(config.schemaVersion??0)>=2)return notes;
  const groups=new Map<string,Raw[]>(),other:Raw[]=[];
  for(const n of notes){if(n.type==='annotation'&&n.cfi&&!n.global&&!n.deletedAt){const key=String(n.cfi);groups.set(key,[...(groups.get(key)??[]),n]);}else other.push(n);}
  for(const group of groups.values()){
    const ranked=[...group].sort((a,b)=>Number(Boolean(b.style))-Number(Boolean(a.style))||Number(a.createdAt??0)-Number(b.createdAt??0)||String(a.id).localeCompare(String(b.id)));
    const note=[...group].filter(n=>typeof n.note==='string'&&n.note.trim()).sort((a,b)=>Number(b.updatedAt??0)-Number(a.updatedAt??0))[0];
    other.push({...ranked[0],...(note?{note:note.note}:{}),updatedAt:Math.max(...group.map(n=>Number(n.updatedAt??0)))});
  }
  return other;
}
export function normalizeBook(raw:Raw,config:Raw,source:string):Book{
  const key=String(raw.hash);const progress=Array.isArray(config.progress)?config.progress:Array.isArray(raw.progress)?raw.progress:[];
  return BookSchema.parse({id:scopedId('b',source,key),source_key:key,title:string(raw.title)??'',author:string(raw.author)??'',format:string(raw.format)??'UNKNOWN',tags:Array.isArray(raw.tags)?raw.tags.filter(t=>typeof t==='string'):[],group:raw.groupId||raw.groupName?{id:string(raw.groupId),name:string(raw.groupName)}:null,reading:{status:['unread','reading','finished','abandoned'].includes(String(raw.readingStatus))?raw.readingStatus:null,current:typeof progress[0]==='number'?progress[0]:null,total:typeof progress[1]==='number'?progress[1]:null,location:string(config.location)},created_at:timestamp(raw.createdAt),updated_at:timestamp(raw.updatedAt??raw.lastUpdated),revision:null,availability:{file:'unknown',annotations:Array.isArray(config.booknotes)?'available':'unavailable',index:['EPUB','PDF'].includes(String(raw.format))?'pending':'unsupported'}});
}
export function normalizeAnnotation(raw:Raw,book_id:string,source:string):Annotation|null{
  if(typeof raw.id!=='string'||!['bookmark','annotation','excerpt','notebook','ink'].includes(String(raw.type)))return null;
  return AnnotationSchema.parse({id:scopedId('a',source,book_id+'\0'+raw.id),book_id,kind:raw.type,quote:string(raw.text),note:string(raw.note),color:string(raw.color),style:string(raw.style),locator:{cfi:string(raw.cfi),page:typeof raw.page==='number'?raw.page:null,xpointer0:string(raw.xpointer0),xpointer1:string(raw.xpointer1)},created_at:timestamp(raw.createdAt),updated_at:timestamp(raw.updatedAt),ink:Array.isArray(raw.ink)?raw.ink:null,ink_available:Array.isArray(raw.ink)&&raw.ink.length>0});
}
