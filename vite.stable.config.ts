import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 在 HTML 元数据和运行时中写入同一个可读构建戳，便于定位当前运行版本。
 * 构建戳只能来自显式、可复现的输入，不能读墙钟时间，否则同一源码无法字节级复现。
 * 见 src/stable/main.ts 里把它写到 <html data-fisherai-build> 的那几行。
 */
export function resolveBuildStamp({
  version,
  explicit,
  sourceDateEpoch,
}: {
  version: string;
  explicit?: string;
  sourceDateEpoch?: string;
}): string {
  const supplied = String(explicit || '').trim();
  if (/^[A-Za-z0-9._-]{1,80}$/.test(supplied)) return supplied;
  if (sourceDateEpoch !== undefined && String(sourceDateEpoch).trim() !== '') {
    const epochSeconds = Number(sourceDateEpoch);
    if (Number.isFinite(epochSeconds) && epochSeconds >= 0) {
      return new Date(epochSeconds * 1_000)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
    }
  }
  return `v${version}`;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string; engines: { node: string } };
if (process.versions.node !== packageMetadata.engines.node) {
  throw new Error(`构建需要 Node ${packageMetadata.engines.node}，请使用 npm run build:stable。`);
}
const buildStamp = resolveBuildStamp({
  version: packageMetadata.version,
  explicit: process.env.FISHERAI_BUILD_STAMP,
  sourceDateEpoch: process.env.SOURCE_DATE_EPOCH,
});

function sourceOnlyBuild(): Plugin {
  let root = '';
  return {
    name: 'aifisher-source-only-build',
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { name: 'aifisher-version', content: packageMetadata.version },
          injectTo: 'head',
        },
        { tag: 'meta', attrs: { name: 'aifisher-build', content: buildStamp }, injectTo: 'head' },
      ];
    },
    moduleParsed(info) {
      // Dependencies may contain a published dist directory; application build
      // inputs must always originate in source, never the previous product output.
      const id = path.relative(root, info.id.split('?')[0]).replaceAll('\\', '/');
      if (/^(?:dist|output)\//.test(id))
        this.error(`Frontend source imports a generated artifact: ${info.id}`);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), sourceOnlyBuild()],
  define: {
    __FISHERAI_BUILD__: JSON.stringify(buildStamp),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // src/stable/main.ts awaits account preferences at the top level; every shell is current Chromium.
    target: 'es2022',
  },
});
