import { toBindingSetDto } from './workflowBindingCompiler.js';

function latestBindingDescendant(bindingSets, rootBindingSetId) {
  const byId = new Map(bindingSets.map((item) => [item.id, item]));
  const descendsFromRoot = (candidate) => {
    const visited = new Set();
    let cursor = candidate;
    while (cursor && !visited.has(cursor.id)) {
      if (cursor.id === rootBindingSetId) return true;
      visited.add(cursor.id);
      cursor = cursor.previousBindingSetId ? byId.get(cursor.previousBindingSetId) : undefined;
    }
    return false;
  };
  return [...bindingSets]
    .filter(descendsFromRoot)
    .sort((left, right) => Number(right.revision) - Number(left.revision))[0];
}

export class WorkflowEditorSnapshotService {
  constructor({
    definitionStore,
    configurationStore,
    deploymentService,
    attestationService,
    testRunService,
  }) {
    Object.assign(this, {
      definitionStore,
      configurationStore,
      deploymentService,
      attestationService,
      testRunService,
    });
  }

  async read(definitionId) {
    const definition = await this.definitionStore.requireDefinition(definitionId);
    if (!definition.executionPlan) {
      return {
        definition,
        deployment: null,
        candidates: [],
        bindingSet: null,
        attestation: null,
        verifiedRun: null,
        verifiedOutputCandidates: [],
        outputBindingSet: null,
      };
    }

    const [deployments, storedBindingSets, attestations] = await Promise.all([
      this.deploymentService.listDeployments(definitionId),
      this.configurationStore.listBindingSets(definitionId),
      this.attestationService.listAttestations(definitionId),
    ]);
    const bindingSets = storedBindingSets.map(toBindingSetDto);
    const attestation = attestations.find((item) => (
      item.definitionRevision === definition.revision
      && item.executionPlanHash === definition.executionPlan.executionPlanHash
    )) || null;
    const deployment = (
      attestation
        ? deployments.find((item) => item.id === attestation.deploymentId)
        : deployments[0]
    ) || null;
    const bindingSet = (
      attestation
        ? latestBindingDescendant(bindingSets, attestation.bindingSetId)
          || bindingSets.find((item) => item.id === attestation.bindingSetId)
        : bindingSets.at(-1)
    ) || null;
    const candidates = deployment
      ? await this.deploymentService.listBindingCandidates(definitionId, deployment.id)
      : [];

    let verifiedRun = null;
    let verifiedOutputCandidates = [];
    let outputBindingSet = null;
    if (attestation) {
      const [run, outputBindingSets] = await Promise.all([
        this.testRunService.getRun(attestation.runId).catch(() => null),
        this.attestationService.listOutputBindingSets(definitionId),
      ]);
      outputBindingSet = outputBindingSets.find(
        (item) => item.id === attestation.outputBindingSetId,
      ) || null;
      if (run?.status === 'success') {
        verifiedRun = run;
        verifiedOutputCandidates = await this.attestationService
          .listOutputCandidates(definitionId, attestation.runId)
          .catch(() => []);
      }
    }

    return {
      definition,
      deployment,
      candidates,
      bindingSet,
      attestation,
      verifiedRun,
      verifiedOutputCandidates,
      outputBindingSet,
    };
  }
}
