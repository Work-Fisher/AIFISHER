import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';

export const APP_SCHEME = 'aifisher';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
});

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade'];
// The backend trusts the pipe; browser provenance headers would only trip its loopback checks.
const DROPPED_REQUEST_HEADERS = new Set([...HOP_BY_HOP, 'host', 'origin', 'referer']);
const DROPPED_RESPONSE_HEADERS = new Set(HOP_BY_HOP);
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
});

export function isBackendPath(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/library/') ||
    pathname === '/diagnostics' ||
    pathname.startsWith('/diagnostics/')
  );
}

export function reconnectingResponse() {
  return new Response(
    JSON.stringify({ error: '本机服务正在重新连接，请稍后重试。', code: 'BACKEND_RECONNECTING' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '1',
      },
    },
  );
}

// Streams both bodies; Range and every other end-to-end header pass through untouched.
export function forwardToBackend(request, pipe, { requestImpl = http.request } = {}) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((value, key) => {
    if (!DROPPED_REQUEST_HEADERS.has(key)) headers[key] = value;
  });
  return new Promise((resolve) => {
    let answered = false;
    const answer = (response) => {
      if (answered) return;
      answered = true;
      resolve(response);
    };
    const outgoing = requestImpl(
      { socketPath: pipe, method: request.method, path: `${url.pathname}${url.search}`, headers },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (DROPPED_RESPONSE_HEADERS.has(key)) continue;
          for (const item of [value].flat()) responseHeaders.append(key, String(item));
        }
        const empty =
          request.method === 'HEAD' || incoming.statusCode === 204 || incoming.statusCode === 304;
        if (empty) incoming.resume();
        answer(
          new Response(empty ? null : Readable.toWeb(incoming), {
            status: incoming.statusCode,
            headers: responseHeaders,
          }),
        );
      },
    );
    // A backend that exits mid-request looks like a restart to the page, not a network failure.
    outgoing.on('error', () => answer(reconnectingResponse()));
    request.signal?.addEventListener('abort', () => outgoing.destroy(), { once: true });
    if (request.body) {
      const body = Readable.fromWeb(request.body);
      body.on('error', () => outgoing.destroy());
      body.pipe(outgoing);
    } else {
      outgoing.end();
    }
  });
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function regularFile(file) {
  try {
    const details = await stat(file);
    return details.isFile() ? details : null;
  } catch {
    return null;
  }
}

// Serves a built single-page app; extensionless paths fall back to its index.html.
export async function serveStatic(root, pathname) {
  const base = path.resolve(root);
  const target = path.resolve(base, `.${pathname}`);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return notFound();
  let file = target;
  let details = await regularFile(file);
  if (!details && !path.extname(pathname)) {
    file = path.join(base, 'index.html');
    details = await regularFile(file);
  }
  if (!details) return notFound();
  return new Response(Readable.toWeb(createReadStream(file)), {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(details.size),
      'Cache-Control': 'no-cache',
    },
  });
}

export function createAppProtocolHandler({ backend, distDirectory, launcherDirectory, requestImpl }) {
  return async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return notFound();
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    if (isBackendPath(pathname)) {
      const pipe = backend.pipePath();
      return pipe ? forwardToBackend(request, pipe, { requestImpl }) : reconnectingResponse();
    }
    if (pathname === '/launcher' || pathname.startsWith('/launcher/')) {
      return serveStatic(launcherDirectory, pathname.slice('/launcher'.length) || '/');
    }
    return serveStatic(distDirectory, pathname);
  };
}
