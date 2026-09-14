/**
 * imageHelpers.js
 * 
 * Utility functions for image/video processing and base64 conversion.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { getWorkspacePaths, getUrlPrefix } from '../workspace/workspacePaths.js';

// ============================================================================
// PATH RESOLUTION HELPERS
// ============================================================================

/**
 * Resolves any asset URL or path to its absolute local file path.
 * Handles: http://domain/library/..., /library/..., and query parameters.
 * @param {string} input - The URL or path to resolve
 * @returns {string|null} - Absolute local file path or null if not a local asset
 */
export function resolveLocalPath(input) {
    if (!input || typeof input !== 'string') return null;

    let targetPath = input;

    // 1. 处理完整的 HTTP URL (例如 http://localhost:3001/library/...)
    if (input.startsWith('http')) {
        try {
            const urlObj = new URL(input);
            // 如果是本地库路径，提取 pathname 继续处理
            if (urlObj.pathname.startsWith('/library/')) {
                targetPath = urlObj.pathname;
            } else {
                // 如果是外部网络 URL (如 TOS)，则无法解析为本地路径
                return null;
            }
        } catch {
            // 解析失败则按原样处理
        }
    }

    // 2. 确保它是库路径
    if (!targetPath.includes('library/')) {
        return null;
    }

    // 3. 提取 library/ 之后的路径部分 (支持有无前导斜杠)
    const libraryMatch = targetPath.match(/\/?library\/(.+)$/);
    if (!libraryMatch) return null;
    
    const relativePart = libraryMatch[1];

    // 4. 去除查询参数 (如 ?t=123456)，防止文件查找失败
    const pathWithoutQuery = relativePart.split('?')[0];

    // 5. 解码 URL 编码 (例如 %20 -> 空格)
    const decodedPath = decodeURIComponent(pathWithoutQuery);

    // 6. 将其转换为本地绝对路径（统一根目录模式）
    return path.join(getWorkspacePaths().LIBRARY_DIR, decodedPath);
}

// ============================================================================
// BASE64 HELPERS
// ============================================================================

/**
 * Resolve image to base64 - handles both base64 data URLs and file URLs
 * @param {string} input - Base64 data URL or file URL
 * @returns {string|null} Base64 data URL
 */
export function resolveImageToBase64(input) {
    if (!input) return null;

    // Already a data URL
    if (input.startsWith('data:')) {
        return input;
    }

    // 使用统一的路径解析工具
    const absolutePath = resolveLocalPath(input);

    if (absolutePath && fs.existsSync(absolutePath)) {
        try {
            const fileBuffer = fs.readFileSync(absolutePath);
            const ext = path.extname(absolutePath).toLowerCase();
            const mimeType = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav',
                '.ogg': 'audio/ogg'
            }[ext] || 'image/png';

            return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
        } catch (error) {
            console.error('Error reading file for base64 conversion:', error);
            return null;
        }
    }

    // If it's a remote URL that wasn't a local library path, return it as is
    if (input.startsWith('http://') || input.startsWith('https://')) {
        return input;
    }

    // If we couldn't resolve it, return null to prevent passing invalid data to API
    console.warn('Could not resolve image to base64:', input.substring(0, 100));
    return null;
}

/**
 * Extract raw base64 from data URL (removes data:image/xxx;base64, prefix)
 * @param {string} dataUrl - Base64 data URL
 * @returns {string|null} Raw base64 string
 */
export function extractRawBase64(dataUrl) {
    if (!dataUrl) return null;
    if (dataUrl.startsWith('data:')) {
        return dataUrl.replace(/^data:[^;]+;base64,/, '');
    }
    return dataUrl;
}

// ============================================================================
// ASPECT RATIO MAPPING
// ============================================================================

/**
 * Map frontend aspect ratio to API-compatible format
 * @param {string} ratio - Frontend aspect ratio string
 * @returns {string} API-compatible aspect ratio
 */
export function mapAspectRatio(ratio) {
    const mapping = {
        '1:1': '1:1',
        '16:9': '16:9',
        '9:16': '9:16',
        '4:3': '4:3',
        '3:4': '3:4',
        '3:2': '3:2',
        '2:3': '2:3',
        '21:9': '21:9',
        '5:4': '5:4',
        '4:5': '4:5'
    };
    return mapping[ratio] || '1:1';
}

