import express from 'express';
import { AgentSkillError } from './agentSkillLibrary.js';

export function createAgentSkillRouter({ skillLibrary }) {
  const router = express.Router();
  router.use('/api/agent-skills', express.json({ limit: Infinity }));
  router.get('/api/agent-skills', async (_request, response) => {
    try {
      response.json({ skills: await skillLibrary.list() });
    } catch {
      response.status(500).json({ error: '读取 SKILL 社区失败', code: 'AGENT_SKILL_LIST_FAILED' });
    }
  });
  router.post('/api/agent-skills/import', async (request, response) => {
    try {
      const skills = await skillLibrary.importFolders(request.body?.files);
      response.status(201).json({ skills, skill: skills[0] });
    } catch (error) {
      if (error instanceof AgentSkillError) {
        response.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      response.status(500).json({ error: '导入 SKILL 失败', code: 'AGENT_SKILL_IMPORT_FAILED' });
    }
  });
  return router;
}
