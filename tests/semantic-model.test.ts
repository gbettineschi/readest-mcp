import {expect,it} from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {createLocalEmbedder,chunkText} from '../dist/index/embeddings.js';
it.skipIf(process.env.READEST_TEST_MODEL!=='1')('ranks cross-language answers above same-language distractors',async()=>{
 const embedder=await createLocalEmbedder({enabled:true,model_dir:process.env.READEST_MODEL_DIR??path.join(os.homedir(),'.cache','readest-mcp','models')});
 const passages=[
  'To concentrate on a demanding task, turn off notifications and work for an uninterrupted interval. Switching between tasks makes it harder to think deeply.',
  'Con il presidente non occorre preparare lunghi discorsi. Nelle riunioni di famiglia si discute di politica e delle ultime notizie.',
  'Organizing an informal community conference requires finding a venue and inviting participants to choose the agenda.',
  'Practice a difficult skill by repeating progressively harder exercises and obtaining immediate feedback. A teacher should identify mistakes and correct your technique.',
  'La lezione di storia parla della comunità e del lavoro. Dopo la lettura gli studenti discutono le decisioni del presidente.',
  'Listen for the feelings and unmet needs behind an angry accusation, rather than replying with criticism or blame.',
  'Le accuse nel processo erano gravi e i giudici hanno discusso la sentenza. Gli avvocati hanno presentato le prove alla corte.',
  'Per risalire il vento, una barca a vela alterna bordi diagonali e cambia mura. Non può puntare direttamente nella direzione da cui soffia.',
  'The sailboat is being repainted inside a warm building. The crew is repairing the deck and replacing damaged ropes.',
  'Respect without surrendering your views',
  'Bringing a conversation back to life',
  'Scheduling a community forum'
 ];
 const cases=[['Concentrarsi senza interruzioni su un compito difficile',0],['Imparare abilità difficili attraverso pratica deliberata',3],['Capire i bisogni di chi ci accusa senza rispondere con critiche',5],['How can a sailing boat travel towards the source of the wind?',7],['ability to focus without distraction',0]] as const;
 try{const vectors=await embedder.embed(passages,'passage');for(const [query,answer]of cases){const [q]=await embedder.embed([query],'query'),ranks=vectors.map((v,i)=>({i,score:v.reduce((sum,n,j)=>sum+n*q![j]!,0)})).sort((a,b)=>b.score-a.score);expect(ranks[0]?.i,query).toBe(answer);}}
 finally{await embedder.close?.();}
},120_000);
it.skipIf(process.env.READEST_TEST_MODEL!=='1')('retrieves held-out English/Italian paraphrases using the pinned offline CPU model',async()=>{
 const start=performance.now();const embedder=await createLocalEmbedder({enabled:true,model_dir:process.env.READEST_MODEL_DIR??path.join(os.homedir(),'.cache','readest-mcp','models')});
 const passages=[
  'Sleep helps the brain consolidate memories formed during the day.',
  'Una nave può avanzare controvento alternando bordi a zig zag.',
  'Diversification spreads investments across assets to reduce concentration risk.',
  'Il lievito produce gas che fa aumentare il volume dell’impasto.',
  'A glacier slowly moves downhill under the force of gravity.',
  'La gratitudine è una risposta al beneficio ricevuto e alla buona volontà del benefattore.',
  'Plants use sunlight to convert carbon dioxide and water into sugars.',
  'An encrypted message can only be read by someone holding the correct key.'
 ];
 const cases=[['Why does resting at night help us remember?',0],['Come si naviga quando il vento arriva dalla direzione di destinazione?',1],['How can a portfolio avoid depending on a single company?',2],['Perché il pane si gonfia prima della cottura?',3],['What makes a large body of ice flow down a valley?',4],['Che rapporto c’è tra riconoscenza e intenzioni di chi aiuta?',5]] as const;
 try{const vectors=await embedder.embed(passages,'passage');for(const v of vectors){expect(v.length).toBe(384);expect(v.every(Number.isFinite)).toBe(true);expect(Math.hypot(...v)).toBeCloseTo(1,4);}
  for(const [query,answer]of cases){const [q]=await embedder.embed([query],'query');const ranks=vectors.map((v,i)=>({i,score:v.reduce((sum,n,j)=>sum+n*q![j]!,0)})).sort((a,b)=>b.score-a.score);expect(ranks.slice(0,3).map(r=>r.i),query).toContain(answer);}
  const text='日本語の長い文章 e una frase italiana 😀 '.repeat(100);const chunks=await chunkText(text,embedder.countTokens);expect(chunks.map(c=>text.slice(c.start,c.end)).join('')).toBe(text);for(const c of chunks)expect(await embedder.countTokens(text.slice(c.start,c.end))).toBeLessThanOrEqual(128);
  await expect(embedder.embed(['word '.repeat(150)],'query')).rejects.toMatchObject({code:'QUERY_TOO_LONG'});
  console.log(JSON.stringify({corpus:'8 synthetic passages / 6 held-out queries',elapsed_seconds:(performance.now()-start)/1000,max_rss_mb:process.resourceUsage().maxRSS/1024}));
 }finally{await embedder.close?.();}
},120_000);
