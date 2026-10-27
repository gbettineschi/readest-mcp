import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {AnnotationSchema,BookSchema,blankLocation,hash,scopedId,type Annotation,type Book,type ExtractedBook,type Passage,type StructureItem,type Warning,type Page,type QueryEmbedding,type ModelManifest,type EmbeddedChunk} from '../domain/model.js';
import {DomainError,type Meta} from '../domain/result.js';
import type {SourceRead,SourceCheckpoint} from '../domain/source.js';
import type {CacheConfig} from '../config.js';
import type {Inputs,Outputs} from '../mcp/schemas.js';
import {LIMITS} from '../limits.js';
import {withFileLock} from '../security/lock.js';
import {matchesBook,keywordQuery,cursorKey,readCursor,writeCursor} from './search.js';

const unique=(warnings:Warning[])=>[...new Map(warnings.map(w=>[w.code+'\0'+w.message,w])).values()];
export class IndexStore {
  private db:DatabaseSync;private directory:string;
  constructor(config:CacheConfig,public readonly source_id:string){
    if(!/^[a-zA-Z0-9_-]+$/.test(source_id))throw new DomainError('INVALID_CONFIG','Invalid source identity.');
    this.directory=path.join(config.cache_dir,source_id);mkdirSync(this.directory,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(this.directory,'index.sqlite'),{timeout:1000});
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS annotations(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS annotation_book ON annotations(book_id); CREATE TABLE IF NOT EXISTS contents(book_id TEXT PRIMARY KEY,revision TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,source_kind TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS evidence_book ON evidence(book_id); CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(id UNINDEXED,book_id UNINDEXED,source_kind UNINDEXED,text,tokenize='unicode61 remove_diacritics 2'); CREATE TABLE IF NOT EXISTS file_versions(book_id TEXT PRIMARY KEY,version TEXT NOT NULL); CREATE TABLE IF NOT EXISTS vectors(passage_id TEXT NOT NULL,book_id TEXT NOT NULL,revision TEXT NOT NULL,model TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(passage_id,model,start));");
    const version=this.meta<number>('schema_version');if(version!==null&&version!==1)throw new DomainError('INDEX_UNAVAILABLE','Cache version is unsupported. Choose a new cache directory.');this.setMeta('schema_version',1);
  }
  private meta<T>(key:string):T|null{const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(String(row.value)) as T:null;}
  private setMeta(key:string,value:unknown):void{this.db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  private transaction(run:()=>void):void{
    let started=false;try{this.db.exec('BEGIN IMMEDIATE');started=true;run();this.db.exec('COMMIT');}catch(error){if(started)this.db.exec('ROLLBACK');if(error instanceof DomainError)throw error;if(/busy|locked/i.test(String((error as Error).message)))throw new DomainError('INDEX_BUSY','Generated cache is busy or locked. Retry shortly.',true);throw new DomainError('INDEX_UNAVAILABLE','Generated cache could not be updated.');}
  }
  withWriter<T>(run:()=>Promise<T>):Promise<T>{return withFileLock(path.join(this.directory,'refresh.lock'),run);}
  generation():number{return this.meta<number>('generation')??0;}
  private bump(){this.setMeta('generation',this.generation()+1);}
  getCheckpoint():SourceCheckpoint|null{return this.meta<SourceCheckpoint>('checkpoint');}
  refreshedAt():string|null{return this.meta<string>('refreshed_at');}
  hasSnapshot():boolean{return this.refreshedAt()!==null;}
  warnings():Warning[]{return this.meta<Warning[]>('warnings')??[];}
  lastError():string|null{return this.meta<string>('last_error');}
  private allBooks():Book[]{return this.db.prepare('SELECT data FROM books ORDER BY id').all().map(r=>BookSchema.parse(JSON.parse(String(r.data))));}
  getBook(id:string):Book|null{const row=this.db.prepare('SELECT data FROM books WHERE id=?').get(id);return row?BookSchema.parse(JSON.parse(String(row.data))):null;}
  getAnnotation(id:string):Annotation|null{const row=this.db.prepare('SELECT data FROM annotations WHERE id=?').get(id);return row?AnnotationSchema.parse(JSON.parse(String(row.data))):null;}
  getContent(id:string):ExtractedBook|null{const row=this.db.prepare('SELECT data FROM contents WHERE book_id=?').get(id);if(!row)return null;const content=JSON.parse(String(row.data)) as ExtractedBook;const book=this.getBook(id);if(book)content.passages=content.passages.map(p=>({...p,title:book.title,author:book.author}));return content;}
  getPassage(id:string):Passage|null{const row=this.db.prepare('SELECT data FROM evidence WHERE id=?').get(id);if(!row)return null;const passage=JSON.parse(String(row.data)) as Passage,book=this.getBook(passage.book_id);return book?{...passage,title:book.title,author:book.author}:null;}
  private removeEvidence(book_id:string,kinds:string[]=['book_text','quote','note']):void{
    for(const kind of kinds){this.db.prepare('DELETE FROM vectors WHERE passage_id IN (SELECT id FROM evidence WHERE book_id=? AND source_kind=?)').run(book_id,kind);this.db.prepare('DELETE FROM search_fts WHERE book_id=? AND source_kind=?').run(book_id,kind);this.db.prepare('DELETE FROM evidence WHERE book_id=? AND source_kind=?').run(book_id,kind);}
  }
  private insertEvidence(passage:Passage):void{
    this.db.prepare('INSERT INTO evidence(id,book_id,source_kind,data) VALUES (?,?,?,?)').run(passage.passage_id,passage.book_id,passage.source_kind,JSON.stringify(passage));this.db.prepare('INSERT INTO search_fts(id,book_id,source_kind,text) VALUES (?,?,?,?)').run(passage.passage_id,passage.book_id,passage.source_kind,passage.text);
  }
  private removeBook(id:string):void{this.removeEvidence(id);this.db.prepare('DELETE FROM annotations WHERE book_id=?').run(id);this.db.prepare('DELETE FROM contents WHERE book_id=?').run(id);this.db.prepare('DELETE FROM file_versions WHERE book_id=?').run(id);this.db.prepare('DELETE FROM books WHERE id=?').run(id);}
  private indexAnnotations(book:Book):void{
    this.removeEvidence(book.id,['quote','note']);const notes=this.db.prepare('SELECT data FROM annotations WHERE book_id=? ORDER BY id').all(book.id);
    for(const row of notes){const note=AnnotationSchema.parse(JSON.parse(String(row.data))),revision=hash(JSON.stringify(note));
      for(const [kind,text]of [['quote',note.quote],['note',note.note]] as const){if(!text?.trim())continue;this.insertEvidence({passage_id:scopedId('p',note.id,revision+'\0'+kind),book_id:book.id,revision,title:book.title,author:book.author,source_kind:kind,text,location:{...blankLocation('annotation'),cfi:note.locator.cfi,page:note.locator.page,start:0,end:text.length},structure_id:'',order:0});}
    }
  }
  applySourceRead(read:SourceRead):void{
    if(read.source_id!==this.source_id)throw new DomainError('ACCOUNT_CHANGED','Source snapshot belongs to a different cache partition.');
    this.transaction(()=>{
      const notes=read.annotations.map(n=>AnnotationSchema.parse(n)),books=read.books.map(b=>BookSchema.parse(b));const before=this.allBooks();let dirty=false;const warnings=[...read.warnings];
      const incoming=new Set(books.map(b=>b.id));for(const old of before)if(read.deleted_book_ids.includes(old.id)||(read.kind==='full'&&!incoming.has(old.id))){this.removeBook(old.id);dirty=true;}
      for(const book of books){
        const old=this.getBook(book.id),content=this.getContent(book.id);const version=read.file_versions?.[book.id],priorVersion=this.db.prepare('SELECT version FROM file_versions WHERE book_id=?').get(book.id)?.version;
        const changed=Boolean(content&&(old?.format!==book.format||(version&&version!==priorVersion)));
        if(changed){this.removeEvidence(book.id,['book_text']);this.db.prepare('DELETE FROM contents WHERE book_id=?').run(book.id);dirty=true;}
        if(content&&!changed){book.revision=content.revision;book.availability.index=old?.availability.index??'ready';}
        if(version)this.db.prepare('INSERT INTO file_versions(book_id,version) VALUES (?,?) ON CONFLICT(book_id) DO UPDATE SET version=excluded.version').run(book.id,version);
        if(JSON.stringify(old)!==JSON.stringify(book))dirty=true;
        this.db.prepare('INSERT INTO books(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(book.id,JSON.stringify(book));
        if(book.availability.annotations==='available'){
          const previous=this.db.prepare('SELECT data FROM annotations WHERE book_id=? ORDER BY id').all().map(r=>String(r.data));const current=notes.filter(n=>n.book_id===book.id).sort((a,b)=>a.id.localeCompare(b.id));
          if(JSON.stringify(previous)!==JSON.stringify(current.map(n=>JSON.stringify(n)))){dirty=true;this.db.prepare('DELETE FROM annotations WHERE book_id=?').run(book.id);for(const note of current)this.db.prepare('INSERT INTO annotations(id,book_id,data) VALUES (?,?,?)').run(note.id,book.id,JSON.stringify(note));this.indexAnnotations(book);}
        }else if(this.db.prepare('SELECT 1 FROM annotations WHERE book_id=? LIMIT 1').get(book.id)){warnings.push({code:'USING_CACHE',message:'Previously saved annotations are being used for a book whose config is unavailable.'});}
      }
      for(const id of read.deleted_annotation_ids){const note=this.getAnnotation(id);if(note){this.db.prepare('DELETE FROM annotations WHERE id=?').run(id);const book=this.getBook(note.book_id);if(book)this.indexAnnotations(book);dirty=true;}}
      if(notes.some(n=>!incoming.has(n.book_id)&&!this.getBook(n.book_id)))warnings.push({code:'ORPHAN_ANNOTATION',message:'Some annotations have no current catalogue entry and were not indexed.'});
      this.setMeta('checkpoint',read.checkpoint);this.setMeta('refreshed_at',read.refreshed_at);this.setMeta('warnings',unique(warnings));this.setMeta('source_coverage',read.coverage);this.setMeta('last_error',null);if(dirty)this.bump();
    });
  }
  replaceContent(book_id:string,content:ExtractedBook):void{
    this.transaction(()=>{const book=this.getBook(book_id);if(!book)throw new DomainError('CONTENT_UNAVAILABLE','Book is no longer in the catalogue.');
      if(content.passages.some(p=>p.book_id!==book_id||p.revision!==content.revision)||content.structure.some(s=>s.book_id!==book_id||s.revision!==content.revision))throw new DomainError('INDEX_UNAVAILABLE','Extracted content identity does not match its book.');
      this.removeEvidence(book_id,['book_text']);this.db.prepare('INSERT INTO contents(book_id,revision,data) VALUES (?,?,?) ON CONFLICT(book_id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(book_id,content.revision,JSON.stringify(content));for(const passage of content.passages)this.insertEvidence(passage);
      book.revision=content.revision;book.availability.index=content.passages.length?'ready':'unsupported';this.db.prepare('UPDATE books SET data=? WHERE id=?').run(JSON.stringify(book),book_id);this.bump();});
  }
  markContentError(book_id:string,error:DomainError):void{const book=this.getBook(book_id);if(!book)return;book.availability.index='failed';this.transaction(()=>{this.db.prepare('UPDATE books SET data=? WHERE id=?').run(JSON.stringify(book),book_id);this.setMeta('warnings',unique([...this.warnings(),{code:error.code,message:error.message}]));this.bump();});}
  recordRefreshFailure(error:DomainError):void{this.transaction(()=>{this.setMeta('last_error',error.message);this.setMeta('warnings',unique([...this.warnings(),{code:'REFRESH_FAILED',message:error.message},{code:'USING_CACHE',message:'The last saved source snapshot is being used.'}]));});}
  rebuildSearch():void{this.transaction(()=>{for(const book of this.allBooks())this.indexAnnotations(book);this.db.exec('DELETE FROM search_fts');for(const row of this.db.prepare('SELECT data FROM evidence').iterate()){const p=JSON.parse(String(row.data)) as Passage;this.db.prepare('INSERT INTO search_fts(id,book_id,source_kind,text) VALUES (?,?,?,?)').run(p.passage_id,p.book_id,p.source_kind,p.text);}this.bump();});}
  private paginate<T>(items:T[],limit:number,cursor:string|null,key:string):Page<T>{const offset=readCursor(cursor,this.generation(),key);return {items:items.slice(offset,offset+limit),next_cursor:items.length>offset+limit?writeCursor(this.generation(),key,offset+limit):null};}
  listBooks(input:Inputs['list_books']):Outputs['list_books']{return this.paginate(this.allBooks().filter(b=>matchesBook(b,input.filters)),input.limit,input.cursor,cursorKey({kind:'books',filters:input.filters,limit:input.limit}));}
  listAnnotations(input:Inputs['list_annotations']):Outputs['list_annotations']{
    const notes=this.db.prepare('SELECT data FROM annotations WHERE book_id=? ORDER BY id').all(input.book_id).map(r=>AnnotationSchema.parse(JSON.parse(String(r.data)))).filter(n=>(!input.types||input.types.includes(n.kind))&&(!input.colors||(n.color!==null&&input.colors.includes(n.color)))&&(!input.created_after||(n.created_at!==null&&n.created_at>=input.created_after))&&(!input.created_before||(n.created_at!==null&&n.created_at<=input.created_before))).map(n=>({...n,ink:null}));
    return this.paginate(notes,input.limit,input.cursor,cursorKey({...input,cursor:null,kind:'annotations'}));
  }
  getStructure(book_id:string,input:{limit:number;cursor:string|null}):Page<StructureItem>{return this.paginate(this.getContent(book_id)?.structure??[],input.limit,input.cursor,cursorKey({kind:'structure',book_id,limit:input.limit}));}
  async search(input:Inputs['search_library'],_semantic:QueryEmbedding|null):Promise<Outputs['search_library']>{
    if(input.mode==='semantic')throw new DomainError('CAPABILITY_UNAVAILABLE','Local semantic search is not configured.');
    const query=keywordQuery(input.query),books=new Map(this.allBooks().filter(b=>matchesBook(b,input.filters)).map(b=>[b.id,b]));const targets=input.targets.map(t=>t==='quotes'?'quote':t==='notes'?'note':'book_text');
    const key=cursorKey({...input,cursor:null,kind:'search'}),offset=readCursor(input.cursor,this.generation(),key);const items:Outputs['search_library']['items']=[];
    if(query&&books.size){const rows=this.db.prepare('SELECT e.data,bm25(search_fts) AS rank FROM search_fts JOIN evidence e ON e.id=search_fts.id WHERE search_fts MATCH ? AND e.book_id IN (SELECT value FROM json_each(?)) AND e.source_kind IN (SELECT value FROM json_each(?)) ORDER BY rank,e.id').iterate(query,JSON.stringify([...books.keys()]),JSON.stringify(targets));
      let skipped=0;for(const row of rows){if(skipped++<offset)continue;const p=JSON.parse(String(row.data)) as Passage,book=books.get(p.book_id)!;const term=input.query.match(/[\p{L}\p{N}_]+/u)?.[0]??'';const at=Math.max(0,p.text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())-80);items.push({evidence:{...p,title:book.title,author:book.author,text:p.text.slice(at,at+LIMITS.excerpt)},score:-Number(row.rank)});if(items.length>input.limit)break;}
    }
    return {items:items.slice(0,input.limit),next_cursor:items.length>input.limit?writeCursor(this.generation(),key,offset+input.limit):null,requested_mode:input.mode,used_mode:'keyword'};
  }
  status():Outputs['library_status']{const books=this.allBooks();const formats:Record<string,number>={};for(const b of books)formats[b.format]=(formats[b.format]??0)+1;const indexed=books.filter(b=>b.availability.index==='ready').length;return {known_books:books.length,annotations_available:books.filter(b=>b.availability.annotations==='available').length,text_indexed:indexed,extraction_failed:books.filter(b=>b.availability.index==='failed').length,unavailable_files:books.filter(b=>b.availability.file==='unavailable').length,unindexed_books:books.length-indexed,formats,capabilities:{semantic:false},last_refresh_error:this.lastError()};}
  coverage(targets:string[]=['book_text','quotes','notes']):Meta['coverage']{const books=this.allBooks();const covered=books.filter(b=>(!targets.includes('book_text')||b.availability.index==='ready')&&(!targets.some(t=>t==='quotes'||t==='notes')||b.availability.annotations==='available')).length;return {scope:'configured_source',known_books:books.length,covered_books:covered,completeness:this.warnings().length||covered<books.length?'partial':this.hasSnapshot()?'complete':'unknown'};}
  close():void{this.db.close();}
}
export function openIndex(config:CacheConfig,source_id:string):IndexStore{return new IndexStore(config,source_id);}
