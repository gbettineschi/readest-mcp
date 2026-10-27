import type {Annotation,Evidence,EvidenceReference,ExtractedBook} from '../domain/model.js';
import {DomainError} from '../domain/result.js';
export function resolveReference(reference:EvidenceReference,content:ExtractedBook):Evidence{
  if(reference.revision!==content.revision)throw new DomainError('STALE_REFERENCE','Reference belongs to a different book revision or edition.');
  const passage=content.passages.find(p=>p.passage_id===reference.passage_id);if(!passage)throw new DomainError('STALE_REFERENCE','Passage is no longer available in this revision.');return passage;
}
export function matchAnnotationContext(annotation:Annotation,content:ExtractedBook):{status:'exact'|'ambiguous'|'unresolved';items:Evidence[]}{
  const quote=annotation.quote?.replace(/\s+/g,' ').trim();if(!quote)return {status:'unresolved',items:[]};
  const matches=content.passages.filter(p=>p.text.includes(quote));const single=matches[0];
  if(matches.length===1&&single&&single.text.indexOf(quote)===single.text.lastIndexOf(quote))return {status:'exact',items:[single]};
  return {status:matches.length?'ambiguous':'unresolved',items:[]};
}
