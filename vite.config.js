import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { stripPrivateAssets } from './tools/private-assets.mjs';

/**
 * Vite copies the whole public directory into the output. The wallpaper
 * library lives in `public/assets`, so a local build would otherwise package
 * user artwork into dist/dist-embed. Strip it after the copy, unless the
 * operator explicitly opts into a private build.
 */
function privateAssetGuard(embed) {
  return {
    name: 'cxd-private-asset-guard',
    apply: 'build',
    closeBundle() {
      if (process.env.CXD_ALLOW_PRIVATE_ASSETS === '1') return;
      const outDir = resolve(process.cwd(), embed ? 'dist-embed' : 'dist');
      const removed = stripPrivateAssets(outDir);
      if (removed.length) {
        console.log(
          `[nuvio] stripped ${removed.length} private asset(s) from ${embed ? 'dist-embed' : 'dist'}`,
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const embed = mode === 'embed';

  return {
    base: './',
    plugins: [privateAssetGuard(embed)],
    server: { host: '127.0.0.1', port: 5273, strictPort: true },
    build: embed
      ? {
          outDir: 'dist-embed',
          emptyOutDir: true,
          target: 'chrome120',
          cssCodeSplit: false,
          assetsInlineLimit: 1024 * 1024,
          lib: {
            entry: resolve(process.cwd(), 'src/embed.js'),
            name: 'CodexDynamicBg',
            formats: ['iife'],
            fileName: () => 'codex-dynamic-bg.iife.js',
          },
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {
          outDir: 'dist',
          emptyOutDir: true,
          target: 'chrome120',
        },
  };
});
