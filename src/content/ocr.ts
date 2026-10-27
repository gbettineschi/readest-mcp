import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {parentPort} from 'node:worker_threads';
import type {PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {OcrConfig} from '../config.js';
import {DomainError} from '../domain/result.js';
import {hash} from '../domain/model.js';
const require=createRequire(import.meta.url);
export const pdfExtractionKey=(ocr?:OcrConfig)=>hash(JSON.stringify(['pdf-v2',ocr?.enabled?ocr:null]));

/** Local, optional OCR. Pixels and recognized text never leave this process tree. */
export async function recognizePage(page:PDFPageProxy,config:OcrConfig,timeout:number):Promise<string>{
  let canvas;
  try{
    const {createCanvas}=createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
    const original=page.getViewport({scale:1}),scale=Math.min(3,Math.sqrt(4_000_000/(original.width*original.height))),viewport=page.getViewport({scale});
    if(!Number.isFinite(scale)||scale<=0)throw new Error('Invalid page size');
    canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;
    const png:Buffer=canvas.toBuffer('image/png');
    return await new Promise<string>((resolve,reject)=>{
      const child=execFile(config.command,['stdin','stdout','-l',config.languages.join('+'),'--dpi',String(Math.round(72*scale))],{timeout,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,OMP_THREAD_LIMIT:'1'}},(error,stdout)=>{
        if(child.pid)parentPort?.postMessage({type:'ocr-stop',pid:child.pid});
        if(error){reject(new DomainError((error as NodeJS.ErrnoException).code==='ENOENT'?'OCR_UNAVAILABLE':'OCR_FAILED','Local OCR could not read a page. Check Tesseract and its configured language data.'));return;}
        resolve(stdout.replaceAll('\f','').trim());
      });
      if(child.pid)parentPort?.postMessage({type:'ocr-start',pid:child.pid});
      child.stdin?.on('error',()=>{});child.stdin?.end(png);
    });
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('OCR_UNAVAILABLE','Local OCR rendering is unavailable. Install the optional canvas runtime.');}
  finally{if(canvas){canvas.width=1;canvas.height=1;}}
}
