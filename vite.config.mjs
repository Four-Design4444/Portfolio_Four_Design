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
  build: {
    emptyOutDir: true,
    target: 'es2018',
    rollupOptions: {
      output: {
        // Split the single 575KB app chunk into cache-friendly, parallel-loadable
        // pieces. Runtime order is unchanged (everything is still imported by the
        // entry), so no animation/home-motion behaviour is touched — this only
        // reorganises which module lands in which file.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/ogl/')) return 'webgl';        // contact-street + SideRays WebGL
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router') || id.includes('scheduler')) return 'react-vendor';
            if (id.includes('lucide-react')) return 'icons';  // icon set
            return 'vendor';
          }
          if (id.includes('detailScrolls')) return 'work-data'; // 11-work tile manifest
        }
      }
    }
  },
  plugins: [{
    name: 'mark-boot-entry',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.bundle) return html;
        const entry = /<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>/;
        if (!entry.test(html)) throw new Error('Missing Vite app entry: loading progress cannot track its script');
        return html.replace(entry, (tag) => tag.replace('<script ', '<script data-boot-entry '));
      }
    }
  }],
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
