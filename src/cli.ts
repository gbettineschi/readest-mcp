#!/usr/bin/env node
import {parseArgs} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {Writable} from 'node:stream';
import {createInterface} from 'node:readline/promises';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {loadConfig} from './config.js';
import {createLocalSource} from './sources/local.js';
import {createCloudSource} from './sources/cloud.js';
import {createCloudAuth} from './sources/cloud-auth.js';
import {openIndex} from './index/store.js';
import {createRefreshCoordinator} from './index/refresh.js';
import {createDocumentExtractor} from './content/extract.js';
import {createLocalEmbedder,fetchModel} from './index/embeddings.js';
import {createToolHandlers} from './service.js';
import {createMcpServer} from './mcp/server.js';
import {DomainError} from './domain/result.js';
import type {Embedder} from './domain/model.js';
async function main(){
 const {positionals,values}=parseArgs({allowPositionals:true,options:{config:{type:'string'},content:{type:'string'},rebuild:{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log('readest-mcp <serve|doctor|login|refresh|models fetch> --config <file>\nrefresh [--content available|all] [--rebuild]');return;}
 const command=positionals.join(' ');if(!['serve','doctor','login','refresh','models fetch'].includes(command))throw new DomainError('INVALID_COMMAND','Choose serve, doctor, login, refresh or models fetch.');
 const config=await loadConfig(values.config??path.join(os.homedir(),'.config','readest-mcp','config.json'));
 if(command==='models fetch'){console.log(JSON.stringify(await fetchModel(config.embeddings)));return;}
 if(command==='login'){
  if(config.source!=='cloud')throw new DomainError('INVALID_COMMAND','Login is only used with the cloud source.');
  if(!process.stdin.isTTY||!process.stderr.isTTY)throw new DomainError('AUTH_REQUIRED','Run login in your own terminal for private credential entry.');
  let muted=false;const output=new Writable({write(chunk,_encoding,done){if(!muted)process.stderr.write(chunk);done();}});const rl=createInterface({input:process.stdin,output,terminal:true});
  try{const email=await rl.question('Readest email: ');process.stderr.write('Readest password (hidden): ');muted=true;const password=await rl.question('');muted=false;process.stderr.write('\n');await createCloudAuth(config).signIn(email,password);console.log('Signed in. The renewable session is saved privately; the password was not stored.');}finally{muted=false;rl.close();}return;
 }
 const source=config.source==='local'?createLocalSource(config):await createCloudSource(config),store=openIndex(config,source.source_id);let embedder:Embedder|null=null;
 try{if(config.embeddings.enabled)try{embedder=await createLocalEmbedder(config.embeddings);}catch{/* Availability is reported through tool results. */}
  const refresh=createRefreshCoordinator({source,store,extractor:createDocumentExtractor(),embedder}),handlers=createToolHandlers({source,store,refresh,embedder});
  if(command==='refresh'){if(values.content&&!['available','all'].includes(values.content))throw new DomainError('INVALID_COMMAND','Content must be available or all.');console.log(JSON.stringify(await refresh.refresh({content:values.content==='all'?'all':'available',rebuild:values.rebuild??false},new AbortController().signal)));return;}
  if(command==='doctor'){const result=await handlers.library_status({});console.log(JSON.stringify(result));if(result.status==='error')process.exitCode=1;return;}
  const server=createMcpServer(handlers);let closing=false;const close=async()=>{if(closing)return;closing=true;await server.close();await embedder?.close?.();store.close();};process.stdin.once('end',()=>void close());process.once('SIGTERM',()=>void close().then(()=>process.exit(0)));process.once('SIGINT',()=>void close().then(()=>process.exit(0)));await server.connect(new StdioServerTransport());
  // Source failures remain callable typed results, including when startup has no credentials.
  await handlers.library_status({});return;
 }finally{if(command!=='serve'){await embedder?.close?.();store.close();}}
}
main().catch(error=>{const failure=error instanceof DomainError?error:new DomainError('OPERATION_FAILED','Command could not be completed. Check configuration and retry.');console.error(JSON.stringify({code:failure.code,message:failure.message,retryable:failure.retryable}));process.exitCode=1;});
