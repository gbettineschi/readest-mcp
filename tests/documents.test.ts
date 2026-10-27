import {expect,it} from 'vitest';
import {retrievalUnits} from '../dist/index/documents.js';
import {blankLocation,type Passage} from '../dist/domain/model.js';
const first:Passage={passage_id:'first',book_id:'b',revision:'r',title:'Book',author:'Author',source_kind:'book_text',text:'A',structure_id:'s',order:0,location:{...blankLocation('epub'),href:'one.xhtml',spine_index:0,paragraph:1,start:10,end:11}};
const second:Passage={...first,passage_id:'second',text:'B 😀.',order:1,location:{...first.location,paragraph:2,start:12,end:17}};
it('preserves Unicode and source offsets in a derived section without mutating original paragraphs',()=>{
 const units=retrievalUnits([first,second]);expect(units).toHaveLength(1);expect(units[0]).toMatchObject({text:'A\nB 😀.',retrieval_unit:true,location:{start:10,end:17,paragraph:null,href:'one.xhtml'}});expect(units[0]?.passage_id).not.toBe('first');expect(retrievalUnits([first,second])[0]?.passage_id).toBe(units[0]?.passage_id);expect(first.location.paragraph).toBe(1);expect(second.location.paragraph).toBe(2);
});
it.each([
 {...second,book_id:'other'}, {...second,revision:'other'}, {...second,structure_id:'other'},
 {...second,source_kind:'note' as const}, {...second,location:{...second.location,kind:'pdf' as const,page:2}},
 {...second,location:{...second.location,href:'other.xhtml'}}, {...second,location:{...second.location,spine_index:1}},
 {...second,location:{...second.location,start:13,end:18}}, {...second,location:{...second.location,end:100}}
])('keeps source, revision, section, target, format, resource and discontinuous ranges separate (%#)',other=>{
 const units=retrievalUnits([first,other]);expect(units.map(p=>p.passage_id)).toEqual(['first','second']);
});
