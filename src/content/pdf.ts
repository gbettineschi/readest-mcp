import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {blankLocation,scopedId,type Book,type ExtractedBook,type Passage,type StructureItem} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
const require=createRequire(import.meta.url);
export async function extractPdf(book:Book,bytes:Buffer,revision:string):Promise<ExtractedBook>{
  // PDF.js requires a forward trailing slash even for Node filesystem paths on Windows.
  const fonts=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/';
  const task=getDocument({data:new Uint8Array(bytes),verbosity:0,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,standardFontDataUrl:fonts,stopAtErrors:true});
  let doc;try{doc=await task.promise;}catch(error){await task.destroy();if((error as Error).name==='PasswordException')throw new DomainError('PASSWORD_PROTECTED','Password-protected PDFs are not supported.');throw new DomainError('EXTRACTION_FAILED','PDF could not be parsed.');}
  const structure:StructureItem[]=[],passages:Passage[]=[],pages:ExtractedBook['pages']=[];const labels=await doc.getPageLabels().catch(()=>null);
  try{for(let page=1;page<=doc.numPages;page++){
    const label=labels?.[page-1]??null,id=scopedId('s',book.id,revision+'\0page\0'+page);structure.push({id,book_id:book.id,revision,kind:'page',label:'PDF page '+page+(label?' ('+label+')':''),parent_id:null,order:page-1,href:null,page});
    try{const content=await (await doc.getPage(page)).getTextContent();const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').replace(/[ \t]+/g,' ').trim();pages.push({page,status:text?'text':'empty'});if(text)passages.push({passage_id:scopedId('p',book.id,revision+'\0page\0'+page),book_id:book.id,revision,title:book.title,author:book.author,source_kind:'book_text',text,location:{...blankLocation('pdf'),page,page_label:label,start:0,end:text.length},structure_id:id,order:page-1});}
    catch{pages.push({page,status:'failed'});}
  }}finally{await task.destroy();}
  const gaps=pages.some(p=>p.status!=='text');return {revision,structure,passages,pages,warnings:!passages.length?[{code:'OCR_REQUIRED',message:'PDF has no extractable text. Scanned pages require OCR.'}]:gaps?[{code:'TEXT_GAPS',message:'Some PDF pages have no extractable text or could not be read.'}]:[]};
}
