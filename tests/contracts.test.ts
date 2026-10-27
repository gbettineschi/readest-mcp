import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { DatabaseSync } from 'node:sqlite';
import { createMcpServer } from '../dist/mcp/server.js';
import { inputSchemas, outputSchemas, toolNames } from '../dist/mcp/schemas.js';
import { makeResult } from '../dist/domain/result.js';
import type { ToolHandlers } from '../dist/mcp/schemas.js';

const meta = (source: 'local'|'cloud') => ({source,refreshed_at:null,from_cache:false,coverage:{scope:'configured_source' as const,completeness:'unknown' as const,known_books:null,covered_books:null}});
const empty = (source: 'local'|'cloud') => ({data:{items:[],next_cursor:null},status:'ok' as const,warnings:[],error:null,meta:meta(source)});
const failure = (source: 'local'|'cloud') => ({data:null,status:'error' as const,warnings:[],error:{code:'SOURCE_UNAVAILABLE',message:'Source cannot be reached.',retryable:true},meta:meta(source)});

async function connect(source: 'local'|'cloud', fail = false) {
  const handlers = Object.fromEntries(toolNames.map(name => [name,async () => fail ? failure(source) : empty(source)])) as unknown as ToolHandlers;
  const server = createMcpServer(handlers);
  const client = new Client({name:'contract-test',version:'1.0.0'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return {client,close:async()=>{await client.close();await server.close();}};
}

describe('source-independent public contract',()=>{
  it('advertises identical six-tool inputs, outputs and descriptions for either source',async()=>{
    const a=await connect('local'), b=await connect('cloud');
    try { const local=(await a.client.listTools()).tools,cloud=(await b.client.listTools()).tools;
      expect(local.map(t=>t.name)).toEqual(['library_status','list_books','get_book','list_annotations','search_library','read_content']);
      expect(local).toEqual(cloud);
    } finally {await a.close();await b.close();}
  });
  it('returns typed empty data without claiming account-wide completeness',async()=>{
    const c=await connect('local');try {
      const result=await c.client.callTool({name:'list_books',arguments:{}});
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({data:{items:[],next_cursor:null},status:'ok',warnings:[],error:null,meta:{source:'local',coverage:{completeness:'unknown'}}});
      expect(JSON.parse((result.content[0] as {text:string}).text)).toEqual(result.structuredContent);
    }finally{await c.close();}
  });
  it('keeps expected source failures in the same schema with isError set',async()=>{
    const c=await connect('cloud',true);try {
      const result=await c.client.callTool({name:'list_books',arguments:{}});
      expect(result.isError).toBe(true);
      expect(outputSchemas.list_books.safeParse(result.structuredContent).success).toBe(true);
      expect(result.structuredContent).toMatchObject({data:null,status:'error',error:{code:'SOURCE_UNAVAILABLE'}});
    }finally{await c.close();}
  });
  it('rejects contradictory success/error results and oversized outputs',()=>{
    expect(()=>makeResult({...empty('local'),error:{code:'BAD',message:'bad',retryable:false}})).toThrow();
    expect(()=>makeResult({...failure('cloud'),error:null})).toThrow();
    expect(()=>makeResult({...empty('local'),data:{text:'x'.repeat(70_000)}})).toThrow(/limit/i);
  });
  it('bounds model input and accepts a normal pagination cursor without partial status',()=>{
    expect(inputSchemas.list_books.safeParse({limit:51}).success).toBe(false);
    expect(inputSchemas.search_library.safeParse({query:'x'.repeat(1001)}).success).toBe(false);
    expect(outputSchemas.list_books.safeParse({...empty('cloud'),data:{items:[],next_cursor:'next'}}).success).toBe(true);
  });
  it('can create an FTS5 index on the supported runtime',()=>{
    const db=new DatabaseSync(':memory:');try{db.exec('CREATE VIRTUAL TABLE passages USING fts5(text)');db.prepare('INSERT INTO passages(text) VALUES (?)').run('uncertainty');expect(db.prepare('SELECT text FROM passages WHERE passages MATCH ?').get('uncertainty')).toEqual({text:'uncertainty'});}finally{db.close();}
  });
});
