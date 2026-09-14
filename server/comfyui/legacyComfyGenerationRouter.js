import express from 'express';

export function createLegacyComfyGenerationRouter({
    workflowRegistry,
    modelCallReporter = null,
    comfyProcessController,
    comfyClient,
    saveMediaToFile,
    fetchImpl = fetch
}) {
    const router = express.Router();

// ComfyUI Generation Routes (Unified)
router.post('/api/comfy/:workflowType', async (req, res) => {
    const { workflowType } = req.params;
    const config = workflowRegistry[workflowType];

    if (!config) {
        return res.status(404).json({ error: `Workflow type '${workflowType}' not found` });
    }

    let telemetryCall;
    try {
        const { imageUrl, projectId, ...params } = req.body;

        telemetryCall = modelCallReporter?.begin({
            category: 'workflow',
            mediaType: 'workflow',
            operation: workflowType,
            modelName: config.title || 'ComfyUI workflow',
            modelId: workflowType,
            provider: 'ComfyUIProvider',
            source: 'comfyui_local',
            requestId: req.requestId
        });

        console.log(`[ComfyUI] Processing ${config.title} (${workflowType}): project=${projectId}`);

        // 0. 兜底：本机 ComfyUI 未运行且用户已开启自动启动时先拉起。
        //    未开启自动启动会返回 disabled，保持既有行为不变。
        const launch = await comfyProcessController.ensureReady();
        if (launch.status === 'failed') {
            return res.status(409).json({
                error: launch.message || '本机 ComfyUI 未就绪。',
                code: launch.diagnosticCode,
                actions: launch.actions
            });
        }

        // 1. Prepare workflow with registry handler
        const workflow = await config.handler(comfyClient, {
            imageUrl,
            ...params
        });

        // 2. Queue prompt and wait for result
        let resultUrl = await comfyClient.queuePrompt(workflow, config.timeout || 600000, config.outputNodeId);

        if (!resultUrl) {
            throw new Error(`ComfyUI failed to return a valid result for ${workflowType}`);
        }

        // 3. If projectId is provided, save the result to project's media folder
        if (projectId && resultUrl.startsWith('http')) {
            try {
                console.log(`[ComfyUI] Downloading result for project ${projectId}: ${resultUrl}`);
                const response = await fetchImpl(resultUrl);
                if (!response.ok) throw new Error(`Failed to download result: ${response.statusText}`);

                const contentType = response.headers.get('content-type') || 'image/png';
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

                const saved = saveMediaToFile(dataUrl, projectId, `${config.title} Result`);
                if (saved) {
                    resultUrl = saved.url;
                }
            } catch (saveErr) {
                console.error(`[ComfyUI] Failed to save ${workflowType} result:`, saveErr.message);
            }
        }

        telemetryCall?.success();
        res.json({ url: resultUrl });
    } catch (error) {
        telemetryCall?.fail(error);
        console.error(`[ComfyUI] ${config.title} failed:`, error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

    return router;
}
