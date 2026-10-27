import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalSource } from '../src/sources/local.js';
import { loadConfig } from '../src/config.js';
import { resolveAllowedPath } from '../src/security/paths.js';
import {localLibrary,keys} from './helpers/local-library.js';
const signal=()=>new AbortController().signal;
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(cleanups.splice(0).map(fn=>fn()));});
async function fixture(){const f=await localLibrary();cleanups.push(f.cleanup);return f;}
describe('passive local source',()=>{
  it('keeps catalogues, empty notes, missing notes and remote files distinct',async()=>{
    const f=await fixture(),before=await fs.readFile(path.join(f.library,'library.json'));
    const source=createLocalSource(f.config);const r=await source.readSnapshot(null,signal());
    expect(r.books).toHaveLength(4);
    expect(r.books.find(b=>b.source_key===keys.a)).toMatchObject({reading:{current:3,total:10,status:'reading'},availability:{file:'available',annotations:'available'}});
    expect(r.books.find(b=>b.source_key===keys.b)).toMatchObject({availability:{file:'unavailable',annotations:'available'}});
    expect(r.books.find(b=>b.source_key===keys.c)?.availability.annotations).toBe('unavailable');
    expect(r.books.find(b=>b.source_key===keys.d)?.availability.index).toBe('unsupported');
    expect(r.annotations.map(n=>n.kind)).toEqual(['bookmark','annotation','excerpt','notebook','ink']);
    expect(r.annotations.at(-1)).toMatchObject({ink_available:true,ink:[{points:[{x:1,y:2}]}]});
    expect(await fs.readFile(path.join(f.library,'library.json'))).toEqual(before);
  });
  it('copies unchanged bytes into its own cache and does not fetch a remote placeholder',async()=>{
    const f=await fixture(),s=createLocalSource(f.config),r=await s.readSnapshot(null,signal());
    const file=await s.resolveBookFile(r.books.find(b=>b.source_key===keys.a)!,{acquire:true,signal:signal()});
    expect(file.status).toBe('available');if(file.status==='available'){expect(file.path.startsWith(f.cache+path.sep)).toBe(true);expect(await fs.readFile(file.path,'utf8')).toBe('synthetic fixture bytes');}
    expect(await s.resolveBookFile(r.books.find(b=>b.source_key===keys.b)!,{acquire:true,signal:signal()})).toMatchObject({status:'unavailable',code:'CONTENT_UNAVAILABLE'});
  });
  it('rejects traversal, unapproved in-place files and symlink escapes',async()=>{
    const f=await fixture();const outside=path.join(f.root,'outside.epub');await fs.writeFile(outside,'private outside');
    await fs.symlink(outside,path.join(f.library,'escape.epub'));
    await expect(resolveAllowedPath(path.join(f.library,'..','outside.epub'),[f.library])).rejects.toMatchObject({code:'PATH_NOT_ALLOWED'});
    await expect(resolveAllowedPath(path.join(f.library,'escape.epub'),[f.library])).rejects.toMatchObject({code:'PATH_NOT_ALLOWED'});
    expect(await resolveAllowedPath(outside,[f.root])).toBe(outside);
    f.books[0]!.filePath=outside;
    await fs.writeFile(path.join(f.library,'library.json'),JSON.stringify(f.books));
    const s=createLocalSource(f.config),r=await s.readSnapshot(null,signal());
    expect(await s.resolveBookFile(r.books[0]!,{acquire:false,signal:signal()})).toMatchObject({status:'unavailable',code:'PATH_NOT_ALLOWED'});
  });
  it('does not convert a broken catalogue to a successful empty library',async()=>{
    const f=await fixture();await fs.writeFile(path.join(f.library,'library.json'),'{broken');
    await expect(createLocalSource(f.config).readSnapshot(null,signal())).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
  });
  it('reports deleted records and scopes identities to the selected library',async()=>{
    const f=await fixture(),g=await fixture();f.books[0]!.deletedAt=1000;
    await fs.writeFile(path.join(f.library,'library.json'),JSON.stringify(f.books));
    const s=createLocalSource(f.config),r=await s.readSnapshot(null,signal()),other=await createLocalSource(g.config).readSnapshot(null,signal());
    expect(r.deleted_book_ids).toHaveLength(1);expect(r.books).toHaveLength(3);
    expect(r.books[0]!.id).not.toBe(other.books.find(b=>b.source_key===keys.b)!.id);
  });
  it('retries a changed config once and marks persistent instability unavailable',async()=>{
    const f=await fixture(),target=path.join(f.library,keys.a,'config.json');const read=fs.readFile.bind(fs);let edits=0;
    vi.spyOn(fs,'readFile').mockImplementation((async(file:unknown,...args:unknown[])=>{
      const value=await (read as Function)(file,...args);
      if(String(file)===target){edits++;await fs.writeFile(target,JSON.stringify({schemaVersion:3,booknotes:[],padding:'x'.repeat(edits)}));}
      return value;
    }) as typeof fs.readFile);
    const r=await createLocalSource(f.config).readSnapshot(null,signal());
    expect(edits).toBe(2);expect(r.books.find(b=>b.source_key===keys.a)?.availability.annotations).toBe('unavailable');
    expect(r.warnings.some(w=>w.code==='ANNOTATIONS_UNAVAILABLE')).toBe(true);
  });
  it('loads relative configuration paths and rejects cache writes under a source root',async()=>{
    const f=await fixture(),config=path.join(f.root,'config.json');
    await fs.writeFile(config,JSON.stringify({source:'local',library_dir:'Books',cache_dir:'cache'}));
    expect(await loadConfig(config)).toMatchObject({library_dir:f.library,cache_dir:f.cache});
    await fs.writeFile(config,JSON.stringify({source:'local',library_dir:'Books',cache_dir:'Books/cache'}));
    await expect(loadConfig(config)).rejects.toMatchObject({code:'INVALID_CONFIG'});
  });
  it('rejects a cache path whose existing parent is a symlink into the source',async()=>{
    const f=await fixture(),alias=path.join(f.root,'alias'),config=path.join(f.root,'config.json');await fs.symlink(f.library,alias,'dir');
    await fs.writeFile(config,JSON.stringify({source:'local',library_dir:'Books',cache_dir:'alias/new-cache'}));
    await expect(loadConfig(config)).rejects.toMatchObject({code:'INVALID_CONFIG'});
  });
  it('reads legacy split highlights and comments as one annotation without rewriting them',async()=>{
    const f=await fixture(),file=path.join(f.library,keys.a,'config.json');
    const legacy=JSON.stringify({schemaVersion:1,booknotes:[{id:'highlight',type:'annotation',cfi:'same',style:'highlight',text:'source quote',createdAt:1,updatedAt:2},{id:'comment',type:'annotation',cfi:'same',note:'latest personal comment',createdAt:2,updatedAt:3}]});await fs.writeFile(file,legacy);
    const r=await createLocalSource(f.config).readSnapshot(null,signal());const b=r.books.find(b=>b.source_key===keys.a)!;
    expect(r.annotations.filter(n=>n.book_id===b.id)).toHaveLength(1);
    expect(r.annotations.find(n=>n.book_id===b.id)).toMatchObject({quote:'source quote',note:'latest personal comment'});
    expect(await fs.readFile(file,'utf8')).toBe(legacy);
  });
});
