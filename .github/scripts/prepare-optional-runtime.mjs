import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const file=process.env.READEST_CONFIG,models=process.env.READEST_MODEL_DIR;
if(!file||!models)throw new Error('CI runtime configuration paths are required.');
const root=path.dirname(file),library=path.join(root,'Books');
await fs.mkdir(library,{recursive:true});
await fs.writeFile(path.join(library,'library.json'),'[]');
await fs.writeFile(file,JSON.stringify({source:'local',library_dir:library,cache_dir:path.join(root,'cache'),embeddings:{enabled:true,model_dir:models}}));
execFileSync(process.execPath,['dist/cli.js','models','fetch','--config',file],{stdio:'inherit'});
