import { describe, it, expect } from 'vitest';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOfficialSkillRegistry } from '../server/agent/officialSkillRegistry.js';
import { normalizeApiWorkflow, analyzeWorkflow } from '../server/workflowRuntime/workflowFormat.js';
import { resolveInstallation } from '../apps/desktop/src/installation.mjs';
import { createBackendEnvironment } from '../apps/desktop/src/backendEnvironment.mjs';

describe('public source boundary', () => {
  it('offers only open skills and reads every one without private templates', async () => {
    const registry=createOfficialSkillRegistry();
    expect(registry.list().map(item=>item.slug)).toEqual(['minimax-drama-prompt','minimax-drama-high','minimax-fight-assets']);
    for (const skill of registry.list()) {
      expect(skill.openness).toBe('open');
      expect((await registry.readInstructions(skill.slug)).length).toBeGreaterThan(100);
    }
    await expect(registry.readInstructions('closed-drama')).rejects.toThrow();
  });
  it('loads the official public issuer and keeps source updates separate from installers', async () => {
    const install=resolveInstallation({packaged:false,sourceRoot:process.cwd(),executablePath:'electron.exe',environment:{}});
    const {loadReleaseHelpers,readIdentityIssuer}=await import('../apps/desktop/src/backendEnvironment.mjs');
    const helpers=await loadReleaseHelpers(install.tools);
    expect(await readIdentityIssuer({installation:install,helpers})).toBe('https://identity.work-fisher.com');
    expect(install.updateBridge).toBeNull();
    const key=await readFile('security/identity-access-token-public.pem','utf8');
    expect(key).toContain('BEGIN PUBLIC KEY');
    expect(key).not.toContain('PRIVATE KEY');
  });
  it('keeps ComfyUI import normalization and rejects dependent incomplete nodes', () => {
    const source={'1':{class_type:'CLIPTextEncode',inputs:{text:'test'}},'2':{inputs:{}}};
    expect(Object.keys(normalizeApiWorkflow(source))).toEqual(['1']);
    expect(Object.keys(source)).toEqual(['1','2']);
    expect(()=>normalizeApiWorkflow({'1':{class_type:'SaveImage',inputs:{images:['2',0]}},'2':{inputs:{}}})).toThrow();
  });
  it('excludes private skills and includes the authorized preview catalogues', async () => {
    const names=await (await import('node:fs/promises')).readdir('server/agent/builtin');
    expect(names.some(name=>name.startsWith('closed-')||name==='shared-assets')).toBe(false);
    for(const name of ['creativeCatalog','mjStyleCatalog'])expect(JSON.parse(await readFile(`src/stable/prompt/${name}.json`,'utf8'))).not.toHaveLength(0);
    const preload=await readFile('apps/desktop/src/preload.cjs','utf8');
    expect(preload).toContain('account: Object.freeze');
  });
});
