import net from 'node:net';
import {lookup} from 'node:dns/promises';
import type {CloudConfig} from '../config.js';
import {DomainError} from '../domain/result.js';
import {LIMITS} from '../limits.js';
import type {createCloudAuth} from './cloud-auth.js';
const loopback=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host);
export async function boundedBody(response:Response,limit:number,signal:AbortSignal):Promise<Buffer>{
  const length=Number(response.headers.get('content-length'));if(length>limit){await response.body?.cancel();throw new DomainError('LIMIT_EXCEEDED','Remote response exceeds the supported size limit.');}
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks:Uint8Array[]=[];let count=0;
  try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>limit)throw new DomainError('LIMIT_EXCEEDED','Remote response exceeds the supported size limit.');chunks.push(value);}if(length>0&&count!==length)throw new DomainError('SOURCE_UNAVAILABLE','Remote transfer was incomplete.',true);return Buffer.concat(chunks,count);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class CloudClient {
  constructor(private config:CloudConfig,private auth:ReturnType<typeof createCloudAuth>){}
  async get(endpoint:'/sync'|'/storage/download',params:Record<string,string>,signal:AbortSignal):Promise<Record<string,unknown>>{
    if(!['/sync','/storage/download'].includes(endpoint))throw new DomainError('ACCESS_DENIED','Only reading endpoints are available.');
    const url=new URL(this.config.api_base.replace(/\/$/,'')+endpoint);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
    let token=await this.auth.token();
    for(let attempt=0;attempt<2;attempt++){
      let response:Response;const boundedSignal=AbortSignal.any([signal,AbortSignal.timeout(LIMITS.requestMs)]);
      try{response=await fetch(url,{method:'GET',headers:{Authorization:'Bearer '+token},signal:boundedSignal,redirect:'error'});}catch{throw new DomainError('SOURCE_UNAVAILABLE','Readest Cloud could not be reached.',true);}
      let body:unknown;try{body=JSON.parse((await boundedBody(response,LIMITS.metadataBytes,boundedSignal)).toString('utf8'));}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('SOURCE_UNAVAILABLE','Cloud returned an invalid response.',true);}
      const data=body!==null&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:null;
      if(attempt===0&&(response.status===401||(response.status===403&&data?.error==='Not authenticated'))){token=await this.auth.token(token);continue;}
      if(!response.ok)throw new DomainError(response.status===401?'AUTH_REQUIRED':response.status===403?'ACCESS_DENIED':'SOURCE_UNAVAILABLE',response.status===403?'Readest Cloud denied access.':'Readest Cloud request failed.',response.status>=500);
      if(!data)throw new DomainError('SOURCE_UNAVAILABLE','Cloud returned an unsupported response.');return data;
    }
    throw new DomainError('AUTH_REQUIRED','Sign in to Readest Cloud again.');
  }
  async download(urlString:string,signal:AbortSignal):Promise<Buffer>{
    const url=new URL(urlString);const testing=loopback(new URL(this.config.api_base).hostname)&&loopback(url.hostname);
    if(url.username||url.password||(url.protocol!=='https:'&&!testing))throw new DomainError('ACCESS_DENIED','Cloud returned an unsupported download destination.');
    if(!testing){const addresses=net.isIP(url.hostname)?[{address:url.hostname}]:await lookup(url.hostname,{all:true});if(addresses.some(({address})=>/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd]|fe80:)/i.test(address)))throw new DomainError('ACCESS_DENIED','Cloud download destination is not public.');}
    const boundedSignal=AbortSignal.any([signal,AbortSignal.timeout(LIMITS.requestMs)]);let response:Response;
    try{response=await fetch(url,{signal:boundedSignal,redirect:'error'});}catch{throw new DomainError('SOURCE_UNAVAILABLE','Book download could not be completed.',true);}
    if(!response.ok){await response.body?.cancel();throw new DomainError(response.status===403?'SIGNED_URL_EXPIRED':'SOURCE_UNAVAILABLE','Book download could not be completed.',true);}
    return boundedBody(response,LIMITS.sourceBytes,boundedSignal);
  }
}
