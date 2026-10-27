import {afterEach,expect,it,vi} from 'vitest';
import {extractPdf} from '../dist/content/pdf.js';
import {normalizeBook} from '../dist/sources/local-format.js';
const state=vi.hoisted(()=>({cancelled:false}));
// PDF.js is the external rendering boundary; a stalled image render must not swallow native evidence.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>({getDocument:()=>({promise:Promise.resolve({numPages:3,getPageLabels:async()=>null,getPage:async(page:number)=>({
 getTextContent:async()=>({items:page===2?[]:[{str:page===1?'First native page.':'Last native page.',hasEOL:true}]}),
 getOperatorList:async()=>({fnArray:[85]}),getViewport:()=>({width:500,height:700}),
 render:()=>{let reject:(e:Error)=>void;return {promise:new Promise((_resolve,fail)=>{reject=fail;}),cancel:()=>{state.cancelled=true;reject(new Error('Render cancelled'));}};},cleanup:()=>{}
})}),destroy:async()=>{}})}));
afterEach(()=>{vi.useRealTimers();state.cancelled=false;});
it('bounds stalled OCR rendering and keeps native pages before and after it',async()=>{
 vi.useFakeTimers();const book=normalizeBook({hash:'a'.repeat(32),format:'PDF',title:'Fixture',author:'Author'},{},'test-source');
 const result=extractPdf(book,Buffer.from('synthetic PDF.js boundary'),'source',{enabled:true,command:'unused-tesseract',languages:['eng']});
 await vi.advanceTimersByTimeAsync(8100);const content=await result;
 expect(content.passages.map(p=>p.text)).toEqual(['First native page.','Last native page.']);
 expect(content.pages).toEqual([{page:1,status:'text'},{page:2,status:'empty'},{page:3,status:'text'}]);
 expect(content.warnings.map(w=>w.code)).toContain('OCR_TIMEOUT');expect(content.warnings.map(w=>w.code)).toContain('TEXT_GAPS');expect(state.cancelled).toBe(true);
},5000);
