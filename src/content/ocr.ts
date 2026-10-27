import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {parentPort} from 'node:worker_threads';
import type {PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {OcrConfig} from '../config.js';
import {DomainError} from '../domain/result.js';
import {hash} from '../domain/model.js';
const require=createRequire(import.meta.url);
export const pdfExtractionKey=(ocr?:OcrConfig)=>hash(JSON.stringify(['pdf-v3',ocr?.enabled?ocr:null]));

/** Local, optional OCR. Pixels and recognized text never leave this process tree. */
export async function recognizePage(page:PDFPageProxy,config:OcrConfig,timeout:number):Promise<string>{
  let canvas:{width:number;height:number}|undefined,render:ReturnType<PDFPageProxy['render']>|undefined,child:ReturnType<typeof execFile>|undefined;
  const started=Date.now(),timeoutError=()=>new DomainError('OCR_TIMEOUT','Local OCR exceeded its page time budget; the page remains unindexed.');
  let timer:ReturnType<typeof setTimeout>;
  const expired=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{reject(timeoutError());render?.cancel();child?.kill();},timeout);});
  try{
    return await Promise.race([expired,(async()=>{
    const {createCanvas}=createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
    const original=page.getViewport({scale:1}),scale=Math.min(3,Math.sqrt(4_000_000/(original.width*original.height))),viewport=page.getViewport({scale});
    if(!Number.isFinite(scale)||scale<=0)throw new Error('Invalid page size');
    const surface=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));canvas=surface;
    render=page.render({canvas:surface,canvasContext:surface.getContext('2d'),viewport});await render.promise;
    if(Date.now()-started>=timeout)throw timeoutError();
    const png:Buffer=surface.toBuffer('image/png');
    const remaining=timeout-(Date.now()-started);if(remaining<=0)throw timeoutError();
    return await new Promise<string>((resolve,reject)=>{
      child=execFile(config.command,['stdin','stdout','-l',config.languages.join('+'),'--dpi',String(Math.round(72*scale))],{timeout:remaining,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,OMP_THREAD_LIMIT:'1'}},(error,stdout)=>{
        if(child?.pid)parentPort?.postMessage({type:'ocr-stop',pid:child.pid});
        if(Date.now()-started>=timeout){reject(timeoutError());return;}
        if(error){reject(new DomainError((error as NodeJS.ErrnoException).code==='ENOENT'?'OCR_UNAVAILABLE':'OCR_FAILED','Local OCR could not read a page. Check Tesseract and its configured language data.'));return;}
        resolve(stdout.replaceAll('\f','').trim());
      });
      if(child.pid)parentPort?.postMessage({type:'ocr-start',pid:child.pid});
      child.stdin?.on('error',()=>{});child.stdin?.end(png);
    });
    })()]);
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('OCR_UNAVAILABLE','Local OCR rendering is unavailable. Install the optional canvas runtime.');}
  finally{clearTimeout(timer!);if(canvas){canvas.width=1;canvas.height=1;}}
}
