export type NodeType = 'text' | 'image' | 'video' | 'audio' | (string & {});

export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  parentIds?: string[];
  groupId?: string;
  title?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface CanvasGroup {
  id: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface WorkflowSummary {
  id: string;
  title: string;
  revision?: number;
  status: string;
  folderId: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
}

export interface Workflow extends WorkflowSummary {
  revision: number;
  nodes: CanvasNode[];
  groups: CanvasGroup[];
  [key: string]: unknown;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export type AssetKind = 'images' | 'videos' | 'audios';

export interface AssetRecord {
  id: string;
  type: AssetKind;
  url: string;
  filename?: string;
  prompt?: string;
  favorite?: boolean;
  [key: string]: unknown;
}

export type GenerationStatus = 'idle' | 'queued' | 'loading' | 'success' | 'error';

export interface GenerationTask {
  nodeId: string;
  status: GenerationStatus;
  progress?: number;
  resultUrl?: string;
  error?: string;
  [key: string]: unknown;
}

export interface AppSettings {
  apiBaseUrl: string;
  [key: string]: unknown;
}
