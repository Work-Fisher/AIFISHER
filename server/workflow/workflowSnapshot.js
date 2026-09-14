import fs from 'node:fs';
import path from 'node:path';

export function createWorkflowSnapshotWriter({ mediaDirectory }) {
    if (!mediaDirectory) {
        throw new Error('createWorkflowSnapshotWriter requires mediaDirectory');
    }

    return function writeWorkflowSnapshot(workflow) {
        if (!workflow?.id) {
            throw new Error('Missing workflow id when writing project JSON snapshot');
        }

        const now = new Date().toISOString();
        const snapshot = {
            ...workflow,
            id: workflow.id,
            revision: Number(workflow.revision || 0),
            title: workflow.title || 'Untitled',
            nodes: Array.isArray(workflow.nodes) ? workflow.nodes : [],
            groups: Array.isArray(workflow.groups) ? workflow.groups : [],
            viewport: workflow.viewport || { x: 0, y: 0, zoom: 1 },
            isMinimapOpen: typeof workflow.isMinimapOpen === 'boolean' ? workflow.isMinimapOpen : true,
            folderId: workflow.folderId ?? null,
            coverUrl: workflow.coverUrl || null,
            createdAt: workflow.createdAt || now,
            updatedAt: workflow.updatedAt || now,
            source: 'fisherai-project-save'
        };
        const snapshotPath = path.join(mediaDirectory, `${workflow.id}.json`);
        fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
        return snapshotPath;
    };
}
