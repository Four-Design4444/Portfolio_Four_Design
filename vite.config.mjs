import { defineConfig } from 'vite';

// WeChat's in-app browser on older devices runs X5/XWeb kernels based on
// Chromium 57-86, which cannot parse ES2020+ syntax. Target ES2018 so the
// bundle parses everywhere; the size penalty is negligible.
export default defineConfig({
  /* 2026-10-10 业主「loading 进入一瞬间能看到 demo 残留·彻底清除」：
     原先 emptyOutDir:false ⇒ dist 从不清空，改名/删除掉的旧资源（如
     loading/typing-cat-v1.1.html 及其它已下线的 demo）会一直留在 dist 里，
     并被原样带到线上 —— 线上仍能直接访问到旧 demo 文件。
     dist 里全部是构建产物（public/ 的拷贝 + assets），没有手工维护的文件，
     所以改为 true：每次构建先清空，dist 恒等于「当前源码真实产出」。 */
  build: { emptyOutDir: true, target: 'es2018' },
  server: {
    host: '0.0.0.0',
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: process.env.PORT ? Number(process.env.PORT) : 4173,
    strictPort: false,
    allowedHosts: true
  }
});
