import {expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {localLibrary,keys} from './helpers/local-library.js';
import {epub} from './helpers/books.js';
const exec=promisify(execFile);
it('runs doctor and explicit content refresh, rejects invalid commands and never prompts on piped login',async()=>{
 const f=await localLibrary();try{await fs.writeFile(path.join(f.library,keys.a,'book.epub'),await epub());const config=path.join(f.root,'config.json');await fs.writeFile(config,JSON.stringify(f.config));
 const run=(args:string[])=>exec(process.execPath,['dist/cli.js',...args,'--config',config]);
 const doctor=await run(['doctor']);expect(JSON.parse(doctor.stdout).data.known_books).toBe(4);
 const refresh=await run(['refresh','--content','available']);expect(JSON.parse(refresh.stdout).indexed).toBe(1);
 await expect(run(['unsupported'])).rejects.toMatchObject({code:1});await expect(run(['login'])).rejects.toMatchObject({code:1});
 }finally{await f.cleanup();}
});
