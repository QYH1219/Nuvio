import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const embed = mode === 'embed';

  return {
    base: './',
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
