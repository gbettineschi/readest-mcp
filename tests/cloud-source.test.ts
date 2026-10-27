import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import {createCloudSource} from '../dist/sources/cloud.js';
import {cloudFixture} from './helpers/cloud-http.js';
import {loadConfig} from '../dist/config.js';
import path from 'node:path';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{await Promise.all(cleanups.splice(0).map(f=>f()));});
async function fixture(){const f=await cloudFixture();cleanups.push(f.close);return f;}
const signal=()=>new AbortController().signal;
describe('read-only cloud source',()=>{
  it('normalizes independent streams and leaves book acquisition on demand',async()=>{
    const f=await fixture(),s=await createCloudSource(f.config),r=await s.readSnapshot(null,signal());
    expect(r.books).toHaveLength(1);expect(r.books[0]).toMatchObject({title:'Cloud decisions',reading:{current:2,total:5},availability:{annotations:'available'}});
    expect(r.annotations[0]).toMatchObject({quote:'An uncertain outcome',note:'my comment'});
    expect(f.state.downloads).toBe(0);expect(r.checkpoint).toMatchObject({books_cursor:Date.parse('2026-01-03T00:00:00Z'),notes_cursor:Date.parse('2026-01-02T00:00:00Z')});
    const file=await s.resolveBookFile(r.books[0]!,{acquire:true,signal:signal()});expect(file.status).toBe('available');
    if(file.status==='available')expect(await fs.readFile(file.path,'utf8')).toBe('fixture book bytes');
    expect(f.state.requests.filter(r=>r.url.startsWith('/file.')).every(r=>r.authorization===undefined)).toBe(true);
    expect(f.state.requests.every(r=>r.method==='GET')).toBe(true);
  });
  it('does not lose a page-boundary batch of books sharing a timestamp',async()=>{
    const f=await fixture();f.state.largePage=true;const r=await (await createCloudSource(f.config)).readSnapshot(null,signal());
    expect(r.books).toHaveLength(1001);expect(new Set(r.books.map(b=>b.id)).size).toBe(1001);
  });
  it('retains the failed notes checkpoint and reports the failed channel',async()=>{
    const f=await fixture(),s=await createCloudSource(f.config),first=await s.readSnapshot(null,signal());f.state.notesError=true;
    const next=await s.readSnapshot(first.checkpoint,signal());expect(next.checkpoint.notes_cursor).toBe(first.checkpoint.notes_cursor);expect(next.warnings.some(w=>w.code==='CHANNEL_UNAVAILABLE')).toBe(true);
  });
  it('rejects malformed success bodies instead of claiming an empty catalogue',async()=>{
    const f=await fixture();f.state.malformed=true;await expect((await createCloudSource(f.config)).readSnapshot(null,signal())).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
  });
  it('renews recognized expired authentication once but not genuine access denial',async()=>{
    const f=await fixture();f.state.authOnce=true;await (await createCloudSource(f.config)).readSnapshot(null,signal());expect(f.state.renewals).toBe(1);
    f.state.deny=true;await expect((await createCloudSource(f.config)).readSnapshot(null,signal())).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(f.state.renewals).toBe(1);
  });
  it('reacquires an expired signed URL once and reports tombstones',async()=>{
    const f=await fixture(),s=await createCloudSource(f.config),r=await s.readSnapshot(null,signal());f.state.signedExpired=true;
    expect((await s.resolveBookFile(r.books[0]!,{acquire:true,signal:signal()})).status).toBe('available');expect(f.state.downloads).toBe(2);
    f.state.deleted=true;const deleted=await s.readSnapshot(null,signal());expect(deleted.books).toHaveLength(0);expect(deleted.deleted_book_ids).toHaveLength(1);expect(deleted.deleted_annotation_ids).toHaveLength(1);
  });
  it('rejects oversized metadata and does not commit an interrupted download',async()=>{
    const f=await fixture(),s=await createCloudSource(f.config),r=await s.readSnapshot(null,signal());f.state.interrupted=true;
    expect(await s.resolveBookFile(r.books[0]!,{acquire:true,signal:signal()})).toMatchObject({status:'unavailable',code:'SOURCE_UNAVAILABLE'});
    expect(await fs.readdir(path.join(f.config.cache_dir,s.source_id,'files')).catch(()=>[])).toEqual([]);
    f.state.oversized=true;const cached=await s.readSnapshot(r.checkpoint,signal());expect(cached.coverage.completeness).toBe('partial');expect(cached.checkpoint).toEqual(r.checkpoint);expect(cached.warnings.some(w=>w.code==='USING_CACHE')).toBe(true);
    await expect(s.readSnapshot(null,signal())).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});
  });
  it('requires a reconnect after changing accounts instead of mixing cached identities',async()=>{
    const f=await fixture(),s=await createCloudSource(f.config);await fs.writeFile(f.config.credential_file,JSON.stringify({...f.session,user_id:'another-user'}));
    await expect(s.readSnapshot(null,signal())).rejects.toMatchObject({code:'ACCOUNT_CHANGED'});
  });
  it('has published cloud defaults without asking users to find project keys',async()=>{
    const f=await fixture(),file=path.join(f.root,'config.json');await fs.writeFile(file,JSON.stringify({source:'cloud',credential_file:'private/credentials.json'}));
    const config=await loadConfig(file);expect(config.source).toBe('cloud');if(config.source==='cloud'){expect(new URL(config.api_base).protocol).toBe('https:');expect(new URL(config.auth_url).protocol).toBe('https:');expect(config.anon_key.length).toBeGreaterThan(20);}
  });
});
