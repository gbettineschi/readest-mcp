import {hash,type Book} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import type {Inputs} from '../mcp/schemas.js';
export function matchesBook(book:Book,filters:Inputs['list_books']['filters']):boolean{
  if(!filters)return true;const q=filters.query?.toLocaleLowerCase();return (!q||(book.title+' '+book.author).toLocaleLowerCase().includes(q))&&(!filters.author||book.author.toLocaleLowerCase().includes(filters.author.toLocaleLowerCase()))&&(!filters.tags||filters.tags.every(t=>book.tags.includes(t)))&&(!filters.formats||filters.formats.includes(book.format))&&(!filters.reading_status||book.reading.status===filters.reading_status)&&(!filters.book_ids||filters.book_ids.includes(book.id));
}
export function keywordQuery(query:string):string{
  const tokens=Array.from(query.matchAll(/"([^"]+)"|([\p{L}\p{N}_]+)/gu)).map(m=>m[1]??m[2]!).filter(Boolean);
  return tokens.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' AND ');
}
export function cursorKey(value:unknown):string{return hash(JSON.stringify(value));}
export function readCursor(cursor:string|null,generation:number,key:string,maxOffset=1000000):number{
  if(cursor===null)return 0;try{const data=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(data.g!==generation||data.q!==key)throw new Error();if(!Number.isSafeInteger(data.o)||data.o<0||data.o>maxOffset)throw new Error();return data.o;}catch{throw new DomainError('STALE_CURSOR','Cursor is invalid or belongs to an earlier index generation. Start the listing again.');}
}
export const writeCursor=(generation:number,key:string,offset:number)=>Buffer.from(JSON.stringify({g:generation,q:key,o:offset})).toString('base64url');
