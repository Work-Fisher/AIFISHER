export type MidjourneyReferenceRole = 'cref' | 'sref' | 'dref';

export interface MidjourneyReferenceRoleDefinition {
  key: MidjourneyReferenceRole;
  label: string;
  description: string;
}

export interface MidjourneyReferenceNode {
  id: string;
  type: string;
  title?: unknown;
  prompt?: unknown;
  resultUrl?: unknown;
  networkUrl?: unknown;
  parentIds?: string[];
  midjourneyReferenceNodeIds?: Partial<Record<MidjourneyReferenceRole, string>>;
  [key: string]: unknown;
}

export type MidjourneyReferenceAssignments = Partial<Record<MidjourneyReferenceRole, string>>;
export type MidjourneyReferencePayload = Partial<Record<MidjourneyReferenceRole, string>>;

export const MIDJOURNEY_REFERENCE_ROLES: readonly MidjourneyReferenceRoleDefinition[] = [
  { key: 'cref', label: '角色参考', description: '保持人物或角色特征' },
  { key: 'sref', label: '风格参考', description: '迁移色彩、材质与视觉风格' },
  { key: 'dref', label: '深度参考', description: '参考画面的空间与景深关系' },
];

const ROLE_KEYS = MIDJOURNEY_REFERENCE_ROLES.map((role) => role.key);

function isImageNode(node: MidjourneyReferenceNode): boolean {
  return ['image', 'upload image'].includes(String(node.type || '').toLowerCase());
}

function imageNodes(nodes: readonly MidjourneyReferenceNode[]): MidjourneyReferenceNode[] {
  return nodes.filter((node) => typeof node.id === 'string' && isImageNode(node));
}

export function sanitizeMidjourneyReferenceAssignments(
  assignments: MidjourneyReferenceAssignments | null | undefined,
  connectedNodes: readonly MidjourneyReferenceNode[],
): MidjourneyReferenceAssignments {
  const connectedIds = new Set(imageNodes(connectedNodes).map((node) => node.id));
  const used = new Set<string>();
  const sanitized: MidjourneyReferenceAssignments = {};
  for (const role of ROLE_KEYS) {
    const nodeId = assignments?.[role];
    if (!nodeId || !connectedIds.has(nodeId) || used.has(nodeId)) continue;
    sanitized[role] = nodeId;
    used.add(nodeId);
  }
  return sanitized;
}

export function assignMidjourneyReference(
  assignments: MidjourneyReferenceAssignments | null | undefined,
  connectedNodes: readonly MidjourneyReferenceNode[],
  role: MidjourneyReferenceRole,
  nodeId: string | null | undefined,
): MidjourneyReferenceAssignments {
  const next = sanitizeMidjourneyReferenceAssignments(assignments, connectedNodes);
  const normalizedNodeId = String(nodeId || '').trim();
  delete next[role];
  if (!normalizedNodeId) return next;
  for (const candidateRole of ROLE_KEYS) {
    if (next[candidateRole] === normalizedNodeId) delete next[candidateRole];
  }
  const connectedIds = new Set(imageNodes(connectedNodes).map((node) => node.id));
  if (connectedIds.has(normalizedNodeId)) next[role] = normalizedNodeId;
  return next;
}

function referenceUrl(node: MidjourneyReferenceNode | undefined): string | undefined {
  if (!node || !isImageNode(node)) return undefined;
  const value = typeof node.networkUrl === 'string' && node.networkUrl.trim()
    ? node.networkUrl
    : node.resultUrl;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function resolveMidjourneyReferencePayload(
  node: MidjourneyReferenceNode,
  nodes: readonly MidjourneyReferenceNode[],
): MidjourneyReferencePayload | null {
  const parents = new Set(Array.isArray(node.parentIds) ? node.parentIds : []);
  const connected = imageNodes(nodes).filter((candidate) => parents.has(candidate.id));
  const assignments = sanitizeMidjourneyReferenceAssignments(
    node.midjourneyReferenceNodeIds,
    connected,
  );
  const byId = new Map(connected.map((candidate) => [candidate.id, candidate]));
  const payload: MidjourneyReferencePayload = {};
  for (const role of ROLE_KEYS) {
    const value = referenceUrl(byId.get(assignments[role] || ''));
    if (value) payload[role] = value;
  }
  return Object.keys(payload).length ? payload : null;
}

export interface MidjourneyReferenceAdapter {
  roles: readonly MidjourneyReferenceRoleDefinition[];
  assignments(
    node: MidjourneyReferenceNode,
    connectedNodes: readonly MidjourneyReferenceNode[],
  ): MidjourneyReferenceAssignments;
  assign(
    node: MidjourneyReferenceNode,
    connectedNodes: readonly MidjourneyReferenceNode[],
    role: MidjourneyReferenceRole,
    nodeId: string | null | undefined,
  ): MidjourneyReferenceAssignments;
  resolve(
    node: MidjourneyReferenceNode,
    nodes: readonly MidjourneyReferenceNode[],
  ): MidjourneyReferencePayload | null;
}

declare global {
  interface Window {
    __FISHERAI_MIDJOURNEY_REFERENCES__?: MidjourneyReferenceAdapter;
  }
}

export function installMidjourneyReferenceAdapter(
  target: Window = window,
): MidjourneyReferenceAdapter {
  if (target.__FISHERAI_MIDJOURNEY_REFERENCES__) {
    return target.__FISHERAI_MIDJOURNEY_REFERENCES__;
  }
  const adapter: MidjourneyReferenceAdapter = Object.freeze({
    roles: MIDJOURNEY_REFERENCE_ROLES,
    assignments(
      node: MidjourneyReferenceNode,
      connectedNodes: readonly MidjourneyReferenceNode[],
    ) {
      return sanitizeMidjourneyReferenceAssignments(node.midjourneyReferenceNodeIds, connectedNodes);
    },
    assign(
      node: MidjourneyReferenceNode,
      connectedNodes: readonly MidjourneyReferenceNode[],
      role: MidjourneyReferenceRole,
      nodeId: string | null | undefined,
    ) {
      return assignMidjourneyReference(
        node.midjourneyReferenceNodeIds,
        connectedNodes,
        role,
        nodeId,
      );
    },
    resolve: resolveMidjourneyReferencePayload,
  });
  target.__FISHERAI_MIDJOURNEY_REFERENCES__ = adapter;
  return adapter;
}
