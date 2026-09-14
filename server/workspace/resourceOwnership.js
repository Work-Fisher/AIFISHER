const RESOURCE_OWNERSHIP = Object.freeze([
  Object.freeze({ id: 'application-files', ownership: 'global', location: 'app/**' }),
  Object.freeze({ id: 'public-shell', ownership: 'global', location: 'app/public/**' }),
  Object.freeze({ id: 'model-files', ownership: 'global', location: 'app/models/**' }),
  Object.freeze({ id: 'integration-adapters', ownership: 'global', location: 'app/integrations/**' }),
  Object.freeze({ id: 'device-runtime-config', ownership: 'global', location: 'data/global/device/**' }),
  Object.freeze({ id: 'launchers-and-runtime', ownership: 'global', location: 'app/bin/** + data/run/**' }),
  Object.freeze({ id: 'redacted-operational-logs', ownership: 'global', location: 'data/logs/**' }),
  Object.freeze({
    id: 'identity-database',
    ownership: 'global-row-scoped',
    location: 'identity PostgreSQL',
  }),

  Object.freeze({ id: 'projects', ownership: 'user', location: 'users/<id>/library/workflows.db' }),
  Object.freeze({ id: 'workflow-recovery', ownership: 'user', location: 'users/<id>/library/.workflow-*' }),
  Object.freeze({ id: 'media', ownership: 'user', location: 'users/<id>/library/media/**' }),
  Object.freeze({ id: 'prompts', ownership: 'user', location: 'users/<id>/library/prompts/**' }),
  Object.freeze({ id: 'agent-sessions', ownership: 'user', location: 'users/<id>/library/agent/**' }),
  Object.freeze({ id: 'agent-skills', ownership: 'user', location: 'users/<id>/private/agent-skills/**' }),
  Object.freeze({
    id: 'execution-workflows',
    ownership: 'user',
    location: 'users/<id>/private/execution-workflows/**',
  }),
  Object.freeze({
    id: 'generation-snapshots',
    ownership: 'user',
    location: 'users/<id>/private/execution-workflows/**/input-snapshots/**',
  }),
  Object.freeze({
    id: 'generation-task-journal',
    ownership: 'user',
    location: 'users/<id>/private/generation/generation-tasks.json',
  }),
  Object.freeze({
    id: 'provider-credentials',
    ownership: 'user',
    location: 'users/<id>/private/provider-credentials.dpapi',
  }),
  Object.freeze({
    id: 'provider-settings',
    ownership: 'user',
    location: 'users/<id>/config/providers.env',
  }),
  Object.freeze({
    id: 'yjs-history',
    ownership: 'user',
    location: 'users/<id>/library/collab/yjs-updates.db',
  }),

  Object.freeze({ id: 'uploads', ownership: 'temporary', location: 'users/<id>/tmp/uploads/**' }),
  Object.freeze({
    id: 'output-staging',
    ownership: 'temporary',
    location: 'users/<id>/tmp/output-staging/**',
  }),
  Object.freeze({ id: 'atomic-write-temp', ownership: 'temporary', location: '**/.tmp-*' }),
  Object.freeze({ id: 'derived-caches', ownership: 'temporary', location: 'users/<id>/cache/**' }),
  Object.freeze({ id: 'migration-staging', ownership: 'temporary', location: 'users/.migration-*' }),
]);

// Cross-user resources are addressable only through these logical identifiers.
// A filesystem path supplied by a client is never a shared-resource capability.
export const DEFAULT_SHARED_RESOURCE_ALLOWLIST = Object.freeze({
  'public-shell': 'public-shell',
  'model-files': 'models',
  'integration-adapters': 'integrations',
  'device-runtime-config': 'device',
});

export function listResourceOwnership() {
  return RESOURCE_OWNERSHIP.map((resource) => ({ ...resource }));
}

export function getResourceOwnership(resourceId) {
  const resource = RESOURCE_OWNERSHIP.find((candidate) => candidate.id === resourceId);
  return resource ? { ...resource } : null;
}

export function assertResourceOwnershipCoverage() {
  const required = new Set(['global', 'global-row-scoped', 'user', 'temporary']);
  for (const resource of RESOURCE_OWNERSHIP) required.delete(resource.ownership);
  if (required.size > 0) {
    throw new Error(`RESOURCE_OWNERSHIP_INCOMPLETE:${[...required].join(',')}`);
  }
  return true;
}
