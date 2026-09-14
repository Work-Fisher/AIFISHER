import { sha256Json } from './workflowFormat.js';

const PRODUCT_MAXIMUMS = Object.freeze({ image: 9, video: 3, audio: 3 });
export const DYNAMIC_ASSET_LOADER_CLASSES = Object.freeze([
  'LoadImage',
  'LoadAudio',
  'VHS_LoadVideo',
  'LoadVideo',
]);
const EXTENDABLE_LOADERS = new Set([
  'LoadImage:image:image',
  'LoadAudio:audio:audio',
  'LoadVideo:video:video',
  'VHS_LoadVideo:video:video',
]);

function isConnection(value) {
  return Array.isArray(value)
    && value.length === 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && Number.isInteger(value[1])
    && value[1] >= 0;
}

function autogrowSpecifications(definition) {
  const result = [];
  for (const [groupName, specification] of Object.entries(definition?.input?.optional || {})) {
    if (!Array.isArray(specification) || specification[0] !== 'COMFY_AUTOGROW_V3') continue;
    const options = specification[1];
    const template = options?.template;
    const child = Object.entries(template?.input?.required || {})[0];
    if (!child || typeof template?.prefix !== 'string' || !template.prefix) continue;
    const maximum = Number(template.max);
    const minimum = Number(template.min);
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) continue;
    result.push({
      groupName,
      prefix: template.prefix,
      childName: child[0],
      childType: Array.isArray(child[1]) ? String(child[1][0] || '') : '',
      minimum: Number.isInteger(minimum) && minimum >= 0 ? minimum : 0,
      maximum,
    });
  }
  return result;
}

function relationForField(fieldName, specifications) {
  for (const specification of specifications) {
    const prefix = `${specification.groupName}.${specification.prefix}`;
    if (!fieldName.startsWith(prefix)) continue;
    const suffix = fieldName.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    return { ...specification, index: Number(suffix), targetFieldName: fieldName };
  }
  return null;
}

function primaryRelation(relations, mediaKind) {
  if (mediaKind === 'video') {
    return relations.find((relation) => relation.childType === 'IMAGE') || relations[0];
  }
  const expectedType = mediaKind === 'audio' ? 'AUDIO' : 'IMAGE';
  return relations.find((relation) => relation.childType === expectedType) || relations[0];
}

function branchShape(node, assetFieldName) {
  return JSON.stringify({
    classType: node.class_type,
    inputs: Object.keys(node.inputs || {}).filter((fieldName) => fieldName !== assetFieldName).sort(),
  });
}

function defaultInputValue(specification) {
  if (!Array.isArray(specification)) return undefined;
  const type = specification[0];
  const options = specification[1];
  if (options && typeof options === 'object' && Object.hasOwn(options, 'default')) {
    return options.default;
  }
  if (Array.isArray(type)) return type[0];
  if (type === 'BOOLEAN') return false;
  if (type === 'INT' || type === 'FLOAT' || type === 'NUMBER') return 0;
  if (type === 'STRING') return '';
  return undefined;
}

function syntheticVideoTemplate(nodeDefinitions) {
  for (const classType of ['VHS_LoadVideo', 'LoadVideo']) {
    const definition = nodeDefinitions?.[classType];
    const required = definition?.input?.required;
    const output = Array.isArray(definition?.output) ? definition.output : [];
    const imageOutputIndex = output.indexOf('IMAGE');
    const audioOutputIndex = output.indexOf('AUDIO');
    if (!required?.video || imageOutputIndex < 0 || audioOutputIndex < 0) continue;
    const inputs = Object.create(null);
    let complete = true;
    for (const [fieldName, specification] of Object.entries(required)) {
      const value = fieldName === 'video'
        ? '__FISHERAI_RUNTIME_UPLOAD__'
        : defaultInputValue(specification);
      if (value === undefined) {
        complete = false;
        break;
      }
      inputs[fieldName] = value;
    }
    if (!complete) continue;
    return {
      sourceClassType: classType,
      assetFieldName: 'video',
      node: { class_type: classType, inputs },
      outputIndices: { image: imageOutputIndex, audio: audioOutputIndex },
    };
  }
  return null;
}

