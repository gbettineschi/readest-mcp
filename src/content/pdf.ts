import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {blankLocation,scopedId,hash,type Book,type ExtractedBook,type Passage,type StructureItem} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import type {OcrConfig} from '../config.js';
import {recognizePage,pdfExtractionKey} from './ocr.js';
import {LIMITS} from '../limits.js';
const require=createRequire(import.meta.url);
export async function extractPdf(book:Book,bytes:Buffer,revision:string,ocr?:OcrConfig):Promise<ExtractedBook>{
  const started=Date.now();
  // PDF.js requires a forward trailing slash even for Node filesystem paths on Windows.
  const fonts=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/';
  const task=getDocument({data:new Uint8Array(bytes),verbosity:0,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,standardFontDataUrl:fonts,stopAtErrors:true});
  let doc;try{doc=await task.promise;}catch(error){await task.destroy();if((error as Error).name==='PasswordException')throw new DomainError('PASSWORD_PROTECTED','Password-protected PDFs are not supported.');throw new DomainError('EXTRACTION_FAILED','PDF could not be parsed.');}
  const structure:StructureItem[]=[],passages:Passage[]=[],pages:ExtractedBook['pages']=[],warnings:ExtractedBook['warnings']=[];const labels=await doc.getPageLabels().catch(()=>null),profile=pdfExtractionKey(ocr);
  function saveText(page:number,text:string,recognized=false){
    const item=structure[page-1]!,identity=revision+'\0'+profile+'\0page\0'+page+'\0'+hash(text);item.id=scopedId('s',book.id,identity);
    // IDs bind the extracted text; revision remains the source-file fingerprint used by the file cache.
    if(text)passages.push({passage_id:scopedId('p',book.id,identity),book_id:book.id,revision,title:book.title,author:book.author,source_kind:'book_text',text,...recognized?{text_origin:'ocr' as const}:{},location:{...blankLocation('pdf'),page,page_label:labels?.[page-1]??null,start:0,end:text.length},structure_id:item.id,order:page-1});
  }
  try{for(let page=1;page<=doc.numPages;page++){
    const label=labels?.[page-1]??null;structure.push({id:scopedId('s',book.id,revision+'\0'+profile+'\0page\0'+page),book_id:book.id,revision,kind:'page',label:'PDF page '+page+(label?' ('+label+')':''),parent_id:null,order:page-1,href:null,page});
    try{
      const pdfPage=await doc.getPage(page),content=await pdfPage.getTextContent(),text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').replace(/[ \t]+/g,' ').trim();
      const blank=!text&&(await pdfPage.getOperatorList()).fnArray.length===0;
      pages.push({page,status:text?'text':blank?'blank':'empty'});saveText(page,text);pdfPage.cleanup();
    }
    catch{pages.push({page,status:'failed'});}
  }
    // Finish native extraction first. Optional OCR uses only the remaining worker budget.
    if(ocr?.enabled){const deadline=Math.min(Date.now()+30_000,started+LIMITS.extractionMs-5000);let attempts=0;
      for(const entry of pages.filter(p=>p.status==='empty')){
        if(attempts>=8||Date.now()>=deadline){warnings.push({code:'OCR_LIMIT',message:'Local OCR reached its per-book page/time budget. Some image pages remain unindexed.'});break;}
        attempts++;try{const page=await doc.getPage(entry.page),text=await recognizePage(page,ocr,Math.min(8000,Math.max(1,deadline-Date.now())));if(text){entry.status='ocr';saveText(entry.page,text,true);}page.cleanup();}
        catch(error){const e=error as DomainError;warnings.push({code:e.code,message:e.message});}
      }
    }
  }finally{await task.destroy();}
  const gaps=pages.some(p=>p.status==='empty'||p.status==='failed');
  if(gaps)warnings.push(!passages.length?{code:'OCR_REQUIRED',message:'PDF has no extractable text. Image pages require OCR.'}:{code:'TEXT_GAPS',message:'Some PDF pages have no extractable text or could not be read.'});
  if(pages.some(p=>p.status==='ocr'))warnings.push({code:'OCR_APPLIED',message:'Some PDF text was recognized locally with OCR and may contain errors; check the cited page.'});
  return {revision,structure,passages:passages.sort((a,b)=>a.order-b.order),pages,warnings:[...new Map(warnings.map(w=>[w.code,w])).values()]};
}
