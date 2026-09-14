import express from 'express';
import { WorkflowDefinitionStoreError } from './workflowDefinitionStore.js';
import {
  compileWorkflowBindings,
  resolvePublicBindingValues,
  toBindingSetDto,
  WorkflowBindingError,
} from './workflowBindingCompiler.js';
import { WorkflowAssetError } from './workflowAssetResolver.js';
import { WorkflowConfigurationError } from './workflowConfigurationStore.js';
import {
  isWorkflowRuntimeDomainError,
  WorkflowDeploymentError,
} from './workflowDeploymentService.js';
import { LocalComfyClientError } from './localComfyClient.js';
import { WorkflowTestRunError } from './workflowTestRunService.js';
import { WorkflowRunStoreError } from './workflowRunStore.js';
import { LocalComfyExecutorError } from './localComfyExecutor.js';
import { RunningHubWorkflowExecutorError } from './runningHubWorkflowExecutor.js';
import { WorkflowAttestationError } from './workflowAttestationService.js';
import { DirectoryGrantError } from './directoryGrantStore.js';
import { WorkflowCanvasNodeError } from './workflowCanvasNodeService.js';

const workflowRuntimeJson = express.json({ limit: 4 * 1024 * 1024 });

function sendError(response, error, logger) {
  const safe = isWorkflowRuntimeDomainError(error)
    || error instanceof WorkflowDefinitionStoreError
    || error instanceof WorkflowAssetError
    || error instanceof LocalComfyClientError
    || error instanceof WorkflowTestRunError
    || error instanceof WorkflowRunStoreError
    || error instanceof LocalComfyExecutorError
    || error instanceof RunningHubWorkflowExecutorError
    || error instanceof WorkflowAttestationError
    || error instanceof WorkflowCanvasNodeError
    || error instanceof DirectoryGrantError;
  if (!safe) {
    logger.error('Workflow runtime internal error', { errorType: error?.name || 'Error' });
  }
  const status = safe ? Number(error.status) || 400 : 500;
  response.status(status).json({
    error: safe ? error.message : '工作流运行时内部错误',
    code: safe ? error.code : 'WORKFLOW_RUNTIME_INTERNAL_ERROR',
    ...(safe && error.details !== undefined ? { details: error.details } : {}),
  });
}

function assertDefinitionReference(definition, record) {
  if (
    record.definitionId !== definition.id
    || record.definitionRevision !== definition.revision
  ) {
    throw new WorkflowDeploymentError('配置不属于当前工作流', 'WORKFLOW_REFERENCE_CONFLICT', 409);
  }
}

