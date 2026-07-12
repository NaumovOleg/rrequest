import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two webview surfaces (editor + sidebar) each load their bundle as a CLASSIC
// <script> (VS Code webviews block cross-origin ES-module fetches, and the host
// HTML forbids type="module"). A single multi-entry Rollup build would hoist the
// shared modules (store, ipc, React) into a code-split chunk that the entry
// files `import` from — which a classic script cannot execute. So we build each
// entry as its own self-contained bundle via `inlineDynamicImports`, selected by
// RM_ENTRY, emitting media/<entry>.js + media/<entry>.css.
const entry = (process.env.RM_ENTRY === 'sidebar' ? 'sidebar' : 'editor') as 'editor' | 'sidebar'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'media',
    // Only wipe media on the first (editor) pass so the second pass keeps it.
    emptyOutDir: entry === 'editor',
    rollupOptions: {
      input: { [entry]: `src/webview/${entry}/index.tsx` },
      output: {
        inlineDynamicImports: true,
        entryFileNames: '[name].js',
        assetFileNames: (asset) =>
          asset.name && asset.name.endsWith('.css') ? `${entry}.css` : '[name].[ext]',
      },
    },
  },
})
