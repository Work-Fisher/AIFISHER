import express from 'express';
import { RunningHubWebAppError } from './runningHubWebApp.js';
import { RunningHubWebAppLibraryError } from './runningHubWebAppLibraryService.js';
import { RunningHubWorkflowClientError } from './runningHubWorkflowClient.js';
import { WorkflowDeploymentError } from './workflowDeploymentService.js';

const json = express.json({ limit: 256 * 1024 });

function sendError(response, error, logger) {
  const safe = error instanceof RunningHubWebAppError
    || error instanceof RunningHubWebAppLibraryError
    || error instanceof RunningHubWorkflowClientError
    || error instanceof WorkflowDeploymentError;
  if (!safe) logger.error('RunningHub WebApp library error', { errorType: error?.name || 'Error' });
  response.status(safe ? Number(error.status) || 400 : 500).json({
    error: safe ? error.message : '云端工作流内部错误',
    code: safe ? error.code : 'RUNNINGHUB_WEBAPP_INTERNAL_ERROR',
  });
}

export function createRunningHubWebAppRouter({ service, logger = console }) {
  if (!service) throw new Error('RunningHub WebApp router requires a library service');
  const router = express.Router();

  router.get('/official-workflows', async (_request, response) => {
    try { response.json({ workflows: await service.listOfficialWorkflows() }); }
    catch (error) { sendError(response, error, logger); }
  });
  router.post('/official-workflows/:id/add', json, async (request, response) => {
    try { response.json(await service.addOfficialWorkflow(request.params.id)); }
    catch (error) { sendError(response, error, logger); }
  });

  router.get('/runninghub-webapps', async (_request, response) => {
    try {
      response.json(await service.getLibrary());
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/runninghub-webapps', json, async (request, response) => {
    try {
      response.status(201).json(await service.createApp({
        webAppId: request.body?.webAppId,
        credentialRef: request.body?.credentialRef,
        categoryId: request.body?.categoryId,
        title: request.body?.title,
        description: request.body?.description,
        instanceType: request.body?.instanceType,
      }));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/runninghub-credentials/validate', json, async (request, response) => {
    try {
      response.json(await service.validateCredential(request.body?.credentialRef));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.delete('/runninghub-webapps/:definitionId', async (request, response) => {
    try {
      response.json(await service.deleteApp(request.params.definitionId));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post('/runninghub-webapp-categories', json, async (request, response) => {
    try {
      response.status(201).json(await service.createCategory(request.body?.name));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.delete('/runninghub-webapp-categories/:categoryId', async (request, response) => {
    try {
      response.json(await service.deleteCategory(request.params.categoryId));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  return router;
}
