import fs from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {hash,type Book,type ExtractedBook} from '../domain/model.js';
import type {FileResolution,DocumentExtractor} from '../domain/source.js';
import {DomainError} from '../domain/result.js';
import {LIMITS} from '../limits.js';
import type {OcrConfig} from '../config.js';
import {pdfExtractionKey} from './ocr.js';
export interface ExtractionOptions {ocr?:OcrConfig;}
export function createDocumentExtractor(options:ExtractionOptions={}):DocumentExtractor{
  const cacheKey=(book:Book)=>book.format==='PDF'?pdfExtractionKey(options.ocr):undefined;
  return {cacheKey,async extract(book,file){return {...await extractBook(book,file,options),extraction_key:cacheKey(book)};}};
}
export async function extractBook(book:Book,file:FileResolution,options:ExtractionOptions={}):Promise<ExtractedBook>{
  if(file.status!=='available')throw new DomainError(file.code,file.message);
  if(!['EPUB','PDF'].includes(book.format))throw new DomainError('UNSUPPORTED_CONTENT','Only EPUB and PDF text extraction is supported.');
  const info=await fs.stat(file.path);if(info.size>LIMITS.sourceBytes)throw new DomainError('LIMIT_EXCEEDED','Book exceeds the extraction size limit.');
  const bytes=await fs.readFile(file.path);if(bytes.length>LIMITS.sourceBytes)throw new DomainError('LIMIT_EXCEEDED','Book exceeds the extraction size limit.');
  if(hash(bytes)!==file.revision)throw new DomainError('SOURCE_CHANGED','Book snapshot changed before extraction.');
  return new Promise((resolve,reject)=>{
    let settled=false;const children=new Set<number>(),worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{book,bytes,revision:file.revision,ocr:options.ocr},resourceLimits:{maxOldGenerationSizeMb:256},stdout:true,stderr:true});worker.stdout?.resume();worker.stderr?.resume();
    const finish=(error:DomainError|null,result?:ExtractedBook)=>{if(settled)return;settled=true;clearTimeout(timer);for(const pid of children)try{process.kill(pid);}catch{/* Already exited. */}void worker.terminate();if(error)reject(error);else resolve(result!);};
    const timer=setTimeout(()=>finish(new DomainError('EXTRACTION_TIMEOUT','Book extraction exceeded its time limit.')),LIMITS.extractionMs);timer.unref();
    worker.on('message',message=>{if(message.type==='ocr-start'){children.add(message.pid);return;}if(message.type==='ocr-stop'){children.delete(message.pid);return;}message.ok?finish(null,message.result):finish(new DomainError(message.code,message.message));});
    worker.on('error',()=>finish(new DomainError('EXTRACTION_FAILED','Book extraction worker failed.')));
    worker.on('exit',()=>{if(!settled)finish(new DomainError('EXTRACTION_FAILED','Book extraction ended before producing evidence.'));});
  });
}
