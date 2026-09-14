import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export function buildAssetUrl(projectId, type, filename) {
  return `/library/media/${encodeURIComponent(projectId)}/${type}/${encodeURIComponent(filename)}`;
}

function buildLegacyAssetUrl(type, filename) {
  return `/library/${type}/${encodeURIComponent(filename)}`;
}

export function normalizeAsset(metadata, projectId, type) {
  return {
    ...metadata,
    projectId,
    type,
    favorite: metadata.favorite === true,
    url: buildAssetUrl(projectId, type, metadata.filename),
  };
}

async function directoryNames(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function readMetadata(directory, filename) {
  try {
    return JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
  } catch {
    return null;
  }
}

async function readDirectoryAssets(directory, projectId, type, { projectView, favoriteOnly }) {
  const filenames = (await directoryNames(directory)).filter(name => name.endsWith('.json'));
  const entries = new Array(filenames.length);
  let next = 0;
  // Bound outstanding filesystem work. Results retain directory order even when
  // reads finish out of order, preserving stable pagination for equal timestamps.
  await Promise.all(Array.from({ length: Math.min(8, filenames.length) }, async () => {
    while (next < filenames.length) {
      const index = next++;
      const metadata = await readMetadata(directory, filenames[index]);
      if (!metadata?.filename) continue;
      if (projectView) {
        const mediaPath = path.join(directory, metadata.filename);
        if (!await access(mediaPath).then(() => true, () => false)) continue;
        const asset = normalizeAsset(metadata, projectId, type);
        if (!favoriteOnly || asset.favorite) entries[index] = asset;
      } else {
        // The cover picker deliberately retains legacy metadata-only entries.
        entries[index] = projectId === null
          ? { ...metadata, url: buildLegacyAssetUrl(type, metadata.filename) }
          : { ...metadata, projectId, url: buildAssetUrl(projectId, type, metadata.filename) };
      }
    }
  }));
  return entries.filter(Boolean);
}

// Receives a validated media type and project id from the HTTP boundary. Reads
// fresh metadata on every request so upload, favorite, repair and delete remain
// visible immediately, without a second cache invalidation protocol.
export async function listMediaAssets({ libraryDirectory, type, projectId, favoriteOnly = false, limit = 0, offset = 0 }) {
  const mediaDirectory = path.join(libraryDirectory, 'media');
  const options = { projectView: Boolean(projectId), favoriteOnly };
  let entries;
  if (projectId) {
    entries = await readDirectoryAssets(path.join(mediaDirectory, projectId, type), projectId, type, options);
  } else {
    entries = await readDirectoryAssets(path.join(libraryDirectory, type), null, type, options);
    for (const owner of await directoryNames(mediaDirectory)) {
      for (const asset of await readDirectoryAssets(path.join(mediaDirectory, owner, type), owner, type, options)) {
        entries.push(asset);
      }
    }
  }
  entries.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return limit > 0 ? {
    assets: entries.slice(offset, offset + limit),
    total: entries.length,
    hasMore: offset + limit < entries.length,
  } : entries;
}
