import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {blankLocation,scopedId,hash,type Book,type ExtractedBook,type Passage,type StructureItem} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
import type {OcrConfig} from '../config.js';
import {recognizePage,pdfExtractionKey} from './ocr.js';
const require=createRequire(import.meta.url);
export async function extractPdf(book:Book,bytes:Buffer,revision:string,ocr?:OcrConfig):Promise<ExtractedBook>{
  // PDF.js requires a forward trailing slash even for Node filesystem paths on Windows.
  const fonts=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/';
  const task=getDocument({data:new Uint8Array(bytes),verbosity:0,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,standardFontDataUrl:fonts,stopAtErrors:true});
  let doc;try{doc=await task.promise;}catch(error){await task.destroy();if((error as Error).name==='PasswordException')throw new DomainError('PASSWORD_PROTECTED','Password-protected PDFs are not supported.');throw new DomainError('EXTRACTION_FAILED','PDF could not be parsed.');}
  const structure:StructureItem[]=[],passages:Passage[]=[],pages:ExtractedBook['pages']=[],warnings:ExtractedBook['warnings']=[];const labels=await doc.getPageLabels().catch(()=>null),ocrDeadline=Date.now()+30_000;let attempts=0;
  try{for(let page=1;page<=doc.numPages;page++){
    const label=labels?.[page-1]??null,key=revision+'\0'+pdfExtractionKey(ocr)+'\0page\0'+page,item:StructureItem={id:scopedId('s',book.id,key),book_id:book.id,revision,kind:'page',label:'PDF page '+page+(label?' ('+label+')':''),parent_id:null,order:page-1,href:null,page};structure.push(item);
    try{
      const pdfPage=await doc.getPage(page),content=await pdfPage.getTextContent();let text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').replace(/[ \t]+/g,' ').trim(),recognized=false;
      const blank=!text&&(await pdfPage.getOperatorList()).fnArray.length===0;
      if(!text&&!blank&&ocr?.enabled){
        if(attempts>=8||Date.now()>=ocrDeadline)warnings.push({code:'OCR_LIMIT',message:'Local OCR reached its per-book limit (8 pages / 30 seconds). Some image pages remain unindexed.'});
        else{attempts++;try{text=await recognizePage(pdfPage,ocr,Math.min(8000,Math.max(1,ocrDeadline-Date.now())));recognized=Boolean(text);}catch(error){const e=error as DomainError;warnings.push({code:e.code,message:e.message});}}
      }
      pages.push({page,status:text?recognized?'ocr':'text':blank?'blank':'empty'});
      // Reference IDs also bind the extracted text, including OCR output. The revision remains the source-file fingerprint.
      const identity=key+'\0'+hash(text);item.id=scopedId('s',book.id,identity);
      if(text)passages.push({passage_id:scopedId('p',book.id,identity),book_id:book.id,revision,title:book.title,author:book.author,source_kind:'book_text',text,...recognized?{text_origin:'ocr' as const}:{},location:{...blankLocation('pdf'),page,page_label:label,start:0,end:text.length},structure_id:item.id,order:page-1});
      pdfPage.cleanup();
    }
    catch{pages.push({page,status:'failed'});}
  }}finally{await task.destroy();}
  const gaps=pages.some(p=>p.status==='empty'||p.status==='failed');
  if(gaps)warnings.push(!passages.length?{code:'OCR_REQUIRED',message:'PDF has no extractable text. Image pages require OCR.'}:{code:'TEXT_GAPS',message:'Some PDF pages have no extractable text or could not be read.'});
  if(pages.some(p=>p.status==='ocr'))warnings.push({code:'OCR_APPLIED',message:'Some PDF text was recognized locally with OCR and may contain errors; check the cited page.'});
  return {revision,structure,passages,pages,warnings:[...new Map(warnings.map(w=>[w.code,w])).values()]};
}
