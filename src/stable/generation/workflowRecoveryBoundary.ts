const MAX_WORKFLOW_NODE_IDS = 4_096;
const workflowNodeIds = new Set<string>();

function normalizeNodeId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) return null;
  if (/[\0\r\n/\\]/.test(value)) return null;
  return value;
}

export function registerWorkflowRecoveryOwner(nodeId: unknown): void {
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return;
  workflowNodeIds.delete(normalized);
  workflowNodeIds.add(normalized);
  while (workflowNodeIds.size > MAX_WORKFLOW_NODE_IDS) {
    const oldest = workflowNodeIds.values().next().value;
    if (typeof oldest !== 'string') break;
    workflowNodeIds.delete(oldest);
  }
}

export function isWorkflowRecoveryRequest(pathname: string): boolean {
  const prefix = '/api/generation-status/';
  if (!pathname.startsWith(prefix)) return false;
  let nodeId: string;
  try {
    nodeId = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return false;
  }
  const normalized = normalizeNodeId(nodeId);
  return normalized !== null && workflowNodeIds.has(normalized);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function pageRequestUrl(input: RequestInfo | URL, page: URL): URL | null {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), page);
    return url.protocol === page.protocol && url.host === page.host ? url : null;
  } catch {
    return null;
  }
}

export function createWorkflowRecoveryFetch(fetchImpl: typeof fetch, pageUrl: string): typeof fetch {
  const page = new URL(pageUrl);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = pageRequestUrl(input, page);
    // The frozen canvas still polls the legacy generation-recovery endpoint for
    // every node whose generic status is `loading`. Workflow nodes have their
    // own receipt-backed recovery state machine; letting both owners run races a
    // valid workflow success against a spurious legacy `failed` response.
    if (url && requestMethod(input, init) === 'GET' && isWorkflowRecoveryRequest(url.pathname)) {
      return new Response(
        JSON.stringify({
          error: '工作流恢复由工作流运行器负责',
          code: 'WORKFLOW_RECOVERY_OWNED',
        }),
        {
          status: 404,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
      );
    }
    return fetchImpl(input, init);
  }) as typeof fetch;
}

/** Installs the boundary as the page fetch before any enhancement starts polling. */
export function installWorkflowRecoveryFetch(windowObject: Window = window): typeof fetch {
  const recoveryFetch = createWorkflowRecoveryFetch(
    windowObject.fetch.bind(windowObject),
    windowObject.location.href,
  );
  windowObject.fetch = recoveryFetch;
  return recoveryFetch;
}

export function clearWorkflowRecoveryOwnersForTests(): void {
  workflowNodeIds.clear();
}
