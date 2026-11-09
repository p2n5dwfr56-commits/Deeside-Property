import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// base './' so the built app works from any folder (Netlify, a private preview, or a file on disk)
export default defineConfig({ plugins: [react()], base: './', test: { globals: true, include: ['src/**/*.test.ts'] } });
