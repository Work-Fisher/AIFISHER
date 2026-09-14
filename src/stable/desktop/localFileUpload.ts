import { desktopBridge, type AifisherDesktopBridge } from './desktopBridge';

// The app protocol reads a Blob request body whole into the main process (ADR-0035): files on
// disk go to the backend by path, and larger pathless content streams instead.
const STREAMED_UPLOAD_MIN_BYTES = 32 * 1024 * 1024;

export type UploadRequestInit = RequestInit & { duplex?: 'half' };

/** The file's path on this computer; '' in a plain browser or for pasted content. */
export function localFilePath(
  file: File,
  bridge: Pick<AifisherDesktopBridge, 'pathForFile'> | null = desktopBridge(),
): string {
  try {
    return bridge?.pathForFile(file) || '';
  } catch {
    return '';
  }
}

export function fileUploadBody(file: Blob): UploadRequestInit {
  return file.size > STREAMED_UPLOAD_MIN_BYTES
    ? { body: file.stream(), duplex: 'half' }
    : { body: file };
}

export function projectArchiveRestoreRequest(
  file: File,
  bridge: Pick<AifisherDesktopBridge, 'pathForFile'> | null = desktopBridge(),
): RequestInit {
  const path = localFilePath(file, bridge);
  return path
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }
    : { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file };
}
