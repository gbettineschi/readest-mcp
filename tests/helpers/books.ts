import fs from 'node:fs/promises';
import path from 'node:path';
import {ZipFile} from 'yazl';
import {PDFDocument,PDFName,StandardFonts} from 'pdf-lib';
import {hash} from '../../dist/domain/model.js';
import {normalizeBook} from '../../dist/sources/local-format.js';
export async function zip(entries:Record<string,string|Buffer>):Promise<Buffer>{
  const file=new ZipFile(),chunks:Buffer[]=[];const result=new Promise<Buffer>((resolve,reject)=>{file.outputStream.on('data',c=>chunks.push(c));file.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));file.outputStream.on('error',reject);});
  for(const [name,value]of Object.entries(entries))file.addBuffer(Buffer.isBuffer(value)?value:Buffer.from(value),name);file.end();return result;
}
export async function epub(version:2|3=3,body='L’incertezza non impedisce una scelta ragionevole.'):Promise<Buffer>{
  const entries:Record<string,string>={mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/package.opf':'<package version="'+version+'.0"><manifest><item id="a" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/><item id="b" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine></package>',
    'OPS/nav.xhtml':'<html><body><nav epub:type="toc"><ol><li><a href="text/ch%201.xhtml">Decisions</a><ol><li><a href="text/ch2.xhtml">Further notes</a></li></ol></li></ol></nav></body></html>',
    'OPS/toc.ncx':'<ncx><navMap><navPoint><navLabel><text>Decisions</text></navLabel><content src="text/ch%201.xhtml"/><navPoint><navLabel><text>Further notes</text></navLabel><content src="text/ch2.xhtml"/></navPoint></navPoint></navMap></ncx>',
    'OPS/text/ch 1.xhtml':'<html><head><title>Not main text</title><style>BAD_STYLE</style></head><body><h1>Decisioni</h1><p>'+body+'</p><script>BAD_SCRIPT</script><p>Second paragraph.</p></body></html>',
    'OPS/text/ch2.xhtml':'<html><body><h1>Further notes</h1><p>Una nota: café.</p></body></html>'};
  if(version===2)entries['OPS/package.opf']=entries['OPS/package.opf']!.replace(' properties="nav"','');return zip(entries);
}
export async function pdf(pages:(string|null)[]=['First page about uncertainty.','Second page.']):Promise<Buffer>{
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  for(const text of pages){const p=doc.addPage([500,700]);if(text!==null)p.drawText(text,{x:30,y:650,size:12,font});else p.drawRectangle({x:30,y:400,width:200,height:100});}
  doc.catalog.set(PDFName.of('PageLabels'),doc.context.obj({Nums:[0,{S:PDFName.of('r'),St:1},1,{S:PDFName.of('D'),St:21}]}));return Buffer.from(await doc.save());
}
export async function bookFile(dir:string,format:'EPUB'|'PDF',bytes:Buffer){const file=path.join(dir,'fixture.'+format.toLowerCase());await fs.writeFile(file,bytes);return {book:normalizeBook({hash:'a'.repeat(32),format,title:'Fixture book',author:'Fixture author'}, {},'test-source'),file:{status:'available' as const,path:file,revision:hash(bytes)}};}
