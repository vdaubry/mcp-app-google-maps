import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Single-file iframe bundle for the @vdaubry/mcp-app-google-maps MCP App.
//
// `@vis.gl/react-google-maps` ships as a React component lib; we alias react /
// react-dom to preact/compat so it works inside the Preact-only iframe.
export default defineConfig({
  root: __dirname,
  plugins: [preact(), viteSingleFile()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, '../node_modules/preact/compat'),
      'react-dom': path.resolve(__dirname, '../node_modules/preact/compat'),
      'react/jsx-runtime': path.resolve(__dirname, '../node_modules/preact/jsx-runtime'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
