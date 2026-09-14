export interface CanvasGroupableNode {
  id: string;
  groupId?: string;
  [key: string]: unknown;
}

export interface CanvasGroup {
  id: string;
  nodeIds: string[];
  label: string;
  [key: string]: unknown;
}

export interface CanvasGroupState<
  TNode extends CanvasGroupableNode = CanvasGroupableNode,
  TGroup extends CanvasGroup = CanvasGroup,
> {
  nodes: TNode[];
  groups: TGroup[];
}

export interface GroupCanvasNodesOptions {
  groupId: string;
  label?: string;
}

export interface StableCanvasGroupsAdapter {
  group<TNode extends CanvasGroupableNode, TGroup extends CanvasGroup>(
    state: CanvasGroupState<TNode, TGroup>,
    selectedNodeIds: readonly string[],
    options: GroupCanvasNodesOptions,
  ): CanvasGroupState<TNode, TGroup>;
  ungroup<TNode extends CanvasGroupableNode, TGroup extends CanvasGroup>(
    state: CanvasGroupState<TNode, TGroup>,
    groupId: string,
  ): CanvasGroupState<TNode, TGroup>;
  cleanup<TNode extends CanvasGroupableNode, TGroup extends CanvasGroup>(
    state: CanvasGroupState<TNode, TGroup>,
  ): CanvasGroupState<TNode, TGroup>;
  rename<TGroup extends CanvasGroup>(
    groups: readonly TGroup[],
    groupId: string,
    label: string,
  ): TGroup[];
  getByNodeId<TGroup extends CanvasGroup>(
    groups: readonly TGroup[],
    nodeId: string,
  ): TGroup | undefined;
  getById<TGroup extends CanvasGroup>(
    groups: readonly TGroup[],
    groupId: string,
  ): TGroup | undefined;
  getCommon<TGroup extends CanvasGroup>(
    groups: readonly TGroup[],
    nodeIds: readonly string[],
  ): TGroup | undefined;
  getDiagnostics(): {
    cleanupCalls: number;
    groupCalls: number;
    queryCalls: number;
    renameCalls: number;
    ungroupCalls: number;
  };
}

declare global {
  interface Window {
    __FISHERAI_CANVAS_GROUPS__?: StableCanvasGroupsAdapter;
  }
}

function withoutGroupId<TNode extends CanvasGroupableNode>(node: TNode): TNode {
  const nodeWithoutGroup = { ...node };
  delete nodeWithoutGroup.groupId;
  return nodeWithoutGroup;
}

export function groupCanvasNodes<
  TNode extends CanvasGroupableNode,
  TGroup extends CanvasGroup,
>(
  state: CanvasGroupState<TNode, TGroup>,
  selectedNodeIds: readonly string[],
  options: GroupCanvasNodesOptions,
): CanvasGroupState<TNode, TGroup> {
  const existingNodeIds = new Set(state.nodes.map((node) => node.id));
  const nextNodeIds = [
    ...new Set(selectedNodeIds.filter((nodeId) => existingNodeIds.has(nodeId))),
  ];
  if (nextNodeIds.length < 2) return state;

  const selectedNodeIdSet = new Set(nextNodeIds);
  const collapsedGroupIds = new Set<string>();
  const nextGroups: TGroup[] = [];

  for (const group of state.groups) {
    if (!group.nodeIds.some((nodeId) => selectedNodeIdSet.has(nodeId))) {
      nextGroups.push(group);
      continue;
    }

    const remainingNodeIds = group.nodeIds.filter((nodeId) => !selectedNodeIdSet.has(nodeId));
    if (remainingNodeIds.length >= 2) {
      nextGroups.push({ ...group, nodeIds: remainingNodeIds });
    } else {
      collapsedGroupIds.add(group.id);
    }
  }

  nextGroups.push({
    id: options.groupId,
    nodeIds: nextNodeIds,
    label: options.label ?? 'New Group',
  } as TGroup);

  return {
    groups: nextGroups,
    nodes: state.nodes.map((node) => {
      if (selectedNodeIdSet.has(node.id)) return { ...node, groupId: options.groupId };
      if (node.groupId && collapsedGroupIds.has(node.groupId)) {
        return withoutGroupId(node);
      }
      return node;
    }),
  };
}

export function ungroupCanvasNodes<
  TNode extends CanvasGroupableNode,
  TGroup extends CanvasGroup,
