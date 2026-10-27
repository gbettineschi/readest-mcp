import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {extractBook} from '../dist/content/extract.js';
import {resolveReference,matchAnnotationContext} from '../dist/content/references.js';
import {normalizeAnnotation} from '../dist/sources/local-format.js';
import {bookFile,epub} from './helpers/books.js';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>fs.rm(d,{recursive:true,force:true})));});
async function content(body?:string){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'readest-reference-'));dirs.push(dir);const input=await bookFile(dir,'EPUB',await epub(3,body));return {...input,content:await extractBook(input.book,input.file)};}
it('resolves exact evidence and refuses a reference from a replaced edition',async()=>{
  const a=await content(),b=await content('A changed edition.');const p=a.content.passages[1]!;
  expect(resolveReference({passage_id:p.passage_id,revision:a.content.revision},a.content)).toMatchObject({text:'L’incertezza non impedisce una scelta ragionevole.',title:'Fixture book'});
  expect(()=>resolveReference({passage_id:p.passage_id,revision:a.content.revision},b.content)).toThrow(/revision|edition|stale/i);
});
it('keeps an annotation quote distinct from its comment and flags repeated matches',async()=>{
  const a=await content('Same quote. Same quote.');const note=normalizeAnnotation({id:'note',type:'annotation',text:'Same quote.',note:'my own idea'},a.book.id,'test-source')!;
  expect(matchAnnotationContext(note,a.content)).toMatchObject({status:'ambiguous',items:[]});
  const b=await content('An exact quote.');const exact={...note,quote:'An exact quote.'};expect(matchAnnotationContext(exact,b.content)).toMatchObject({status:'exact',items:[{source_kind:'book_text',text:'An exact quote.'}]});
});
