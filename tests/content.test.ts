import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {extractBook} from '../dist/content/extract.js';
import {bookFile,epub,pdf} from './helpers/books.js';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>fs.rm(d,{recursive:true,force:true})));});
async function directory(){const d=await fs.mkdtemp(path.join(os.tmpdir(),'readest-content-'));dirs.push(d);return d;}
describe('bounded EPUB/PDF extraction',()=>{
  it.each([2,3] as const)('reads EPUB %i spine order, Unicode and recursive navigation',async version=>{
    const input=await bookFile(await directory(),'EPUB',await epub(version)),before=await fs.readFile(input.file.path);const content=await extractBook(input.book,input.file);
    expect(content.passages.map(p=>p.text)).toEqual(['Decisioni','L’incertezza non impedisce una scelta ragionevole.','Second paragraph.','Further notes','Una nota: café.']);
    expect(content.structure.map(s=>s.label)).toEqual(['Decisions','Further notes']);expect(content.structure[1]?.parent_id).toBe(content.structure[0]?.id);
    expect(content.passages[1]?.location).toMatchObject({kind:'epub',href:'OPS/text/ch 1.xhtml',spine_index:0,paragraph:2,cfi:null});
    expect(content.revision).toBe(input.file.revision);expect(await fs.readFile(input.file.path)).toEqual(before);
  });
  it('distinguishes physical PDF pages, printed labels and missing text pages',async()=>{
    const input=await bookFile(await directory(),'PDF',await pdf(['First page about uncertainty.',null]));const result=await extractBook(input.book,input.file);
    expect(result.passages[0]).toMatchObject({text:'First page about uncertainty.',location:{kind:'pdf',page:1,page_label:'i'}});
    expect(result.structure[1]).toMatchObject({page:2,label:'PDF page 2 (21)'});expect(result.pages).toEqual([{page:1,status:'text'},{page:2,status:'empty'}]);expect(result.warnings.some(w=>w.code==='TEXT_GAPS')).toBe(true);
  });
  it('reports PDFs without text rather than generating an empty passage',async()=>{
    const input=await bookFile(await directory(),'PDF',await pdf([null]));const result=await extractBook(input.book,input.file);expect(result.passages).toEqual([]);expect(result.warnings.some(w=>w.code==='OCR_REQUIRED')).toBe(true);
  });
  it('rejects corrupted books and mismatched snapshots without invented content',async()=>{
    const input=await bookFile(await directory(),'PDF',Buffer.from('%PDF-1.7 incomplete'));
    await expect(extractBook(input.book,input.file)).rejects.toMatchObject({code:'EXTRACTION_FAILED'});
    const valid=await bookFile(await directory(),'EPUB',await epub());await fs.writeFile(valid.file.path,'changed bytes');await expect(extractBook(valid.book,valid.file)).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  });
  it('rejects an archive that declares decompressed content beyond the limit',async()=>{
    const bytes=await epub();const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));expect(central).toBeGreaterThan(0);bytes.writeUInt32LE(600*1024*1024,central+24);
    const input=await bookFile(await directory(),'EPUB',bytes);await expect(extractBook(input.book,input.file)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
  });
  it('reports a password-protected PDF without prompting or inventing text',async()=>{
    const bytes=await fs.readFile(new URL('./fixtures/password.pdf',import.meta.url));const input=await bookFile(await directory(),'PDF',bytes);
    await expect(extractBook(input.book,input.file)).rejects.toMatchObject({code:'PASSWORD_PROTECTED'});
  });
});