>(
  state: CanvasGroupState<TNode, TGroup>,
  groupId: string,
): CanvasGroupState<TNode, TGroup> {
  if (!state.groups.some((group) => group.id === groupId)) return state;
  return {
    groups: state.groups.filter((group) => group.id !== groupId),
    nodes: state.nodes.map((node) => {
      if (node.groupId !== groupId) return node;
      return withoutGroupId(node);
    }),
  };
}

export function cleanupCanvasGroups<
  TNode extends CanvasGroupableNode,
  TGroup extends CanvasGroup,
>(state: CanvasGroupState<TNode, TGroup>): CanvasGroupState<TNode, TGroup> {
  const invalidGroupIds = new Set(
    state.groups
      .filter(
        (group) => state.nodes.filter((node) => node.groupId === group.id).length < 2,
      )
      .map((group) => group.id),
  );
  if (invalidGroupIds.size === 0) return state;

  return {
    groups: state.groups.filter((group) => !invalidGroupIds.has(group.id)),
    nodes: state.nodes.map((node) => {
      if (!node.groupId || !invalidGroupIds.has(node.groupId)) return node;
      return withoutGroupId(node);
    }),
  };
}

export function renameCanvasGroup<TGroup extends CanvasGroup>(
  groups: readonly TGroup[],
  groupId: string,
  label: string,
): TGroup[] {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group || group.label === label) return groups as TGroup[];
  return groups.map((candidate) =>
    candidate.id === groupId ? { ...candidate, label } : candidate,
  );
}

export function getCanvasGroupByNodeId<TGroup extends CanvasGroup>(
  groups: readonly TGroup[],
  nodeId: string,
): TGroup | undefined {
  return groups.find((group) => group.nodeIds.includes(nodeId));
}

export function getCanvasGroupById<TGroup extends CanvasGroup>(
  groups: readonly TGroup[],
  groupId: string,
): TGroup | undefined {
  return groups.find((group) => group.id === groupId);
}

export function getCommonCanvasGroup<TGroup extends CanvasGroup>(
  groups: readonly TGroup[],
  nodeIds: readonly string[],
): TGroup | undefined {
  if (nodeIds.length === 0) return undefined;
  const firstGroup = getCanvasGroupByNodeId(groups, nodeIds[0]);
  if (!firstGroup) return undefined;
  return nodeIds.every((nodeId) => getCanvasGroupByNodeId(groups, nodeId)?.id === firstGroup.id)
    ? firstGroup
    : undefined;
}

export function installStableCanvasGroups(): StableCanvasGroupsAdapter {
  if (window.__FISHERAI_CANVAS_GROUPS__) return window.__FISHERAI_CANVAS_GROUPS__;
  let cleanupCalls = 0;
  let groupCalls = 0;
  let queryCalls = 0;
  let renameCalls = 0;
  let ungroupCalls = 0;

  const adapter: StableCanvasGroupsAdapter = {
    group(state, selectedNodeIds, options) {
      const nextState = groupCanvasNodes(state, selectedNodeIds, options);
      if (nextState !== state) groupCalls += 1;
      return nextState;
    },
    ungroup(state, groupId) {
      const nextState = ungroupCanvasNodes(state, groupId);
      if (nextState !== state) ungroupCalls += 1;
      return nextState;
    },
    cleanup(state) {
      const nextState = cleanupCanvasGroups(state);
      if (nextState !== state) cleanupCalls += 1;
      return nextState;
    },
    rename(groups, groupId, label) {
      const nextGroups = renameCanvasGroup(groups, groupId, label);
      if (nextGroups !== groups) renameCalls += 1;
      return nextGroups;
    },
    getByNodeId(groups, nodeId) {
      queryCalls += 1;
      return getCanvasGroupByNodeId(groups, nodeId);
    },
    getById(groups, groupId) {
      queryCalls += 1;
      return getCanvasGroupById(groups, groupId);
    },
    getCommon(groups, nodeIds) {
      queryCalls += 1;
      return getCommonCanvasGroup(groups, nodeIds);
    },
    getDiagnostics() {
      return { cleanupCalls, groupCalls, queryCalls, renameCalls, ungroupCalls };
    },
  };

  Object.freeze(adapter);
  window.__FISHERAI_CANVAS_GROUPS__ = adapter;
  return adapter;
}
