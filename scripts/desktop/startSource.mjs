import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const root=fileURLToPath(new URL('../../',import.meta.url));
const meta=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root,'package.json'),'utf8'));
if(process.platform!=='win32'||process.versions.node!==meta.engines.node)throw Error(`需要 Windows x64 和 Node ${meta.engines.node}`);
const env={...process.env};
for(const key of Object.keys(env))if(key.startsWith('AIFISHER_')||key==='ELECTRON_RUN_AS_NODE'||key.startsWith('FISHERAI_'))delete env[key];
function run(file,args){return new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd:root,env,stdio:'inherit',windowsHide:true});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error(`命令失败：${code}`)));});}
await run(process.execPath,['apps/desktop/node_modules/electron/install.js']);
for(const args of [['scripts/generate-app-icon.mjs'],['scripts/build-model-catalog.mjs'],['node_modules/vite/bin/vite.js','build','--config','vite.stable.config.ts'],['node_modules/vite/bin/vite.js','build','--config','apps/desktop/launcher/vite.config.ts']])await run(process.execPath,args);
await mkdir(path.join(root,'.desktop-dev'),{recursive:true});
await run(path.join(root,'apps/desktop/node_modules/electron/dist/electron.exe'),[path.join(root,'apps/desktop')]);
