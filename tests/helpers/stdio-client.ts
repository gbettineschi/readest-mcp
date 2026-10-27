import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import path from 'node:path';
export async function stdioClient(config:string,entry=path.resolve('dist/cli.js')){
 const client=new Client({name:'readest-integration-test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[entry,'serve','--config',config],stderr:'pipe'});let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk.toString());
 try{await client.connect(transport);}catch(error){await transport.close();throw error;}
 return {client,stderr:()=>stderr,close:()=>client.close()};
}
