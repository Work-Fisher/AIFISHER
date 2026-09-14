import express from 'express';
import path from 'node:path';
import { createWorkflowLibraryRouter } from './workflowLibraryRouter.js';
import { WorkflowDefinitionStore } from './workflowDefinitionStore.js';
import { WorkflowConfigurationStore } from './workflowConfigurationStore.js';
import { WorkflowDeploymentService } from './workflowDeploymentService.js';
import {
    recoverWorkflowAssetSnapshots,
    WorkflowAssetResolver
} from './workflowAssetResolver.js';
import { createWorkflowRuntimeRouter } from './workflowRuntimeRouter.js';
import { WorkflowRunStore } from './workflowRunStore.js';
import { LocalComfyExecutor } from './localComfyExecutor.js';
import { RunningHubWorkflowExecutor } from './runningHubWorkflowExecutor.js';
import { RunningHubWebAppLibraryService } from './runningHubWebAppLibraryService.js';
import { createRunningHubWebAppRouter } from './runningHubWebAppRouter.js';
import { WorkflowTestRunService } from './workflowTestRunService.js';
import { WorkflowAttestationService } from './workflowAttestationService.js';
import { WorkflowEditorSnapshotService } from './workflowEditorSnapshotService.js';
import { WorkflowCanvasNodeService } from './workflowCanvasNodeService.js';
import { DirectoryGrantStore } from './directoryGrantStore.js';
import { recoverWorkflowOutputStaging } from './workflowOutputLocalizer.js';

// The execution-workflow domain owns its adapters, private stores and recovery
// order. Routers are exposed only after recovery completes, never partially ready.
export async function createExecutionWorkflowRuntime({ libraryDirectory, privateDirectory, generationRuntime }) {
  const executionWorkflowStorageDirectory = path.join(
      privateDirectory,
      'execution-workflows'
  );
  const workflowDefinitionStore = new WorkflowDefinitionStore({
      libraryDirectory: libraryDirectory,
      storageDirectory: executionWorkflowStorageDirectory
  });
  const workflowConfigurationStore = new WorkflowConfigurationStore({
      libraryDirectory: libraryDirectory,
      storageDirectory: executionWorkflowStorageDirectory
  });
  const workflowDirectoryGrantStore = new DirectoryGrantStore({
      libraryDirectory: libraryDirectory,
      storageDirectory: executionWorkflowStorageDirectory
  });
  const resolveRunningHubWorkflowCredential = (reference) => {
      if (reference === 'runninghub-cn') return process.env.RUNNINGHUB_API_KEY;
      if (reference === 'runninghub-global') return process.env.RUNNINGHUB_GLOBAL_API_KEY;
      return null;
  };
  const workflowDeploymentService = new WorkflowDeploymentService({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      directoryGrantStore: workflowDirectoryGrantStore,
      credentialResolver: resolveRunningHubWorkflowCredential
  });
  const runningHubWebAppLibraryService = new RunningHubWebAppLibraryService({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      deploymentService: workflowDeploymentService,
      credentialResolver: resolveRunningHubWorkflowCredential
  });
  const workflowAssetResolver = new WorkflowAssetResolver({
      libraryDirectory: libraryDirectory,
      snapshotRoot: path.join(executionWorkflowStorageDirectory, 'input-snapshots')
  });
  const workflowRunStore = new WorkflowRunStore({
      libraryDirectory: libraryDirectory,
      storageDirectory: executionWorkflowStorageDirectory
  });
  await workflowRunStore.recoverReservedAdmissions(generationRuntime.journal);
  await workflowRunStore.recoverPendingReceipts(generationRuntime.journal);
  await recoverWorkflowAssetSnapshots(path.join(workflowRunStore.rootDirectory, 'input-snapshots'));
  await recoverWorkflowOutputStaging({
      stagingDirectory: path.join(workflowRunStore.rootDirectory, 'output-staging'),
      libraryDirectory: libraryDirectory,
      runStore: workflowRunStore
  });
  const localComfyExecutor = new LocalComfyExecutor({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      deploymentService: workflowDeploymentService,
      assetResolver: workflowAssetResolver,
      runStore: workflowRunStore,
      coordinator: generationRuntime.coordinator,
      directoryGrantStore: workflowDirectoryGrantStore,
      libraryDirectory: libraryDirectory
  });
  const runningHubWorkflowExecutor = new RunningHubWorkflowExecutor({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      deploymentService: workflowDeploymentService,
      assetResolver: workflowAssetResolver,
      runStore: workflowRunStore,
      coordinator: generationRuntime.coordinator,
      libraryDirectory: libraryDirectory,
      credentialResolver: resolveRunningHubWorkflowCredential
  });
  const workflowTestRunService = new WorkflowTestRunService({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      runStore: workflowRunStore,
      coordinator: generationRuntime.coordinator,
      executor: localComfyExecutor,
      executors: [
          ['local-comfyui', localComfyExecutor],
          ['runninghub-workflow', runningHubWorkflowExecutor],
          ['runninghub-webapp', runningHubWorkflowExecutor]
      ]
  });
  await workflowTestRunService.reconcileTerminalInputCleanup(generationRuntime.journal);
  workflowTestRunService.recoverInterruptedTasks(generationRuntime.journal);
  // adopt() can immediately terminalize an already-expired recovery task. A
  // second pass closes its pending input ledger without waiting for another restart.
  await workflowTestRunService.reconcileTerminalInputCleanup(generationRuntime.journal);
  const workflowAttestationService = new WorkflowAttestationService({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      runStore: workflowRunStore
  });
  const workflowEditorSnapshotService = new WorkflowEditorSnapshotService({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      deploymentService: workflowDeploymentService,
      attestationService: workflowAttestationService,
      testRunService: workflowTestRunService
  });
  const workflowCanvasNodeService = new WorkflowCanvasNodeService({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      runStore: workflowRunStore,
      deploymentService: workflowDeploymentService,
      testRunService: workflowTestRunService
  });


  const router = express.Router();
  router.use('/api', createWorkflowLibraryRouter({
      libraryDirectory,
      storageDirectory: executionWorkflowStorageDirectory,
      definitionStore: workflowDefinitionStore,
      directoryGrantStore: workflowDirectoryGrantStore
  }));
  router.use('/api', createWorkflowRuntimeRouter({
      definitionStore: workflowDefinitionStore,
      configurationStore: workflowConfigurationStore,
      deploymentService: workflowDeploymentService,
      editorSnapshotService: workflowEditorSnapshotService,
      assetResolver: workflowAssetResolver,
      testRunService: workflowTestRunService,
      attestationService: workflowAttestationService,
      canvasNodeService: workflowCanvasNodeService
  }));
  router.use('/api', createRunningHubWebAppRouter({
      service: runningHubWebAppLibraryService
  }));

  return {
    router,
    services: {
      runningHubLibraryService: runningHubWebAppLibraryService,
      configurationStore: workflowConfigurationStore,
      workflowCanvasNodeService,
      testRunService: workflowTestRunService,
      runStore: workflowRunStore,
    },
  };
}
