import express from 'express';
import fs from 'fs';
import path from 'path';

export function createTosRouter({
    uploadToTos,
    resolveLocalPath,
    getProjectMediaDir,
    generateAssetId,
    saveAssetMetadata,
    getUrlPrefix,
    getTosConfiguration,
    fetchImpl = fetch
}) {
    const router = express.Router();

// 校验 TOS 链接是否仍然有效 (使用 HEAD 请求，极低成本)
router.post('/api/verify-tos-url', async (req, res) => {
    try {
        const { networkUrl } = req.body;
        if (!networkUrl) return res.status(400).json({ error: 'Missing networkUrl' });

        console.log(`  [TOS Verify] Checking: ${networkUrl}`);
        const response = await fetchImpl(networkUrl, { method: 'HEAD' });

        res.json({
            exists: response.ok,
            status: response.status
        });
    } catch (error) {
        console.error('TOS verify error:', error);
        res.status(500).json({ exists: false, error: error.message });
    }
});

// Mount generation routes (image and video generation)
router.post('/api/upload-existing-to-tos', async (req, res) => {
    try {
        const { resultUrl, type } = req.body;

        if (!resultUrl || !type) {
            return res.status(400).json({ error: 'Missing resultUrl or type' });
        }

        // 1. 使用统一工具解析本地文件路径
        const filePath = resolveLocalPath(resultUrl);

        // 如果无法解析为本地路径，且已经是 HTTP URL，则认为它可能已经是外部 URL (如 TOS)
        if (!filePath) {
            if (resultUrl.startsWith('http')) {
                return res.json({ success: true, networkUrl: resultUrl });
            }
            return res.status(400).json({ error: `Invalid or non-local URL: ${resultUrl}` });
        }

        if (!fs.existsSync(filePath)) {
            console.error(`  [TOS Upload] File not found at: ${filePath}`);
            return res.status(404).json({ error: `File not found at ${filePath}` });
        }

        // 2. Read file
        const buffer = fs.readFileSync(filePath);
        const filename = path.basename(filePath);

        console.log(`  [TOS Upload Existing] Uploading ${filename} from ${resultUrl}...`);

        const tosConfig = getTosConfiguration();

        // 3. Upload to TOS
        const networkUrl = await uploadToTos(buffer, filename, tosConfig);

        if (!networkUrl) {
            return res.status(500).json({ error: 'Failed to upload to TOS. Check server logs.' });
        }

        // 4. Update metadata if it exists
        const metadataPath = filePath + '.json';
        if (fs.existsSync(metadataPath)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                metadata.networkUrl = networkUrl;
                fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            } catch (e) {
                console.warn(`  [TOS Upload] Failed to update metadata at ${metadataPath}:`, e.message);
            }
        }

        res.json({
            success: true,
            networkUrl: networkUrl
        });

    } catch (error) {
        console.error('TOS existing upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// ASSET HISTORY API
// ============================================================================

// Upload to TOS (Volcengine) directly - KEEP THIS for new uploads if needed,
// but we will primarily use the one above for existing cards
router.post('/api/upload-tos/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const filename = req.headers['x-filename'] || 'upload.png';
        const projectId = req.headers['x-project-id'];
        const nodeId = req.headers['x-node-id'];

        if (!['images', 'videos', 'audios'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        // 1. Read binary data from request
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // 2. Prepare local saving info first to get a unique filename
        const targetDir = getProjectMediaDir(projectId, type);
        const safeId = generateAssetId(nodeId);
        const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : (type === 'videos' ? 'mp4' : (type === 'audios' ? 'mp3' : 'png'));
        const safeFilename = `${safeId}.${extension}`;
        const filePath = path.join(targetDir, safeFilename);

        // 3. Upload to TOS using the unique safeFilename
        console.log(`  [TOS Upload] Uploading ${safeFilename} (${buffer.length} bytes)...`);

        const tosConfig = getTosConfiguration();

        const networkUrl = await uploadToTos(buffer, safeFilename, tosConfig);

        if (!networkUrl) {
            return res.status(500).json({ error: 'Failed to upload to TOS. Check server logs.' });
        }

        // 4. Also save locally for consistency
        fs.writeFileSync(filePath, buffer);

        // Save metadata
        saveAssetMetadata(targetDir, {
            id: safeId,
            filename: safeFilename,
            nodeId: nodeId,
            prompt: filename,
            type: type,
            model: 'TOS-Upload',
            networkUrl: networkUrl
        });

        const localUrl = projectId
            ? `${getUrlPrefix()}/media/${projectId}/${type}/${safeFilename}`
            : `${getUrlPrefix()}/${type}/${safeFilename}`;

        res.json({
            success: true,
            url: localUrl,
            networkUrl: networkUrl
        });

    } catch (error) {
        console.error('TOS upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

    return router;
}