// ============================================================================
// FILE SAVING
// ============================================================================

/**
 * Generate a standard asset ID (UUID)
 * @returns {string}
 */
export function generateAssetId() {
    return crypto.randomUUID();
}

/**
 * Save metadata JSON for an asset (used by history panel)
 * @param {string} dir - Directory to save JSON in
 * @param {Object} data - Metadata fields
 */
export function saveAssetMetadata(dir, data) {
    const { id, filename, prompt, type, model, mode, aspectRatio, resolution, nodeId, cost, ...extra } = data;
    const metadata = {
        id,
        filename,
        nodeId: nodeId || null, // Track which node this belongs to
        prompt: prompt || '',
        model: model || 'Unknown',
        mode: typeof mode === 'string' ? mode : '',
        aspectRatio: aspectRatio || 'Auto',
        resolution: resolution || 'Auto',
        cost: typeof cost === 'number' ? cost : 0, // Record the generation cost
        createdAt: new Date().toISOString(),
        type: type, // 'images', 'videos', or 'audios'
        ...extra // Include any additional metadata fields
    };
    
    try {
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(metadata, null, 2));
    } catch (err) {
        console.error(`[Metadata] Failed to save for ${id}:`, err.message);
    }
}

/**
 * Save buffer to project-specific media folder
 * @param {Buffer} buffer - Data buffer
 * @param {string} projectId - Project ID
 * @param {string} type - 'images', 'videos', or 'audios'
 * @param {string} extension - File extension
 * @param {Object} [meta] - Optional metadata fields
 * @param {string} [customId] - Optional custom ID
 * @returns {{ id: string, path: string, url: string, filename: string }}
 */
export function saveMediaBufferToFile(buffer, projectId, type, extension, meta = {}, customId) {
    // Generate a unique ID (timestamped if customId is a nodeId)
    const id = generateAssetId(customId);
    const filename = `${id}.${extension}`;
    
    const { LIBRARY_MEDIA_DIR } = getWorkspacePaths();
    const mediaDir = path.join(LIBRARY_MEDIA_DIR, projectId, type);
    
    if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
    }
    
    const filePath = path.join(mediaDir, filename);
    fs.writeFileSync(filePath, buffer);

    // Auto-generate metadata for history using the SAME unique ID
    saveAssetMetadata(mediaDir, {
        ...meta,          // 先展开 meta 信息
        id: id,           // 强制使用生成的唯一 ID (Unique ID)，确保文件名一致且不会互相覆盖
        filename,         // 确保文件名一致
        type,
        nodeId: customId  // 记录原始节点 ID 用于关联
    });

    const url = `${getUrlPrefix()}/media/${projectId}/${type}/${filename}`;
    return { id, path: filePath, url, filename };
}

/**
 * Downloads a file from URL and saves it to local storage
 * @param {string} url - Remote URL
 * @param {string} projectId - Project ID
 * @param {string} type - 'images' or 'videos'
 * @returns {Promise<{ id: string, url: string }>}
 */
export async function downloadAndSaveAsset(url, projectId, type) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type');
        let ext = 'bin';
        
        if (contentType) {
            if (contentType.includes('video/mp4')) ext = 'mp4';
            else if (contentType.includes('video/quicktime')) ext = 'mov';
            else if (contentType.includes('video/webm')) ext = 'webm';
            else if (contentType.includes('image/png')) ext = 'png';
            else if (contentType.includes('image/jpeg')) ext = 'jpg';
            else if (contentType.includes('image/webp')) ext = 'webp';
        } else {
            // Try to get extension from URL
            try {
                const urlPath = new URL(url).pathname;
                const urlExt = path.extname(urlPath).toLowerCase().replace('.', '');
                if (urlExt) ext = urlExt;
            } catch {
                // Ignore URL parsing errors
            }
        }

        return saveMediaBufferToFile(buffer, projectId || 'default', type, ext, {
            model: 'External URL',
            prompt: url
        });
    } catch (err) {
        console.error('Download failed:', err.message);
        throw err;
    }
}

