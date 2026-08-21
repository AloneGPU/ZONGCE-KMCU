import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  return {
    base: './',
    build: {
      outDir: '../public',
      emptyOutDir: false,  // 不删除 public/ 已有的 legacy 文件和 uploads/
      copyPublicDir: false, // ZC-main/assets 已空，不复制
      rollupOptions: {
        output: {
          // 第三方库按职能拆包: 首屏只加载 react 与 UI 相关, 报表/PDF/表格等
          // 大库进入独立 chunk, 提升缓存命中率并降低首屏体积。
          manualChunks(id) {
            const parts = id.split(/[\\/]/);
            const nm = parts.indexOf('node_modules');
            if (nm === -1) return undefined;
            const pkg = parts[nm + 1];
            if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler' || pkg === 'motion' || pkg === 'framer-motion' || pkg === 'motion-dom' || pkg === 'motion-utils' || pkg === 'tslib' || pkg === 'react-is') return 'vendor-react';
            if (pkg === 'recharts' || pkg?.startsWith('d3-') || pkg === 'victory-vendor') return 'vendor-charts';
            if (pkg === 'jspdf' || pkg === 'html2canvas') return 'vendor-print';
            if (pkg === 'xlsx' || pkg?.startsWith('@e965')) return 'vendor-xlsx';
            if (pkg === 'lucide-react' || pkg === 'canvas-confetti') return 'vendor-icons';
            return 'vendor-misc';
          },
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