export function deriveVariableAssetGroupCandidates({
  executionPlan,
  nodeDefinitions,
  candidates,
}) {
  const assetCandidateByNode = new Map();
  const candidateOrder = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  for (const candidate of candidates) {
    if (candidate.control !== 'asset') continue;
    const existing = assetCandidateByNode.get(String(candidate.nodeId));
    if (existing) {
      assetCandidateByNode.set(String(candidate.nodeId), null);
    } else {
      assetCandidateByNode.set(String(candidate.nodeId), candidate);
    }
  }

  const allConsumers = new Map();
  const relationsBySource = new Map();
  for (const [targetNodeId, targetNode] of Object.entries(executionPlan)) {
    const specifications = autogrowSpecifications(nodeDefinitions?.[targetNode.class_type]);
    for (const [fieldName, value] of Object.entries(targetNode.inputs || {})) {
      if (!isConnection(value)) continue;
      const sourceNodeId = String(value[0]);
      allConsumers.set(sourceNodeId, [...(allConsumers.get(sourceNodeId) || []), {
        targetNodeId: String(targetNodeId),
        targetFieldName: fieldName,
        outputIndex: value[1],
      }]);
      const relation = relationForField(fieldName, specifications);
      if (!relation) continue;
      relationsBySource.set(sourceNodeId, [...(relationsBySource.get(sourceNodeId) || []), {
        ...relation,
        targetNodeId: String(targetNodeId),
        targetClassType: targetNode.class_type,
        targetTitle: targetNode._meta?.title || targetNode.class_type,
        outputIndex: value[1],
      }]);
    }
  }

  const buckets = new Map();
  for (const [sourceNodeId, relations] of relationsBySource) {
    const candidate = assetCandidateByNode.get(sourceNodeId);
    const sourceNode = executionPlan[sourceNodeId];
    if (!candidate || !sourceNode) continue;
    if (Object.values(sourceNode.inputs || {}).some(isConnection)) continue;
    const consumers = allConsumers.get(sourceNodeId) || [];
    if (
      consumers.length !== relations.length
      || consumers.some((consumer) => !relations.some((relation) =>
        relation.targetNodeId === consumer.targetNodeId
        && relation.targetFieldName === consumer.targetFieldName
        && relation.outputIndex === consumer.outputIndex))
    ) continue;
    const targetIds = new Set(relations.map((relation) => relation.targetNodeId));
    const indices = new Set(relations.map((relation) => relation.index));
    if (targetIds.size !== 1 || indices.size !== 1) continue;
    const mediaKind = candidate.mediaKind;
    if (!Object.hasOwn(PRODUCT_MAXIMUMS, mediaKind)) continue;
    const targetNodeId = relations[0].targetNodeId;
    const key = `${targetNodeId}:${mediaKind}`;
    const bucket = buckets.get(key) || {
      targetNodeId,
      targetClassType: relations[0].targetClassType,
      targetTitle: relations[0].targetTitle,
      mediaKind,
      branches: [],
    };
    bucket.branches.push({
      index: relations[0].index,
      sourceNodeId,
      sourceClassType: sourceNode.class_type,
      assetFieldName: candidate.fieldName,
      candidateId: candidate.id,
      shape: branchShape(sourceNode, candidate.fieldName),
      connections: relations.map((relation) => ({
        groupName: relation.groupName,
        prefix: relation.prefix,
        targetFieldName: relation.targetFieldName,
        outputIndex: relation.outputIndex,
        minimum: relation.minimum,
        maximum: relation.maximum,
        childType: relation.childType,
      })),
    });
    buckets.set(key, bucket);
  }

  const replacements = new Map();
  const consumedCandidateIds = new Set();
  for (const bucket of buckets.values()) {
    bucket.branches.sort((left, right) => left.index - right.index);
    if (bucket.branches.some((branch, index) => branch.index !== index)) continue;
    if (new Set(bucket.branches.map((branch) => branch.shape)).size !== 1) continue;
    const firstBranch = bucket.branches[0];
    const primary = primaryRelation(firstBranch.connections, bucket.mediaKind);
    if (!primary) continue;
    const specificationMaximum = Math.min(
      ...firstBranch.connections.map((connection) => connection.maximum),
    );
    const extendable = EXTENDABLE_LOADERS.has(
      `${firstBranch.sourceClassType}:${firstBranch.assetFieldName}:${bucket.mediaKind}`,
    );
    const maximumItems = Math.min(
      PRODUCT_MAXIMUMS[bucket.mediaKind],
      extendable ? specificationMaximum : bucket.branches.length,
    );
    if (maximumItems < bucket.branches.length) continue;
    const minimumItems = bucket.mediaKind === 'image' ? 1 : 0;
    const id = sha256Json({
      kind: 'variable-asset-group',
      targetNodeId: bucket.targetNodeId,
      targetClassType: bucket.targetClassType,
      groupName: primary.groupName,
      mediaKind: bucket.mediaKind,
    });
    const candidate = {
      id,
      nodeId: bucket.targetNodeId,
      classType: bucket.targetClassType,
      nodeTitle: bucket.targetTitle,
      fieldName: primary.groupName,
      valueType: 'ASSET_GROUP',
      required: minimumItems > 0,
      control: 'asset',
      mediaKind: bucket.mediaKind,
      value: undefined,
      options: [],
      minimum: null,
      maximum: null,
      step: null,
      connected: false,
      confidence: 'high',
      modelKind: null,
      variableAssetGroup: {
        schemaVersion: 1,
        strategy: 'optional-autogrow-direct-loaders',
        targetNodeId: bucket.targetNodeId,
        targetClassType: bucket.targetClassType,
        groupName: primary.groupName,
        mediaKind: bucket.mediaKind,
        minimumItems,
        maximumItems,
        capacity: bucket.branches.length,
        extendable,
        templateSourceNodeId: firstBranch.sourceNodeId,
        branches: bucket.branches.map(({ shape, candidateId, ...branch }) => branch),
      },
    };
    const orderedIds = bucket.branches
      .map((branch) => branch.candidateId)
      .sort((left, right) => candidateOrder.get(left) - candidateOrder.get(right));
    replacements.set(orderedIds[0], candidate);
    orderedIds.forEach((candidateId) => consumedCandidateIds.add(candidateId));
  }

  const additionalCandidates = [];
  const videoTemplate = syntheticVideoTemplate(nodeDefinitions);
  if (videoTemplate) {
    for (const [targetNodeId, targetNode] of Object.entries(executionPlan)) {
      if (buckets.has(`${targetNodeId}:video`)) continue;
      const specifications = autogrowSpecifications(nodeDefinitions?.[targetNode.class_type]);
      const video = specifications.find((specification) => (
        specification.childType === 'IMAGE' && /video/i.test(specification.groupName)
      ));
      const audio = specifications.find((specification) => (
        specification.childType === 'AUDIO' && /video/i.test(specification.groupName)
      ));
      if (!video || !audio) continue;
      const maximumItems = Math.min(PRODUCT_MAXIMUMS.video, video.maximum, audio.maximum);
      if (maximumItems < 1) continue;
      const id = sha256Json({
        kind: 'variable-asset-group',
        targetNodeId,
        targetClassType: targetNode.class_type,
        groupName: video.groupName,
        mediaKind: 'video',
      });
      additionalCandidates.push({
        id,
        nodeId: String(targetNodeId),
        classType: targetNode.class_type,
        nodeTitle: targetNode._meta?.title || targetNode.class_type,
        fieldName: video.groupName,
        valueType: 'ASSET_GROUP',
        required: false,
        control: 'asset',
        mediaKind: 'video',
        value: undefined,
        options: [],
        minimum: null,
        maximum: null,
        step: null,
        connected: false,
        confidence: 'high',
        modelKind: null,
        variableAssetGroup: {
          schemaVersion: 1,
          strategy: 'optional-autogrow-direct-loaders',
          targetNodeId: String(targetNodeId),
          targetClassType: targetNode.class_type,
          groupName: video.groupName,
          mediaKind: 'video',
          minimumItems: 0,
          maximumItems,
          capacity: 0,
          extendable: true,
          templateSourceNodeId: null,
          branches: [],
          syntheticTemplate: {
            sourceClassType: videoTemplate.sourceClassType,
            assetFieldName: videoTemplate.assetFieldName,
            node: videoTemplate.node,
            connections: [
              {
                groupName: video.groupName,
                prefix: video.prefix,
                outputIndex: videoTemplate.outputIndices.image,
              },
              {
                groupName: audio.groupName,
                prefix: audio.prefix,
                outputIndex: videoTemplate.outputIndices.audio,
              },
            ],
          },
        },
      });
    }
  }

  return [...candidates.flatMap((candidate) => {
    const replacement = replacements.get(candidate.id);
    if (replacement) return [replacement];
    return consumedCandidateIds.has(candidate.id) ? [] : [candidate];
  }), ...additionalCandidates];
}
