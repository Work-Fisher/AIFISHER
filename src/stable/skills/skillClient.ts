export type AgentSkill = {
  slug: string;
  name: string;
  description: string;
  fileCount: number;
  updatedAt: string;
  source?: 'official' | 'local';
  openness?: 'open' | 'closed';
  readOnly?: boolean;
  version?: string;
  bundleId?: string;
};

type AgentSkillFile = { path: string; contentBase64: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

async function uploadFiles(files: readonly File[]): Promise<AgentSkillFile[]> {
  return Promise.all(files.map(async (file) => ({
    path: String((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
    contentBase64: await fileToBase64(file),
  })));
}

export function extractSkillMentions(text: string) {
  return [...String(text || '').matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]{0,63})(?=\s|$)/gi)]
    .map((match) => match[1].toLowerCase());
}

export function createAgentSkillClient(fetcher: typeof fetch = globalThis.fetch) {
  return {
    async list(): Promise<AgentSkill[]> {
      const response = await fetcher('/api/agent-skills');
      const body = await response.json() as { skills?: AgentSkill[]; error?: string };
      if (!response.ok) throw new Error(body.error || '读取 SKILL 社区失败');
      return body.skills || [];
    },
    async importFolders(files: readonly File[]): Promise<AgentSkill[]> {
      const response = await fetcher('/api/agent-skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: await uploadFiles(files) }),
      });
      const body = await response.json() as { skills?: AgentSkill[]; error?: string };
      if (!response.ok || !body.skills?.length) throw new Error(body.error || '导入 SKILL 失败');
      return body.skills;
    },
    mentions: extractSkillMentions,
  };
}

export type AgentSkillClient = ReturnType<typeof createAgentSkillClient>;

declare global {
  interface Window {
    __FISHERAI_SKILLS__?: AgentSkillClient;
  }
}

export function installAgentSkillClient(client = createAgentSkillClient()) {
  window.__FISHERAI_SKILLS__ = client;
  return client;
}
