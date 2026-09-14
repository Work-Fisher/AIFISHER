import express from 'express';

export function createFolderRouter({ store, writeSnapshot, logger = console }) {
    const router = express.Router();

    router.get('/', async (_req, res) => {
        try {
            res.json(await store.listFolders());
        } catch (error) {
            logger.error('List folders error:', error);
            res.status(500).json({ error: error?.message || 'List folders failed' });
        }
    });

    router.post('/', async (req, res) => {
        try {
            const folder = await store.saveFolder(req.body || {});
            await store.syncFolderProjectCounts();
            res.json(await store.getFolderById(folder.id));
        } catch (error) {
            logger.error('Save folder error:', error);
            res.status(500).json({ error: error?.message || 'Save folder failed' });
        }
    });

    router.delete('/:id', async (req, res) => {
        try {
            const folder = await store.getFolderById(req.params.id);
            if (!folder) return res.status(404).json({ error: 'Folder not found' });

            const affectedWorkflowIds = await store.clearFolderReferences(req.params.id);
            await store.deleteFolder(req.params.id);
            await store.syncFolderProjectCounts();

            for (const workflowId of affectedWorkflowIds) {
                const workflow = await store.getWorkflowById(workflowId);
                if (workflow) await writeSnapshot(workflow);
            }

            res.json({ success: true });
        } catch (error) {
            logger.error('Delete folder error:', error);
            res.status(500).json({ error: error?.message || 'Delete folder failed' });
        }
    });

    return router;
}
