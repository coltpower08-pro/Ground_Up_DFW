import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 inlines everything into one HTML file (used for the shareable preview).
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.SINGLE ? [viteSingleFile()] : [])],
  build: { outDir: process.env.SINGLE ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1600 },
  // the single-file preview never loads Firebase
  define: { __LOCAL_ONLY__: JSON.stringify(!!process.env.SINGLE) },
});
