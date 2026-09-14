import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);

export class ThumbnailCacheError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ThumbnailCacheError';
        this.status = status;
    }
}

function normalizeMaxSize(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return 960;
    return Math.min(2048, Math.max(128, parsed));
}

function resolveLibrarySource(libraryDir, sourceUrl) {
    const cleanUrl = String(sourceUrl || '').split(/[?#]/, 1)[0];
    if (!cleanUrl.startsWith('/library/')) {
        throw new ThumbnailCacheError('缩略图仅支持本地 library 图片');
    }

    let relativeUrl;
    try {
        relativeUrl = decodeURIComponent(cleanUrl.slice('/library/'.length));
    } catch {
        throw new ThumbnailCacheError('图片路径编码无效');
    }

    const sourcePath = path.resolve(libraryDir, relativeUrl.replaceAll('/', path.sep));
    const relativePath = path.relative(libraryDir, sourcePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new ThumbnailCacheError('图片路径超出 library 目录', 403);
    }
    if (!IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
        throw new ThumbnailCacheError('不支持的图片格式');
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new ThumbnailCacheError('原图不存在', 404);
    }
    return sourcePath;
}

export function createThumbnailCache({ libraryDir }) {
    const cacheDir = path.join(libraryDir, '.cache', 'thumbnails');
    const jobs = new Map();

    return {
        async get(sourceUrl, maxSizeValue) {
            const sourcePath = resolveLibrarySource(libraryDir, sourceUrl);
            const maxSize = normalizeMaxSize(maxSizeValue);
            const stat = fs.statSync(sourcePath);
            const fingerprint = `${sourcePath}:${stat.size}:${stat.mtimeMs}:${maxSize}`;
            const cacheKey = crypto.createHash('sha256').update(fingerprint).digest('hex');
            const thumbnailPath = path.join(cacheDir, `${cacheKey}.webp`);
            if (fs.existsSync(thumbnailPath)) return thumbnailPath;

            const existingJob = jobs.get(cacheKey);
            if (existingJob) return existingJob;

            const job = (async () => {
                fs.mkdirSync(cacheDir, { recursive: true });
                const temporaryPath = `${thumbnailPath}.${process.pid}.tmp`;
                try {
                    // libvips needs the Windows extended-length form for deep install/data roots.
                    // Node's own filesystem calls already normalize these paths internally.
                    await sharp(path.toNamespacedPath(sourcePath))
                        .rotate()
                        .resize({
                            width: maxSize,
                            height: maxSize,
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .webp({ quality: 78, effort: 4 })
                        .toFile(path.toNamespacedPath(temporaryPath));
                    fs.renameSync(temporaryPath, thumbnailPath);
                    return thumbnailPath;
                } finally {
                    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
                }
            })();

            jobs.set(cacheKey, job);
            try {
                return await job;
            } finally {
                jobs.delete(cacheKey);
            }
        }
    };
}
