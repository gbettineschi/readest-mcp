import {hash,scopedId,type Passage} from '../domain/model.js';

/** Derived semantic documents. Original paragraphs remain the lexical/reference records. */
export function retrievalUnits(passages:Passage[]):Passage[]{
  const groups:Passage[][]=[];
  for(const p of passages){
    const group=groups.at(-1),last=group?.at(-1);
    const adjacent=last&&p.source_kind==='book_text'&&last.source_kind==='book_text'&&p.book_id===last.book_id&&p.revision===last.revision&&
      p.location.kind==='epub'&&last.location.kind==='epub'&&p.structure_id&&p.structure_id===last.structure_id&&
      p.location.href!==null&&p.location.href===last.location.href&&p.location.spine_index!==null&&p.location.spine_index===last.location.spine_index&&
      p.location.start===last.location.end+1&&p.location.end-p.location.start===p.text.length&&last.location.end-last.location.start===last.text.length;
    if(adjacent)group!.push(p);else groups.push([p]);
  }
  return groups.map(group=>{
    const first=group[0]!,last=group.at(-1)!;if(group.length===1)return first;
    const text=group.map(p=>p.text).join('\n');
    return {...first,retrieval_unit:true,passage_id:scopedId('p',first.book_id,JSON.stringify(['semantic-section-v1',first.revision,first.structure_id,first.location.start,last.location.end,hash(text)])),text,location:{...first.location,paragraph:null,end:last.location.end}};
  });
}
