import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import {CredentialStore,createCloudAuth} from '../src/sources/cloud-auth.js';
import {cloudFixture,userId} from './helpers/cloud-http.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{await Promise.all(cleanups.splice(0).map(f=>f()));});
it('stores a separate renewable session privately and never persists a password',async()=>{
  const f=await cloudFixture();cleanups.push(f.close);const store=new CredentialStore(f.config.credential_file),auth=createCloudAuth(f.config,store);
  await auth.signIn('fixture@example.invalid','fixture-password');expect(await store.load()).toMatchObject({user_id:userId,refresh_token:'fixture-refresh-rotated'});
  expect(await fs.readFile(f.config.credential_file,'utf8')).not.toContain('fixture-password');
  if(process.platform!=='win32')expect((await fs.stat(f.config.credential_file)).mode&0o777).toBe(0o600);
});
it('serializes concurrent refreshes and persists the rotated session',async()=>{
  const f=await cloudFixture();cleanups.push(f.close);const store=new CredentialStore(f.config.credential_file);await store.save({...f.session,expires_at:0});
  const auth=createCloudAuth(f.config,store);const tokens=await Promise.all([auth.token(),auth.token(),auth.token()]);expect(new Set(tokens).size).toBe(1);expect(f.state.renewals).toBe(1);expect((await store.load())?.refresh_token).toBe('fixture-refresh-rotated');
});
it('coordinates two independent auth instances through the credential lock',async()=>{
  const f=await cloudFixture();cleanups.push(f.close);const store=new CredentialStore(f.config.credential_file);await store.save({...f.session,expires_at:0});
  const a=createCloudAuth(f.config,store),b=createCloudAuth(f.config,new CredentialStore(f.config.credential_file));
  expect(new Set(await Promise.all([a.token(),b.token()])).size).toBe(1);expect(f.state.renewals).toBe(1);
});
