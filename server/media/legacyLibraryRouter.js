import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';

export function createLegacyLibraryRouter({
    baseLibraryDirectory,
    libraryAssetsDirectory,
    publicDirectory,
    getProjectMediaDir,
    generateAssetId,
    saveAssetMetadata,
    resolveLocalPath,
    getUrlPrefix
}) {
    const router = express.Router();
    const LIBRARY_ASSETS_DIR = libraryAssetsDirectory;
    const LIBRARY_WORKFLOWS_DIR = path.join(baseLibraryDirectory, 'workflows');
    for (const directory of [LIBRARY_ASSETS_DIR, LIBRARY_WORKFLOWS_DIR]) {
        if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    }

// --- Library Assets API ---

const LIBRARY_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const LIBRARY_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);
const LIBRARY_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac']);

function sanitizeAssetFileName(name) {
    const safeName = String(name || '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '');
    return safeName || 'asset';
}

function encodeLibraryAssetId(relativePath) {
    return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function decodeLibraryAssetId(id) {
    try {
        return Buffer.from(String(id || ''), 'base64url').toString('utf8');
    } catch {
        return null;
    }
}

function getLibraryAssetType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (LIBRARY_IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (LIBRARY_VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (LIBRARY_AUDIO_EXTENSIONS.has(ext)) return 'audio';
    return null;
}

function getMediaTypeFromLibraryType(type) {
    if (type === 'video') return 'videos';
    if (type === 'audio') return 'audios';
    return 'images';
}

function buildLibraryAssetUrl(relativePath) {
    const normalizedPath = relativePath.split(path.sep).join('/');
    const encodedPath = normalizedPath
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');
    return `${getUrlPrefix()}/assets/${encodedPath}`;
}

function getLibraryAssetMetaPathFromFile(filePath) {
    const parsed = path.parse(filePath);
    return path.join(parsed.dir, `${parsed.name}.json`);
}

function readLibraryAssetMeta(filePath) {
    const metaPath = getLibraryAssetMetaPathFromFile(filePath);
    if (!fs.existsSync(metaPath)) return null;

    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (error) {
        console.warn(`[Library] Failed to read asset metadata: ${metaPath}`, error);
        return null;
    }
}

function writeLibraryAssetMeta(targetDir, assetId, metadata) {
    const metaPath = path.join(targetDir, `${assetId}.json`);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
}

function buildLibraryAssetEntry(relativePath, fallback = {}) {
    const absolutePath = path.join(LIBRARY_ASSETS_DIR, relativePath);
    const stats = fs.statSync(absolutePath);
    const createdAt = stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime;
    const metadata = readLibraryAssetMeta(absolutePath) || {};
    const type = metadata.mediaType || fallback.type || getLibraryAssetType(absolutePath);
    const duration = Number.isFinite(Number(metadata.duration))
        ? Number(metadata.duration)
        : (
            Number.isFinite(Number(metadata.videoDuration))
                ? Number(metadata.videoDuration)
                : undefined
        );

    return {
        id: encodeLibraryAssetId(relativePath),
        name: metadata.name || fallback.name || path.parse(absolutePath).name,
        title: metadata.title || metadata.name || fallback.name || path.parse(absolutePath).name,
        category: metadata.category || fallback.category || relativePath.split(path.sep)[0],
        ownership: typeof metadata.ownership === 'string' ? metadata.ownership : '',
        url: buildLibraryAssetUrl(relativePath),
        type,
        nodeType: metadata.nodeType || null,
        sourceType: metadata.sourceType || null,
        prompt: metadata.prompt || '',
        model: metadata.model || '',
        imageModel: metadata.imageModel || '',
        videoModel: metadata.videoModel || '',
        audioModel: metadata.audioModel || '',
        textModel: metadata.textModel || '',
        imageMode: metadata.imageMode || '',
        videoMode: metadata.videoMode || '',
        audioMode: metadata.audioMode || '',
        aspectRatio: metadata.aspectRatio || '',
        resultAspectRatio: metadata.resultAspectRatio || '',
        resolution: metadata.resolution || '',
        duration,
        createdAt: metadata.createdAt || createdAt.toISOString()
    };
}

function listLibraryAssets() {
    const assets = [];

    if (!fs.existsSync(LIBRARY_ASSETS_DIR)) {
        return assets;
    }

    const categoryEntries = fs.readdirSync(LIBRARY_ASSETS_DIR, { withFileTypes: true });
    for (const categoryEntry of categoryEntries) {
        if (!categoryEntry.isDirectory()) continue;

        const category = categoryEntry.name;
        const categoryDir = path.join(LIBRARY_ASSETS_DIR, category);
        const fileEntries = fs.readdirSync(categoryDir, { withFileTypes: true });

        for (const fileEntry of fileEntries) {
            if (!fileEntry.isFile()) continue;

            const type = getLibraryAssetType(fileEntry.name);
            if (!type) continue;

            const relativePath = path.join(category, fileEntry.name);
            assets.push(buildLibraryAssetEntry(relativePath, {
                category,
                type,
                name: path.parse(fileEntry.name).name
            }));
        }
    }

    assets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return assets;
}

function sanitizeWorkflowPresetName(name) {
    return sanitizeAssetFileName(stripWorkflowPresetStorageSuffix(name || 'workflow'));
}

function stripWorkflowPresetMediaExtension(name) {
    return String(name || '')
        .trim()
        .replace(/\.(png|jpe?g|webp|gif|bmp|mp4|mov|webm|m4v|mkv|mp3|wav|m4a|ogg|aac|flac)(?=工作流?$|$)/i, '');
}

function stripWorkflowPresetStorageSuffix(name) {
    return stripWorkflowPresetMediaExtension(name).replace(/工作流$/u, '').trim();
}

function encodeLibraryWorkflowId(relativePath) {
    return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function decodeLibraryWorkflowId(id) {
    try {
        return Buffer.from(String(id || ''), 'base64url').toString('utf8');
    } catch {
        return null;
    }
}

function buildLibraryWorkflowUrl(relativePath) {
    const normalizedPath = relativePath.split(path.sep).join('/');
    const encodedPath = normalizedPath
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');
    return `${getUrlPrefix()}/workflows/${encodedPath}`;
}

function ensureUniqueDirectoryName(targetDir, baseName) {
    let attempt = 0;
    let nextName;
    do {
        const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
        nextName = `${baseName}${suffix}`;
        attempt += 1;
    } while (fs.existsSync(path.join(targetDir, nextName)));
    return nextName;
}

function tryParseDataUrl(input) {
    if (!input || typeof input !== 'string' || !input.startsWith('data:')) return null;
    const matches = input.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;
    return {
        mimeType: matches[1],
        buffer: Buffer.from(matches[2], 'base64')
    };
}

function getExtensionFromMimeType(mimeType) {
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'image/gif') return '.gif';
    if (mimeType === 'video/mp4') return '.mp4';
    if (mimeType === 'video/webm') return '.webm';
    if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') return '.mp3';
    if (mimeType === 'audio/wav') return '.wav';
    if (mimeType === 'audio/x-m4a' || mimeType === 'audio/m4a') return '.m4a';
    return '.png';
}

function getWorkflowPresetJsonInfo(category, folderName) {
    const presetDir = path.join(LIBRARY_WORKFLOWS_DIR, category, folderName);
    const jsonPath = path.join(presetDir, `${folderName}.json`);
    const coverPath = path.join(presetDir, `${folderName}.png`);
    const nodesDir = path.join(presetDir, `${folderName}.nodes`);
    return { presetDir, jsonPath, coverPath, nodesDir };
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildWorkflowPresetEntry(category, folderName) {
    const { jsonPath, coverPath } = getWorkflowPresetJsonInfo(category, folderName);
    if (!fs.existsSync(jsonPath)) return null;

    const payload = readJsonFile(jsonPath);
    const stats = fs.statSync(jsonPath);
    const createdAt = stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime;
    const relativeDir = path.join(category, folderName);
    const relativeCoverPath = path.join(relativeDir, `${folderName}.png`);

    return {
        id: encodeLibraryWorkflowId(relativeDir),
        name: payload.name || folderName,
        title: payload.name || folderName,
        category: payload.category || category,
        coverUrl: fs.existsSync(coverPath) ? buildLibraryWorkflowUrl(relativeCoverPath) : '',
        nodeCount: Array.isArray(payload.nodes) ? payload.nodes.length : 0,
        createdAt: payload.createdAt || createdAt.toISOString()
    };
}

function listLibraryWorkflowPresets() {
    if (!fs.existsSync(LIBRARY_WORKFLOWS_DIR)) return [];

    const workflows = [];
    const categoryEntries = fs.readdirSync(LIBRARY_WORKFLOWS_DIR, { withFileTypes: true });
    for (const categoryEntry of categoryEntries) {
        if (!categoryEntry.isDirectory()) continue;
        const category = categoryEntry.name;
        const categoryDir = path.join(LIBRARY_WORKFLOWS_DIR, category);
        const workflowEntries = fs.readdirSync(categoryDir, { withFileTypes: true });

        for (const workflowEntry of workflowEntries) {
            if (!workflowEntry.isDirectory()) continue;
            const preset = buildWorkflowPresetEntry(category, workflowEntry.name);
            if (preset) workflows.push(preset);
        }
    }

    return workflows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function collectNodeAssetCandidates(node) {
    const candidates = [];
    const pending = [{ record: node, owner: node.projectId, parameters: false }];
    const types = { image: 'images', mask: 'images', video: 'videos', audio: 'audios', images: 'images', videos: 'videos', audios: 'audios' };
    const add = (record, field, value = record[field]) => {
        if (typeof value === 'string' && value.trim()) candidates.push({ record, field, value });
    };
    while (pending.length) {
        const { record, owner, parameters } = pending.pop();
        if (!record || typeof record !== 'object') continue;
        if (Array.isArray(record)) {
            for (const item of record) pending.push({ record: item, owner, parameters });
            continue;
        }
        const projectId = record.projectId || owner;
        if (parameters && !record.assetId) {
            for (const item of Object.values(record)) pending.push({ record: item, owner: projectId, parameters: true });
            continue;
        }
        for (const field of ['resultUrl', 'url', 'inputUrl', 'lastFrame', 'editorBackgroundUrl', 'editorCanvasData', 'coverUrl']) add(record, field);
        for (const field of ['resultUrls', 'urls', 'characterReferenceUrls']) {
            if (Array.isArray(record[field])) record[field].forEach((value, index) => add(record[field], index, value));
        }
        // Structured input references may have no URL. Store their assetId as a
        // preset-relative handle, then restore the normal reference on import.
        if (record.assetId && !record.url && !record.resultUrl) {
            if (String(record.assetId).startsWith('./')) add(record, 'assetId');
            else {
                const type = types[record.type || record.mediaKind];
                if (type && projectId) {
                    const id = String(record.assetId);
                    const metadataUrl = `${getUrlPrefix()}/media/${encodeURIComponent(projectId)}/${type}/${encodeURIComponent(id)}.json`;
                    const metadataPath = resolveLocalPath(metadataUrl);
                    const metadata = metadataPath && fs.existsSync(metadataPath) ? readJsonFile(metadataPath) : null;
                    if (!metadata?.filename || path.basename(metadata.filename) !== metadata.filename) throw new Error('组合引用的素材不存在，请重新上传。');
                    add(record, 'assetId', `${getUrlPrefix()}/media/${encodeURIComponent(projectId)}/${type}/${encodeURIComponent(metadata.filename)}`);
                }
            }
        }
        for (const field of ['result', 'resultHistory', 'workflowOutputs', 'outputs']) pending.push({ record: record[field], owner: projectId, parameters: false });
        pending.push({ record: record.parameterValues, owner: projectId, parameters: true });
    }
    return candidates;
}

function updateNodeAssetField(candidate, value, projectId) {
    const { record, field } = candidate;
    if (field === 'assetId') record.assetId = projectId ? path.parse(value).name : value;
    else record[field] = value;
    if (['assetId', 'url', 'resultUrl'].includes(field) && value !== candidate.value) {
        if (field !== 'assetId' && record.assetId) record.assetId = path.parse(value).name;
        if (projectId) record.projectId = projectId;
        delete record.networkUrl;
    }
}

function createWorkflowNodeAssetSnapshot(sourceValue, nodesDir, nodesFolderName, cache) {
    if (!sourceValue || typeof sourceValue !== 'string') return sourceValue;
    if (sourceValue.startsWith('http') && !sourceValue.includes('/library/')) return sourceValue;

    if (cache.has(sourceValue)) {
        return cache.get(sourceValue);
    }

    const dataUrl = tryParseDataUrl(sourceValue);
    const localPath = dataUrl ? null : resolveLocalPath(sourceValue);
    const ext = dataUrl
        ? getExtensionFromMimeType(dataUrl.mimeType)
        : path.extname(localPath || '').toLowerCase();

    if (!dataUrl && (!localPath || !fs.existsSync(localPath))) {
        return sourceValue;
    }

    const assetId = generateAssetId();
    const safeExt = ext || '.png';
    const targetFilename = `${assetId}${safeExt}`;
    const targetPath = path.join(nodesDir, targetFilename);

    if (dataUrl) {
        fs.writeFileSync(targetPath, dataUrl.buffer);
    } else {
        fs.copyFileSync(localPath, targetPath);
    }

    const sourceMeta = !dataUrl && localPath ? readLibraryAssetMeta(localPath) : null;
    const metadata = {
        ...(sourceMeta || {}),
        id: assetId,
        filename: targetFilename,
        mediaType: getLibraryAssetType(targetFilename),
        createdAt: new Date().toISOString(),
        sourceUrl: sourceValue
    };
    fs.writeFileSync(path.join(nodesDir, `${assetId}.json`), JSON.stringify(metadata, null, 2), 'utf8');

    const relativePath = `./${nodesFolderName}/${targetFilename}`;
    cache.set(sourceValue, relativePath);
    return relativePath;
}

function importWorkflowPresetNodeAssets(nodes, presetDir, folderName, projectId) {
    const importedAssets = new Map();
    return nodes.map((node) => {
        const nextNode = JSON.parse(JSON.stringify(node));
        const candidates = collectNodeAssetCandidates(nextNode);

        for (const candidate of candidates) {
            const currentValue = candidate.value;
            if (typeof currentValue !== 'string' || !currentValue.startsWith('./')) continue;

            if (importedAssets.has(currentValue)) {
                updateNodeAssetField(candidate, importedAssets.get(currentValue), projectId || 'default');
                continue;
            }
            const absoluteSourcePath = path.resolve(presetDir, currentValue);
            const relativeSource = path.relative(presetDir, absoluteSourcePath);
            if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) throw new Error('组合素材路径无效。');
            if (!fs.existsSync(absoluteSourcePath)) throw new Error('组合素材文件缺失，请重新保存组合。');
            const actualRelative = path.relative(fs.realpathSync(presetDir), fs.realpathSync(absoluteSourcePath));
            if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) throw new Error('组合素材路径无效。');

            const ext = path.extname(absoluteSourcePath).toLowerCase();
            const libraryType = getLibraryAssetType(absoluteSourcePath) || getLibraryAssetType(ext);
            if (!libraryType) continue;

            const mediaType = getMediaTypeFromLibraryType(libraryType);
            const targetDir = getProjectMediaDir(projectId || 'default', mediaType);
            const assetId = generateAssetId();
            const targetFilename = `${assetId}${ext}`;
            const targetPath = path.join(targetDir, targetFilename);

            fs.copyFileSync(absoluteSourcePath, targetPath);

            const sourceMetaPath = path.join(path.dirname(absoluteSourcePath), `${path.parse(absoluteSourcePath).name}.json`);
            let copiedMeta = null;
            if (fs.existsSync(sourceMetaPath)) {
                try {
                    copiedMeta = JSON.parse(fs.readFileSync(sourceMetaPath, 'utf8'));
                } catch {
                    copiedMeta = null;
                }
            }

            saveAssetMetadata(targetDir, {
                id: assetId,
                filename: targetFilename,
                prompt: copiedMeta?.prompt || nextNode.prompt || nextNode.title || '',
                type: mediaType,
                model: copiedMeta?.model || nextNode.model || 'Workflow Preset',
                title: copiedMeta?.title || nextNode.title || '',
                nodeType: copiedMeta?.nodeType || nextNode.type || null,
                sourceType: 'workflow-preset',
                imageModel: copiedMeta?.imageModel || nextNode.imageModel || '',
                videoModel: copiedMeta?.videoModel || nextNode.videoModel || '',
                audioModel: copiedMeta?.audioModel || nextNode.audioModel || '',
                textModel: copiedMeta?.textModel || nextNode.textModel || '',
                imageMode: copiedMeta?.imageMode || nextNode.imageMode || '',
                videoMode: copiedMeta?.videoMode || nextNode.videoMode || '',
                audioMode: copiedMeta?.audioMode || nextNode.audioMode || '',
                aspectRatio: copiedMeta?.aspectRatio || nextNode.aspectRatio || '',
                resultAspectRatio: copiedMeta?.resultAspectRatio || nextNode.resultAspectRatio || '',
                resolution: copiedMeta?.resolution || nextNode.resolution || '',
                duration: copiedMeta?.duration || nextNode.videoDuration || null
            });

            const url = `${getUrlPrefix()}/media/${encodeURIComponent(projectId || 'default')}/${mediaType}/${targetFilename}`;
            importedAssets.set(currentValue, url);
            updateNodeAssetField(candidate, url, projectId || 'default');
        }

        return nextNode;
    });
}

// Save curated asset to library
router.post('/api/library', async (req, res) => {
    try {
        const { sourceUrl, name, category, meta, ownership = '' } = req.body;
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 200
            || typeof category !== 'string' || !category.trim() || category.trim().length > 80
            || typeof ownership !== 'string' || ownership.trim().length > 120) {
            return res.status(400).json({ error: '名称、分类或归属格式不正确' });
        }
        const normalizedName = String(name || '').trim();
        const normalizedCategory = sanitizeAssetFileName(category);

        if (!sourceUrl || !normalizedName || !normalizedCategory) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Determine destination directory
        const destDir = path.join(LIBRARY_ASSETS_DIR, normalizedCategory);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        const assetId = generateAssetId();
        let destFilename = '';
        let destPath;
        let extension = '.png';
        let mimeType = '';

        // HANDLE DATA URL (Base64)
        if (sourceUrl.startsWith('data:')) {
            const matches = sourceUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return res.status(400).json({ error: 'Invalid data URL format' });
            }

            const detectedMimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            mimeType = detectedMimeType;

            // Determine extension from mime
            if (detectedMimeType === 'image/jpeg') extension = '.jpg';
            else if (detectedMimeType === 'video/mp4') extension = '.mp4';
            else if (detectedMimeType === 'audio/mpeg' || detectedMimeType === 'audio/mp3') extension = '.mp3';
            else if (detectedMimeType === 'audio/wav') extension = '.wav';
            else if (detectedMimeType === 'audio/x-m4a' || detectedMimeType === 'audio/m4a') extension = '.m4a';

            destFilename = `${assetId}${extension}`;
            destPath = path.join(destDir, destFilename);

            fs.writeFileSync(destPath, buffer);
        }
        // HANDLE FILE PATH OR URL
        else {
            // 使用统一工具解析本地文件路径
            const sourcePath = resolveLocalPath(sourceUrl);

            if (!sourcePath || !fs.existsSync(sourcePath)) {
                console.error(`Save asset failed: Source file not found. URL: ${sourceUrl}, Path: ${sourcePath}`);
                return res.status(404).json({ error: "Source file not found", debug: { sourceUrl, sourcePath } });
            }

            // Copy file
            extension = path.extname(sourcePath).toLowerCase() || '.png';
            destFilename = `${assetId}${extension}`;
            destPath = path.join(destDir, destFilename);
            mimeType = meta?.mimeType || '';

            fs.copyFileSync(sourcePath, destPath);
        }

        const assetType = getLibraryAssetType(destFilename) || 'image';
        const createdAt = new Date().toISOString();
        const stats = fs.statSync(destPath);
        const metadata = {
            id: assetId,
            name: normalizedName,
            title: normalizedName,
            category: normalizedCategory,
            filename: destFilename,
            ownership: ownership.trim(),
            mediaType: assetType,
            nodeType: meta?.nodeType || null,
            sourceType: meta?.sourceType || null,
            prompt: String(meta?.prompt || normalizedName).trim(),
            model: String(meta?.model || '').trim(),
            imageModel: String(meta?.imageModel || '').trim(),
            videoModel: String(meta?.videoModel || '').trim(),
            audioModel: String(meta?.audioModel || '').trim(),
            textModel: String(meta?.textModel || '').trim(),
            imageMode: String(meta?.imageMode || '').trim(),
            videoMode: String(meta?.videoMode || '').trim(),
            audioMode: String(meta?.audioMode || '').trim(),
            aspectRatio: String(meta?.aspectRatio || '').trim(),
            resultAspectRatio: String(meta?.resultAspectRatio || '').trim(),
            resolution: String(meta?.resolution || '').trim(),
            duration: Number.isFinite(Number(meta?.duration))
                ? Number(meta.duration)
                : (
                    Number.isFinite(Number(meta?.videoDuration))
                        ? Number(meta.videoDuration)
                        : null
                ),
            mimeType,
            size: stats.size,
            createdAt
        };

        writeLibraryAssetMeta(destDir, assetId, metadata);
        const relativePath = path.join(normalizedCategory, destFilename);
        const newEntry = buildLibraryAssetEntry(relativePath, {
            category: normalizedCategory,
            type: assetType,
            name: normalizedName
        });

        res.json({ success: true, asset: newEntry });
    } catch (error) {
        console.error("Save to library error:", error);
        res.status(500).json({ error: error.message });
    }
});

// List library assets
router.get('/api/library', async (req, res) => {
    try {
        res.json(listLibraryAssets());
    } catch (error) {
        console.error("List library error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Import library asset into current project media folder
router.post('/api/library/import', async (req, res) => {
    try {
        const { id, projectId } = req.body;
        const relativePath = decodeLibraryAssetId(id);

        if (!relativePath) {
            return res.status(400).json({ error: 'Invalid asset id' });
        }

        const sourcePath = path.join(LIBRARY_ASSETS_DIR, relativePath);
        const normalizedSourcePath = path.normalize(sourcePath);
        const normalizedAssetsDir = path.normalize(LIBRARY_ASSETS_DIR);

        const isInsideAssetsDir = normalizedSourcePath === normalizedAssetsDir || normalizedSourcePath.startsWith(`${normalizedAssetsDir}${path.sep}`);
        if (!isInsideAssetsDir || !fs.existsSync(normalizedSourcePath)) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const libraryType = getLibraryAssetType(normalizedSourcePath);
        if (!libraryType) {
            return res.status(400).json({ error: 'Unsupported asset type' });
        }

        const assetMeta = readLibraryAssetMeta(normalizedSourcePath) || {};
        const mediaType = getMediaTypeFromLibraryType(libraryType);
        const finalProjectId = projectId || 'default';
        const targetDir = getProjectMediaDir(finalProjectId, mediaType);
        const sourceExt = path.extname(normalizedSourcePath).toLowerCase();
        const assetId = generateAssetId();
        const targetFilename = `${assetId}${sourceExt}`;
        const targetPath = path.join(targetDir, targetFilename);
        const assetName = assetMeta.name || path.parse(normalizedSourcePath).name;
        const normalizedDuration = Number.isFinite(Number(assetMeta.duration))
            ? Number(assetMeta.duration)
            : (
                Number.isFinite(Number(assetMeta.videoDuration))
                    ? Number(assetMeta.videoDuration)
                    : undefined
            );

        fs.copyFileSync(normalizedSourcePath, targetPath);
        saveAssetMetadata(targetDir, {
            id: assetId,
            filename: targetFilename,
            prompt: assetMeta.prompt || assetName,
            type: mediaType,
            model: assetMeta.model || 'Asset Library',
            nodeType: assetMeta.nodeType || null,
            sourceType: assetMeta.sourceType || 'asset-library',
            title: assetMeta.title || assetName,
            imageModel: assetMeta.imageModel || '',
            videoModel: assetMeta.videoModel || '',
            audioModel: assetMeta.audioModel || '',
            textModel: assetMeta.textModel || '',
            imageMode: assetMeta.imageMode || '',
            videoMode: assetMeta.videoMode || '',
            audioMode: assetMeta.audioMode || '',
            aspectRatio: assetMeta.aspectRatio || '',
            resultAspectRatio: assetMeta.resultAspectRatio || '',
            resolution: assetMeta.resolution || '',
            duration: normalizedDuration
        });

        res.json({
            success: true,
            asset: {
                id: assetId,
                url: `${getUrlPrefix()}/media/${finalProjectId}/${mediaType}/${targetFilename}`,
                name: assetName,
                title: assetMeta.title || assetName,
                prompt: assetMeta.prompt || assetName,
                type: mediaType,
                mediaType: libraryType,
                nodeType: assetMeta.nodeType || null,
                sourceType: assetMeta.sourceType || null,
                model: assetMeta.model || '',
                imageModel: assetMeta.imageModel || '',
                videoModel: assetMeta.videoModel || '',
                audioModel: assetMeta.audioModel || '',
                textModel: assetMeta.textModel || '',
                imageMode: assetMeta.imageMode || '',
                videoMode: assetMeta.videoMode || '',
                audioMode: assetMeta.audioMode || '',
                aspectRatio: assetMeta.aspectRatio || '',
                resultAspectRatio: assetMeta.resultAspectRatio || '',
                resolution: assetMeta.resolution || '',
                duration: normalizedDuration
            }
        });
    } catch (error) {
        console.error('Import library asset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Editing presentation metadata keeps the media path/id stable for existing canvas references.
router.patch('/api/library/:id', (req, res) => {
    try {
        const fields = req.body;
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)
            || Object.keys(fields).some(key => !['name', 'category', 'ownership'].includes(key))
            || typeof fields.name !== 'string' || !fields.name.trim() || fields.name.trim().length > 200
            || typeof fields.category !== 'string' || !fields.category.trim() || fields.category.trim().length > 80
            || typeof fields.ownership !== 'string' || fields.ownership.trim().length > 120) {
            return res.status(400).json({ error: '名称、分类或归属格式不正确' });
        }
        const relativePath = decodeLibraryAssetId(req.params.id);
        if (!relativePath || !getLibraryAssetType(relativePath)) {
            return res.status(400).json({ error: 'Invalid asset id' });
        }
        const root = fs.realpathSync(LIBRARY_ASSETS_DIR);
        const filePath = path.resolve(LIBRARY_ASSETS_DIR, relativePath);
        const isInside = value => value.startsWith(`${root}${path.sep}`);
        if (!isInside(filePath) || !fs.existsSync(filePath)
            || !isInside(fs.realpathSync(filePath)) || !fs.statSync(filePath).isFile()) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        const metaPath = getLibraryAssetMetaPathFromFile(filePath);
        if (fs.existsSync(metaPath) && fs.lstatSync(metaPath).isSymbolicLink()) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        // Preserve unknown metadata; malformed metadata must never be silently replaced.
        const previous = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
        if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Invalid metadata');
        const metadata = {
            ...previous,
            name: fields.name.trim(), title: fields.name.trim(),
            category: fields.category.trim(), ownership: fields.ownership.trim(),
        };
        const temporary = `${metaPath}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' });
            fs.renameSync(temporary, metaPath);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        return res.json({ success: true, asset: buildLibraryAssetEntry(relativePath) });
    } catch {
        return res.status(500).json({ error: '保存未完成，请刷新资产库后重试' });
    }
});

// Delete library asset
router.delete('/api/library/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const relativePath = decodeLibraryAssetId(id);

        if (!relativePath) {
            return res.status(400).json({ error: 'Invalid asset id' });
        }

        const filePath = path.normalize(path.join(LIBRARY_ASSETS_DIR, relativePath));
        const normalizedAssetsDir = path.normalize(LIBRARY_ASSETS_DIR);

        const isInsideAssetsDir = filePath === normalizedAssetsDir || filePath.startsWith(`${normalizedAssetsDir}${path.sep}`);
        if (!isInsideAssetsDir || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const metaPath = getLibraryAssetMetaPathFromFile(filePath);
        fs.unlinkSync(filePath);
        if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Delete library asset error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Library Workflow Presets API ---

router.get('/api/library/workflows', async (_req, res) => {
    try {
        res.json(listLibraryWorkflowPresets());
    } catch (error) {
        console.error('List library workflow presets error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/library/workflows', async (req, res) => {
    try {
        const { name, category, coverDataUrl, nodes } = req.body;
        const normalizedName = stripWorkflowPresetMediaExtension(name);
        const normalizedCategory = sanitizeWorkflowPresetName(category);

        if (!normalizedName || !normalizedCategory || !Array.isArray(nodes) || nodes.length < 1) {
            return res.status(400).json({ error: 'Name, category and at least one node are required' });
        }

        const categoryDir = path.join(LIBRARY_WORKFLOWS_DIR, normalizedCategory);
        if (!fs.existsSync(categoryDir)) {
            fs.mkdirSync(categoryDir, { recursive: true });
        }

        const safeBaseName = sanitizeWorkflowPresetName(normalizedName);
        const folderName = ensureUniqueDirectoryName(categoryDir, safeBaseName);
        const { presetDir, jsonPath, coverPath, nodesDir } = getWorkflowPresetJsonInfo(normalizedCategory, folderName);
        fs.mkdirSync(presetDir, { recursive: true });
        fs.mkdirSync(nodesDir, { recursive: true });

        const selectedIdSet = new Set(nodes.map(node => node.id));
        const minX = Math.min(...nodes.map(node => Number(node.x) || 0));
        const minY = Math.min(...nodes.map(node => Number(node.y) || 0));
        const assetCache = new Map();

        const normalizedNodes = nodes.map((sourceNode) => {
            const node = JSON.parse(JSON.stringify(sourceNode));
            node.x = (Number(node.x) || 0) - minX;
            node.y = (Number(node.y) || 0) - minY;
            const parents = Array.isArray(node.parentIds) ? node.parentIds : [];
            const fixed = node.kind === 'workflow' || node.type === 'ComfyUI';
            const slots = parents.map((_, index) => index).filter(index => fixed || selectedIdSet.has(parents[index]));
            node.parentIds = slots.map(index => selectedIdSet.has(parents[index]) ? parents[index] : '');
            if (Array.isArray(node.sourcePortIndices)) node.sourcePortIndices = slots.map(index => selectedIdSet.has(parents[index]) ? (node.sourcePortIndices[index] || 0) : 0);
            node.groupId = undefined;

            if (Array.isArray(node.frameInputs)) {
                node.frameInputs = node.frameInputs.filter(item => selectedIdSet.has(item.nodeId));
            }

            if (node.comfyInputs) {
                node.comfyInputs = Object.fromEntries(
                    Object.entries(node.comfyInputs).filter(([, value]) => selectedIdSet.has(value))
                );
            }

            if (node.comfyOutputs) {
                node.comfyOutputs = Object.fromEntries(
                    Object.entries(node.comfyOutputs).map(([key, values]) => [
                        key,
                        Array.isArray(values) ? values.filter(value => selectedIdSet.has(value)) : []
                    ])
                );
            }

            if (node.linkedVideoNodeId && !selectedIdSet.has(node.linkedVideoNodeId)) {
                node.linkedVideoNodeId = undefined;
            }

            if (node.compositeLayout) {
                node.compositeLayout = Object.fromEntries(
                    Object.entries(node.compositeLayout).filter(([key]) => selectedIdSet.has(key))
                );
            }

            for (const candidate of collectNodeAssetCandidates(node)) {
                const nextValue = createWorkflowNodeAssetSnapshot(candidate.value, nodesDir, `${folderName}.nodes`, assetCache);
                updateNodeAssetField(candidate, nextValue);
            }

            node.projectId = undefined;
            return node;
        });

        const coverData = tryParseDataUrl(coverDataUrl);
        if (coverData) {
            fs.writeFileSync(coverPath, coverData.buffer);
        }

        const payload = {
            name: normalizedName,
            category: normalizedCategory,
            createdAt: new Date().toISOString(),
            nodes: normalizedNodes
        };
        fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

        const preset = buildWorkflowPresetEntry(normalizedCategory, folderName);
        res.json({ success: true, workflow: preset });
    } catch (error) {
        console.error('Create library workflow preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/library/workflows/import', async (req, res) => {
    try {
        const { id, projectId } = req.body;
        const relativeDir = decodeLibraryWorkflowId(id);

        if (!relativeDir) {
            return res.status(400).json({ error: 'Invalid workflow id' });
        }

        const [category, folderName] = relativeDir.split(/[\\/]/);
        if (!category || !folderName) {
            return res.status(400).json({ error: 'Invalid workflow path' });
        }

        const { presetDir, jsonPath } = getWorkflowPresetJsonInfo(category, folderName);
        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: 'Workflow preset not found' });
        }

        const payload = readJsonFile(jsonPath);
        const importedNodes = importWorkflowPresetNodeAssets(payload.nodes || [], presetDir, folderName, projectId || 'default');

        res.json({
            success: true,
            workflow: {
                name: payload.name || folderName,
                category: payload.category || category,
                nodes: importedNodes
            }
        });
    } catch (error) {
        console.error('Import library workflow preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/library/workflows/:id', async (req, res) => {
    try {
        const relativeDir = decodeLibraryWorkflowId(req.params.id);
        if (!relativeDir) {
            return res.status(400).json({ error: 'Invalid workflow id' });
        }

        const presetDir = path.normalize(path.join(LIBRARY_WORKFLOWS_DIR, relativeDir));
        const normalizedRoot = path.normalize(LIBRARY_WORKFLOWS_DIR);
        const isInsideRoot = presetDir === normalizedRoot || presetDir.startsWith(`${normalizedRoot}${path.sep}`);

        if (!isInsideRoot || !fs.existsSync(presetDir)) {
            return res.status(404).json({ error: 'Workflow preset not found' });
        }

        fs.rmSync(presetDir, { recursive: true, force: true });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete library workflow preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Public Workflows API (bundled examples) ---

// List public workflows (shipped with the repo in public/workflows/)
// Dynamically scans directory - no need to maintain index.json manually
router.get('/api/public-workflows', async (req, res) => {
    try {
        const publicWorkflowsDir = path.join(publicDirectory, 'workflows');

        if (!fs.existsSync(publicWorkflowsDir)) {
            return res.json([]);
        }

        // Scan all .json files except index.json
        const files = fs.readdirSync(publicWorkflowsDir)
            .filter(f => f.endsWith('.json') && f !== 'index.json');

        const workflows = files.map(file => {
            try {
                const content = fs.readFileSync(path.join(publicWorkflowsDir, file), 'utf8');
                const workflow = JSON.parse(content);

                // Generate description from workflow content
                const nodeTypes = workflow.nodes?.reduce((acc, n) => {
                    acc[n.type] = (acc[n.type] || 0) + 1;
                    return acc;
                }, {}) || {};
                const typesSummary = Object.entries(nodeTypes)
                    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
                    .join(', ');
                const description = workflow.description ||
                    (typesSummary ? `Workflow with ${typesSummary}` : 'A public workflow template');

                return {
                    id: file.replace('.json', ''),
                    title: workflow.title || 'Untitled',
                    description,
                    nodeCount: workflow.nodes?.length || 0,
                    coverUrl: workflow.coverUrl || null
                };
            } catch (parseError) {
                console.warn(`Skipping invalid workflow file: ${file}`, parseError.message);
                return null;
            }
        }).filter(Boolean); // Remove any null entries from parse errors

        // Sort by title alphabetically
        workflows.sort((a, b) => a.title.localeCompare(b.title));

        res.json(workflows);
    } catch (error) {
        console.error("List public workflows error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Load specific public workflow
router.get('/api/public-workflows/:id', async (req, res) => {
    try {
        const publicWorkflowsDir = path.join(publicDirectory, 'workflows');
        const filePath = path.join(publicWorkflowsDir, `${req.params.id}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Public workflow not found" });
        }

        const content = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(content));
    } catch (error) {
        console.error("Load public workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

    return router;
}
