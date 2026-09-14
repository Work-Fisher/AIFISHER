import { classifyMedia, uploadMediaFile } from '../media/canvasMediaTransport';
import type * as React from 'react';
import { isAgentDocument } from '../../shared/agentDocumentFormats.js';
import { readAgentDocument, type AgentDocument } from './agentDocuments';
import {
  readAgentImage,
  type AgentReference,
} from './canvasAgentAttachments';
type Runtime = Pick<typeof React, 'useState' | 'useEffect' | 'useRef' | 'useLayoutEffect'>;
export function useCanvasAgentReferences(
  React: Runtime,
  isOpen: boolean,
  selected: readonly { nodeId: string; url: string; type?: AgentReference['type'] }[],
  projectId?: string,
) {
  const [manual, setManual] = React.useState<AgentReference[]>([]);
  const [documents, setDocuments] = React.useState<AgentDocument[]>([]);
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const requestsRef = React.useRef(new Set<AbortController>());
  const busyRef = React.useRef(false);
  const aliveRef = React.useRef(false);
  const selectionKey = JSON.stringify(selected.map(({ nodeId, url }) => [nodeId, url]));
  const references = manual;
  const latestRef = React.useRef(references);
  React.useLayoutEffect(() => {
    latestRef.current = references;
  }, [references]);
  const seenSelectionRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!isOpen) return;
    const previous = seenSelectionRef.current;
    seenSelectionRef.current = new Set(selected.map(item => item.nodeId));
    if (busyRef.current) return;
    const added = selected.filter(item => !previous.has(item.nodeId) && !latestRef.current.some(ref => ref.nodeId === item.nodeId));
    if (!added.length) return;
    const next = [...latestRef.current, ...added.map(item => ({ ...item, type: item.type || 'image' as const }))];
    latestRef.current = next;
    setManual(next);
  }, [isOpen, selected, selectionKey]);
  const cancel = () => {
    for (const request of requestsRef.current) request.abort();
    requestsRef.current.clear();
    busyRef.current = false;
  };
  React.useEffect(() => {
    aliveRef.current = isOpen;
    setPending(false);
    return () => {
      aliveRef.current = false;
      cancel();
    };
  }, [isOpen]);
  const clear = () => {
    cancel();
    latestRef.current = [];
    setPending(false);
    setManual([]);
    setDocuments([]);

    setError('');
  };
  const readFiles = async (files: readonly File[]) => {
    if (!aliveRef.current || busyRef.current) return;
    const accepted = files;
    if (!accepted.length) {
      setError('请选择图片、视频、音频或文本文件（Word DOCX、TXT、Markdown 等）。');
      return;
    }
    busyRef.current = true;
    setPending(true);
    setError('');
    const controller = new AbortController();
    requestsRef.current.add(controller);
    try {
      const added: AgentReference[] = [];
      const addedDocuments: AgentDocument[] = [];
      for (const file of accepted) {
        if (isAgentDocument(file.name)) { addedDocuments.push(await readAgentDocument(file, controller.signal)); continue; }
        if (/\.doc$/i.test(file.name)) throw new Error('旧版 Word DOC 请先另存为 DOCX 后上传。');
        const type = classifyMedia(file);
        const media = type === 'image' ? await readAgentImage(file, controller.signal) : { url: await uploadMediaFile(file, projectId, undefined, controller.signal) };
        added.push({ nodeId: `local-${crypto.randomUUID()}`, type, ...media });
      }
      if (aliveRef.current && !controller.signal.aborted) {
        latestRef.current = [...latestRef.current, ...added];
        setManual((current) => [...current, ...added]);
        setDocuments(current => [...current, ...addedDocuments]);
      }
    } catch (reason) {
      if (aliveRef.current && !controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : '图片读取失败，请重试。');
    } finally {
      requestsRef.current.delete(controller);
      if (!controller.signal.aborted) {
        busyRef.current = false;
        if (aliveRef.current) setPending(false);
      }
    }
  };
  const prepare = async (): Promise<AgentReference[] | null> => {
    if (!aliveRef.current || busyRef.current) return null;
    const snapshot = latestRef.current;
    busyRef.current = true;
    setPending(true);
    setError('');
    const controller = new AbortController();
    requestsRef.current.add(controller);
    try {
      const prepared: AgentReference[] = [];
      for (const reference of snapshot) {
        if (reference.type !== 'image') { prepared.push(reference); continue; }
        const image = reference.base64
          ? reference
          : await readAgentImage(reference.url, controller.signal);
        prepared.push({ ...reference, base64: image.base64 });
      }
      return aliveRef.current && !controller.signal.aborted ? prepared : null;
    } catch (reason) {
      if (aliveRef.current && !controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : '参考图片读取失败，请重试。');
      return null;
    } finally {
      requestsRef.current.delete(controller);
      if (!controller.signal.aborted) {
        busyRef.current = false;
        if (aliveRef.current) setPending(false);
      }
    }
  };
  return {
    references,
    documents,
    removeDocument(id: string) { if (!busyRef.current) setDocuments(current => current.filter(document => document.id !== id)); },
    pending,
    error,
    prepare,
    clear,
    cancel() {
      cancel();
      setPending(false);
    },
    readFiles,
    remove(nodeId: string) {
      if (busyRef.current) return;
      latestRef.current = latestRef.current.filter((item) => item.nodeId !== nodeId);
      setManual((current) => current.filter((item) => item.nodeId !== nodeId));

    },
    add(reference: AgentReference) {
      if (!aliveRef.current || busyRef.current) return;
      if (latestRef.current.some((item) => item.nodeId === reference.nodeId)) return;
      latestRef.current = [...latestRef.current, reference];
      setManual((current) => [...current, reference]);

    },
  };
}
