import express from 'express';

const WORKFLOW_COVER_IMAGE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/iu;

export function normalizeWorkflowCoverUrl(value) {
    const candidate = String(value || '').trim();
    if (!candidate || candidate.length > 2_048 || candidate.includes('\0')) return null;
    try {
        const parsed = new URL(candidate, 'http://aifisher.local');
        if (parsed.origin !== 'http://aifisher.local' || !parsed.pathname.startsWith('/library/')) {
            return null;
        }
        if (!WORKFLOW_COVER_IMAGE.test(parsed.pathname)) return null;
        const segments = decodeURIComponent(parsed.pathname).split('/');
        if (segments.some((segment) => segment === '..')) return null;
        return candidate;
    } catch {
        return null;
    }
}

export function createWorkflowRouter({
    store,
    sanitizeNodes,
    writeSnapshot,
    syncFolderProjectCounts,
    logger = console
}) {
    const router = express.Router();

    const writeLatestSnapshot = async (id) => {
        const workflow = await store.getWorkflowById(id);
        if (workflow) await writeSnapshot(workflow);
        return workflow;
    };

    router.post('/', async (req, res) => {
        try {
            const { createBackup, ...incomingWorkflow } = req.body || {};
            if (Object.hasOwn(incomingWorkflow, 'coverUrl')) {
                incomingWorkflow.coverUrl = normalizeWorkflowCoverUrl(incomingWorkflow.coverUrl);
            }
            if (createBackup && incomingWorkflow.id) {
                const currentWorkflow = await store.getWorkflowById(incomingWorkflow.id);
                const incomingRevision = Number(incomingWorkflow.revision || 0);
                if (currentWorkflow && incomingRevision >= Number(currentWorkflow.revision || 0)) {
                    await store.createWorkflowRecoveryPoint(incomingWorkflow.id, 'manual-save');
                }
            }
            const result = await store.saveWorkflow(incomingWorkflow, { sanitizeNodes });
            await writeLatestSnapshot(result.id);
            await syncFolderProjectCounts();
            res.json({ success: true, id: result.id, revision: result.revision });
        } catch (error) {
            if (error?.code === 'REVISION_CONFLICT') {
                return res.status(409).json({
                    error: '工作流版本冲突，请先刷新最新内容后再保存',
                    code: 'REVISION_CONFLICT',
                    currentRevision: error.currentRevision
                });
            }
            logger.error('Save workflow error:', error);
            res.status(500).json({ error: error?.message || 'Save workflow failed' });
        }
    });

    router.get('/', async (_req, res) => {
        try {
            res.json(await store.listWorkflows());
        } catch (error) {
            logger.error('List workflows error:', error);
            res.status(500).json({ error: error?.message || 'List workflows failed' });
        }
    });

    router.get('/recovery-status', async (_req, res) => {
        try {
            res.json({
                startup: store.getStartupRecoveryReport(),
                quarantine: await store.listWorkflowQuarantine()
            });
        } catch (error) {
            logger.error('Load workflow recovery status error:', error);
            res.status(500).json({ error: error?.message || 'Load recovery status failed' });
        }
    });

    router.put('/:id/rename', async (req, res) => {
        try {
            const workflow = await store.renameWorkflow(req.params.id, req.body?.title);
            if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
            await writeLatestSnapshot(workflow.id);
            res.json({ success: true, title: workflow.title });
        } catch (error) {
            logger.error('Rename workflow error:', error);
            res.status(500).json({ error: error?.message || 'Rename workflow failed' });
        }
    });

    router.put('/:id/move', async (req, res) => {
        try {
            const workflow = await store.moveWorkflow(req.params.id, req.body?.folderId ?? null);
            if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
            await writeLatestSnapshot(workflow.id);
            await syncFolderProjectCounts();
            res.json({ success: true, folderId: workflow.folderId || null });
        } catch (error) {
            logger.error('Move workflow error:', error);
            res.status(500).json({ error: error?.message || 'Move workflow failed' });
        }
    });

    router.put('/:id/cover', async (req, res) => {
        try {
            const coverUrl = normalizeWorkflowCoverUrl(req.body?.coverUrl);
            const updated = await store.updateWorkflowCover(req.params.id, coverUrl);
            if (!updated) return res.status(404).json({ error: 'Workflow not found' });
            await writeLatestSnapshot(req.params.id);
            res.json({ success: true, coverUrl });
        } catch (error) {
            logger.error('Update cover error:', error);
            res.status(500).json({ error: error?.message || 'Update cover failed' });
        }
    });

    router.get('/:id/recovery-points', async (req, res) => {
        try {
            res.json(await store.listWorkflowRecoveryPoints(req.params.id));
        } catch (error) {
            logger.error('List workflow recovery points error:', error);
            res.status(500).json({ error: error?.message || 'List recovery points failed' });
        }
    });

    router.post('/:id/recovery-points/:recoveryPointId/restore', async (req, res) => {
        try {
            const result = await store.restoreWorkflowRecoveryPoint(
                req.params.id,
                req.params.recoveryPointId,
                { sanitizeNodes }
            );
            if (!result) return res.status(404).json({ error: 'Recovery point not found' });
            await writeLatestSnapshot(result.id);
            await syncFolderProjectCounts();
            res.json({ success: true, id: result.id, revision: result.revision });
        } catch (error) {
            const status = error?.code === 'RECOVERY_POINT_CORRUPTED' ? 422 : 500;
            logger.error('Restore workflow recovery point error:', error);
            res.status(status).json({
                error: error?.message || 'Restore recovery point failed',
                code: error?.code || 'RECOVERY_POINT_RESTORE_FAILED'
            });
        }
    });

    router.delete('/:id', async (req, res) => {
        try {
            const deleted = await store.deleteWorkflow(req.params.id);
            if (!deleted) return res.status(404).json({ error: 'Workflow not found' });
            await syncFolderProjectCounts();
            res.json({ success: true });
        } catch (error) {
            logger.error('Delete workflow error:', error);
            res.status(500).json({ error: error?.message || 'Delete workflow failed' });
        }
    });

    router.get('/:id', async (req, res) => {
        try {
            const workflow = await store.getWorkflowById(req.params.id);
            if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
            res.json(workflow);
        } catch (error) {
            logger.error('Load workflow error:', error);
            res.status(500).json({ error: error?.message || 'Load workflow failed' });
        }
    });

    return router;
}
