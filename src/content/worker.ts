import {parentPort,workerData} from 'node:worker_threads';
import {extractEpub} from './epub.js';
import {extractPdf} from './pdf.js';
import {DomainError} from '../domain/result.js';
if(!parentPort)throw new Error('Extraction worker requires its parent.');
try{const bytes=Buffer.from(workerData.bytes);const result=workerData.book.format==='EPUB'?await extractEpub(workerData.book,bytes,workerData.revision):await extractPdf(workerData.book,bytes,workerData.revision);parentPort.postMessage({ok:true,result});}
catch(error){parentPort.postMessage({ok:false,code:error instanceof DomainError?error.code:'EXTRACTION_FAILED',message:error instanceof DomainError?error.message:'Book could not be extracted.'});}