export function createWorkflowRuntimeRouter({
  definitionStore,
  configurationStore,
  deploymentService,
  editorSnapshotService = null,
  assetResolver,
  testRunService = null,
  attestationService = null,
  canvasNodeService = null,
  logger = console,
}) {
  if (!definitionStore || !configurationStore || !deploymentService || !assetResolver) {
    throw new Error('Workflow runtime router requires all runtime services');
  }
  const router = express.Router();

  if (editorSnapshotService) {
    router.get('/workflow-library/:id/editor-snapshot', async (request, response) => {
      try {
        response.json(await editorSnapshotService.read(request.params.id));
      } catch (error) {
        sendError(response, error, logger);
      }
    });
  }

  router.post(
    '/workflow-library/:id/deployments',
    workflowRuntimeJson,
    async (request, response) => {
      try {
        const result = await deploymentService.createDeployment(request.params.id, {
          runner: request.body?.runner,
          serverUrl: request.body?.serverUrl,
          baseUrl: request.body?.baseUrl,
          credentialRef: request.body?.credentialRef,
          remoteWorkflowId: request.body?.remoteWorkflowId,
          remoteWebAppId: request.body?.remoteWebAppId,
          includeWorkflowJson: request.body?.includeWorkflowJson,
          instanceType: request.body?.instanceType,
          timeoutMs: request.body?.timeoutMs,
          inputCleanupGrantId: request.body?.inputCleanupGrantId,
        });
        response.status(201).json({
          deployment: result.dto,
          candidates: result.candidates,
          outputs: result.outputs,
        });
      } catch (error) {
        sendError(response, error, logger);
      }
    },
  );

  router.get('/workflow-library/:id/deployments', async (request, response) => {
    try {
      response.json(await deploymentService.listDeployments(request.params.id));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.get('/workflow-library/:id/binding-candidates', async (request, response) => {
    try {
      response.json(await deploymentService.listBindingCandidates(
        request.params.id,
        request.query.deploymentId,
      ));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post(
    '/workflow-library/:id/binding-sets',
    workflowRuntimeJson,
    async (request, response) => {
      try {
        const bindingSet = await deploymentService.createBindingSet(request.params.id, {
          deploymentId: request.body?.deploymentId,
          name: request.body?.name,
          previousBindingSetId: request.body?.previousBindingSetId,
          bindings: request.body?.bindings,
        });
        response.status(201).json(toBindingSetDto(bindingSet));
      } catch (error) {
        sendError(response, error, logger);
      }
    },
  );

  router.get('/workflow-library/:id/binding-sets', async (request, response) => {
    try {
      const records = await configurationStore.listBindingSets(request.params.id);
      response.json(records.map(toBindingSetDto));
    } catch (error) {
      sendError(response, error, logger);
    }
  });

  router.post(
    '/workflow-library/:id/preflight',
    workflowRuntimeJson,
    async (request, response) => {
      try {
        const [{ definition, apiJson }, deployment, bindingSet] = await Promise.all([
          definitionStore.readExecutionPlan(request.params.id),
          configurationStore.requireDeployment(request.body?.deploymentId),
          configurationStore.requireBindingSet(request.body?.bindingSetId),
        ]);
        assertDefinitionReference(definition, deployment);
        assertDefinitionReference(definition, bindingSet);
        const runtime = await deploymentService.verifyDeployment(deployment, apiJson);
        const publicValues = resolvePublicBindingValues(bindingSet, request.body?.values || {});
        const compiled = await compileWorkflowBindings({
          executionPlan: apiJson,
          bindingSet,
          deployment,
          projectId: request.body?.projectId,
          values: publicValues,
          resolveAsset: (reference) => assetResolver.resolve(reference, {
            stagedValue: `__FISHERAI_PREFLIGHT__/${reference.assetId}`,
          }),
        });
        const remote = ['runninghub-workflow', 'runninghub-webapp'].includes(deployment.runner);
        const webApp = deployment.runner === 'runninghub-webapp';
        response.json({
          ok: true,
          checks: [
            {
              code: 'DEPLOYMENT_REACHABLE',
              status: 'passed',
              message: remote ? `RunningHub 凭证和远程${webApp ? ' WebApp' : '工作流'}可用` : '本地 ComfyUI 可连接',
            },
            {
              code: 'CAPABILITIES_MATCH',
              status: 'passed',
              message: remote
                ? webApp
                  ? '远程 WebApp 开放字段与本地快照一致'
                  : '远程模板与本地执行计划快照一致'
                : '已连接 ComfyUI；自定义节点的最终兼容性由真实运行确认',
            },
            { code: 'BINDINGS_VALID', status: 'passed', message: '外置参数和项目素材有效' },
          ],
          compiledPromptHash: compiled.compiledPromptHash,
          candidateOutputCount: runtime.analysis.candidateOutputs.length,
        });
      } catch (error) {
        sendError(response, error, logger);
      }
    },
  );

  if (testRunService) {
    router.post(
      '/workflow-library/:id/test-runs',
      workflowRuntimeJson,
      async (request, response) => {
        try {
          const run = await testRunService.start({
            idempotencyKey: request.get('Idempotency-Key'),
            definitionId: request.params.id,
            request: request.body,
          });
          response.status(202).json(run);
        } catch (error) {
          sendError(response, error, logger);
        }
      },
    );

    router.get('/workflow-runs/:runId', async (request, response) => {
      try {
        response.json(await testRunService.getRun(request.params.runId));
      } catch (error) {
        sendError(response, error, logger);
      }
    });

    router.post('/workflow-runs/:runId/cancel', workflowRuntimeJson, (request, response) => {
      try {
        response.json(testRunService.cancel(request.params.runId));
      } catch (error) {
        sendError(response, error, logger);
      }
    });

    router.post(
      '/workflow-runs/:runId/continue-observation',
      workflowRuntimeJson,
      async (request, response) => {
        try {
          response.json(await testRunService.continueObservation(request.params.runId));
        } catch (error) {
          sendError(response, error, logger);
        }
      },
    );

    router.post('/workflow-runs/:runId/retry-input-cleanup', workflowRuntimeJson, async (request, response) => {
      try {
        response.json(await testRunService.retryInputCleanup(
          request.params.runId,
          request.body,
        ));
      } catch (error) {
        sendError(response, error, logger);
      }
    });
  }

  if (attestationService) {
    router.get('/workflow-library/:id/workflow-runs/:runId/output-candidates', async (request, response) => {
      try {
        response.json(await attestationService.listOutputCandidates(
          request.params.id,
          request.params.runId,
        ));
      } catch (error) {
        sendError(response, error, logger);
      }
    });

    router.post(
      '/workflow-library/:id/output-binding-sets',
      workflowRuntimeJson,
      async (request, response) => {
        try {
          response.status(201).json(await attestationService.createOutputBindingSet(
            request.params.id,
            request.body,
          ));
        } catch (error) {
          sendError(response, error, logger);
        }
      },
    );

    router.get('/workflow-library/:id/output-binding-sets', async (request, response) => {
      try {
        response.json(await attestationService.listOutputBindingSets(request.params.id));
      } catch (error) {
        sendError(response, error, logger);
      }
    });

    router.post(
      '/workflow-library/:id/attestations',
      workflowRuntimeJson,
      async (request, response) => {
        try {
          response.status(201).json(await attestationService.createAttestation(
            request.params.id,
            request.body,
          ));
        } catch (error) {
          sendError(response, error, logger);
        }
      },
    );

    router.get('/workflow-library/:id/attestations', async (request, response) => {
      try {
        response.json(await attestationService.listAttestations(request.params.id));
      } catch (error) {
        sendError(response, error, logger);
      }
    });
  }

  if (canvasNodeService) {
    router.post(
      '/workflow-library/:id/canvas-nodes',
      workflowRuntimeJson,
      async (request, response) => {
        try {
          response.status(201).json(await canvasNodeService.createBlueprint(
            request.params.id,
            request.body,
          ));
        } catch (error) {
          sendError(response, error, logger);
        }
      },
    );

    router.post(
      '/workflow-library/:id/canvas-runs',
      workflowRuntimeJson,
      async (request, response) => {
        try {
          response.status(202).json(await canvasNodeService.startRun({
            idempotencyKey: request.get('Idempotency-Key'),
            definitionId: request.params.id,
            request: request.body,
          }));
        } catch (error) {
          sendError(response, error, logger);
        }
      },
    );
  }

  router.use((error, _request, response, next) => {
    if (error?.type === 'entity.too.large') {
      response.status(413).json({
        error: '工作流运行请求体超过大小限制',
        code: 'WORKFLOW_RUNTIME_REQUEST_SIZE_LIMIT',
      });
      return;
    }
    if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
      response.status(400).json({
        error: '请求 JSON 格式无效',
        code: 'INVALID_REQUEST_JSON',
      });
      return;
    }
    next(error);
  });

  return router;
}

export const WORKFLOW_RUNTIME_ERRORS = Object.freeze({
  WorkflowBindingError,
  WorkflowConfigurationError,
});
