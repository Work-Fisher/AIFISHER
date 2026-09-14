import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectMediaArtifact, resolveMediaArtifact } from './mediaArtifact.js';
import { createMediaMetadataProbe } from './mediaMetadataProbe.js';

/** Validate before publication, using the same bundled probe as imported media. */
export async function validateRecoveredVideo(buffer, signal, probe = createMediaMetadataProbe()) {
  signal?.throwIfAborted();
  resolveMediaArtifact({ prefix: buffer.subarray(0, 32), declaredType: 'video', requireRecognizedContent: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aifisher-video-recovery-'));
  try {
    const filePath = path.join(directory, 'result.bin');
    await writeFile(filePath, buffer);
    const artifact = await inspectMediaArtifact({
      filePath, filename: 'result.bin', prefix: buffer.subarray(0, 32),
      declaredType: 'video', probeMediaMetadata: probe,
    });
    if (artifact.kind !== 'video' || buffer.length > artifact.maximumBytes) throw new Error('Invalid video artifact');
    // Container recognition alone is insufficient, including containers with unambiguous magic.
    const metadata = artifact.metadata || await probe(filePath, 'videos');
    if (!(metadata.width > 0 && metadata.height > 0 && metadata.duration > 0)) throw new Error('Invalid video stream');
    signal?.throwIfAborted();
    return { format: artifact.extension.slice(1), metadata };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
