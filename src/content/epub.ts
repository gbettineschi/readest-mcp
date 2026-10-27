import yauzl,{type Entry,type ZipFile} from 'yauzl';
import path from 'node:path';
import {XMLParser} from 'fast-xml-parser';
import {parseHTML} from 'linkedom';
import type {Readable} from 'node:stream';
import {blankLocation,scopedId,type Book,type ExtractedBook,type StructureItem,type Passage} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import {LIMITS} from '../limits.js';
const array=(x:any):any[]=>x===undefined||x===null?[]:Array.isArray(x)?x:[x];
const xml=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',removeNSPrefix:true,processEntities:false});
function href(base:string,relative:string):string{
  if(/^[a-z][a-z0-9+.-]*:/i.test(relative)||relative.startsWith('/')||relative.includes('\\'))throw new DomainError('UNSUPPORTED_CONTENT','EPUB references must stay inside the archive.');
  let decoded:string;try{decoded=decodeURIComponent(relative.split('?')[0]!);}catch{throw new DomainError('UNSUPPORTED_CONTENT','EPUB contains an invalid resource path.');}
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(base),decoded));
  if(resolved.startsWith('../')||resolved.startsWith('/')||resolved.includes('\0')||resolved.includes('\\'))throw new DomainError('UNSUPPORTED_CONTENT','EPUB resource escapes its archive.');return resolved;
}
async function archive(bytes:Buffer):Promise<{zip:ZipFile;entries:Map<string,Entry>;read:(name:string)=>Promise<string>}>{
  const zip=await new Promise<ZipFile>((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value!)));
  const entries=new Map<string,Entry>();let total=0,consumed=0;
  try{await new Promise<void>((resolve,reject)=>{
    zip.on('error',reject);zip.on('end',resolve);zip.on('entry',(entry:Entry)=>{
      total+=entry.uncompressedSize;if(entries.size>=LIMITS.archiveEntries||total>LIMITS.expandedBytes){reject(new DomainError('LIMIT_EXCEEDED','EPUB archive exceeds extraction limits.'));zip.close();return;}
      if(entry.generalPurposeBitFlag&1){reject(new DomainError('UNSUPPORTED_CONTENT','Encrypted EPUB archives are not supported.'));zip.close();return;}
      if(entries.has(entry.fileName)){reject(new DomainError('UNSUPPORTED_CONTENT','EPUB has ambiguous duplicate resource names.'));zip.close();return;}
      entries.set(entry.fileName,entry);zip.readEntry();
    });zip.readEntry();
  });}catch(error){zip.close();throw error;}
  return {zip,entries,read:async(name:string)=>{
    const entry=entries.get(name);if(!entry)throw new DomainError('EXTRACTION_FAILED','A required EPUB resource is missing.');
    const stream=await new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream!)));
    const chunks:Buffer[]=[];for await(const raw of stream){const chunk=Buffer.from(raw);consumed+=chunk.length;if(consumed>LIMITS.expandedBytes){stream.destroy?.();throw new DomainError('LIMIT_EXCEEDED','EPUB decompression exceeds its limit.');}chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
  }};
}
interface Nav {key:string;label:string;parent:string|null;}
export async function extractEpub(book:Book,bytes:Buffer,revision:string):Promise<ExtractedBook>{
  const arc=await archive(bytes);
  try{
    const container=xml.parse(await arc.read('META-INF/container.xml'));
    const rootfile=array(container.container?.rootfiles?.rootfile)[0];if(typeof rootfile?.['full-path']!=='string')throw new DomainError('EXTRACTION_FAILED','EPUB package location is missing.');
    const packagePath=href('container.xml',rootfile['full-path']);const opf=xml.parse(await arc.read(packagePath)).package;
    const manifest=new Map<string,any>(array(opf?.manifest?.item).map(i=>[String(i.id),i]));
    const spine=array(opf?.spine?.itemref).map(r=>manifest.get(String(r.idref))).filter(Boolean);
    if(!spine.length)throw new DomainError('EXTRACTION_FAILED','EPUB reading order is missing.');
    const nav:Nav[]=[];
    const add=(key:string,label:string,parent:string|null)=>{if(!nav.some(n=>n.key===key))nav.push({key,label:label.trim(),parent:parent===key?null:parent});};
    const navItem=[...manifest.values()].find(i=>String(i.properties??'').split(/\s+/).includes('nav'));
    if(navItem){
      const file=href(packagePath,String(navItem.href)),doc=parseHTML(await arc.read(file)).document as unknown as Document;
      const section=Array.from(doc.querySelectorAll('nav')).find(n=>(n.getAttribute('epub:type')??'').split(/\s+/).includes('toc')||n.getAttribute('role')==='doc-toc')??doc.querySelector('nav');
      const walk=(list:Element,parent:string|null)=>{for(const li of Array.from(list.children)){if(li.localName!=='li')continue;const a=Array.from(li.children).find(e=>e.localName==='a');let key=parent;if(a?.getAttribute('href')){key=href(file,a.getAttribute('href')!);add(key,a.textContent??'',parent);}for(const child of Array.from(li.children).filter(e=>e.localName==='ol'||e.localName==='ul'))walk(child,key);}};
      if(section)for(const list of Array.from(section.children).filter(e=>e.localName==='ol'||e.localName==='ul'))walk(list,null);
    }else{
      const ncx=manifest.get(String(opf?.spine?.toc))??[...manifest.values()].find(i=>i['media-type']==='application/x-dtbncx+xml');
      if(ncx){const file=href(packagePath,String(ncx.href)),parsed=xml.parse(await arc.read(file));const walk=(nodes:any,parent:string|null)=>{for(const node of array(nodes)){let key=parent;if(node.content?.src){key=href(file,String(node.content.src));add(key,String(node.navLabel?.text??''),parent);}walk(node.navPoint,key);}};walk(parsed.ncx?.navMap?.navPoint,null);}
    }
    const structure:StructureItem[]=nav.map((n,i)=>({id:scopedId('s',book.id,revision+'\0'+n.key),book_id:book.id,revision,kind:'chapter',label:n.label||n.key,parent_id:n.parent?scopedId('s',book.id,revision+'\0'+n.parent):null,order:i,href:n.key,page:null}));
    const byHref=new Map(structure.map(s=>[s.href!,s]));const passages:Passage[]=[];
    const encrypted=arc.entries.has('META-INF/encryption.xml')?await arc.read('META-INF/encryption.xml'):'';
    for(let spineIndex=0;spineIndex<spine.length;spineIndex++){
      const item=spine[spineIndex]!;if(String(item.properties??'').split(/\s+/).includes('nav'))continue;
      const file=href(packagePath,String(item.href));
      if(encrypted&&encrypted.includes(file)&&!encrypted.includes('http://www.idpf.org/2008/embedding'))throw new DomainError('UNSUPPORTED_CONTENT','DRM-protected reading content is not supported.');
      const doc=parseHTML(await arc.read(file)).document as unknown as Document;
      let current=byHref.get(file);
      if(!current){current={id:scopedId('s',book.id,revision+'\0'+file),book_id:book.id,revision,kind:'chapter',label:doc.querySelector('h1')?.textContent?.trim()||file,parent_id:null,order:structure.length,href:file,page:null};structure.push(current);byHref.set(file,current);}
      let buffer='',paragraph=0,offset=0;
      const flush=()=>{const text=buffer.replace(/\s+/g,' ').trim();buffer='';if(!text)return;paragraph++;const location={...blankLocation('epub'),chapter:current!.label,href:file,spine_index:spineIndex,paragraph,start:offset,end:offset+text.length};passages.push({passage_id:scopedId('p',book.id,revision+'\0'+file+'\0'+paragraph),book_id:book.id,revision,title:book.title,author:book.author,source_kind:'book_text',text,location,structure_id:current!.id,order:passages.length});offset+=text.length+1;};
      const blocks=new Set(['p','div','section','article','h1','h2','h3','h4','h5','h6','li','blockquote','pre','td','th','figcaption']);
      const walk=(node:Node)=>{
        if(node.nodeType===3){buffer+=node.textContent??'';return;}if(node.nodeType!==1)return;const element=node as Element,tag=element.localName.toLowerCase();if(['script','style','nav','head','noscript'].includes(tag))return;
        const anchor=element.getAttribute('id'),target=anchor?byHref.get(file+'#'+anchor):undefined;if(target){flush();current=target;}
        if(blocks.has(tag))flush();if(tag==='br')buffer+=' ';for(const child of Array.from(node.childNodes))walk(child);if(blocks.has(tag))flush();
      };
      walk(doc.body);flush();
    }
    return {revision,structure,passages,warnings:[],pages:[]};
  }finally{arc.zip.close();}
}
