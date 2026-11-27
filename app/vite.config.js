import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsInlineLimit: 0, // keep CSP strict: no data: URLs for scripts or styles
  },
  server: {
    // `npm run dev` proxies the API to a locally running `npm start` (mock catalog by default).
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
    setupFiles: ['test/setup.js'],
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/web/main.jsx', 'src/server/healthcheck.js'],
      reporter: ['text-summary', 'lcov', 'cobertura'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
