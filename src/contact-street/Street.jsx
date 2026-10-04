// V3.1.12「联系我们」demo（雨夜街角 3D 场景）原封不动嵌入首页尾屏。
// 整包构建产物放在 public/contact-street/（index.html + assets + logo.svg +
// site-config.json；相对路径由 demo 的 base:'./' 保证），这里只用一个全屏
// iframe 加载它 —— demo 字节级不变、不进 React 构建图、不重移植。
import { useCallback, useEffect, useRef, useState } from 'react';

const DEMO_URL = `${import.meta.env.BASE_URL}contact-street/index.html`;

// ── 宿主侧叠加（全部在 demo 之外，绝不改动 V3.1.12 构建产物）──────────────────
// ①隐藏 demo 顶部那一栏品牌 / 天气 / 时钟文字（.header），保留底部导航栏。
// ② 隐藏加载动画：#loading 覆盖全屏且 z-index:100，是 demo 用来遮 Three.js 冷启动的
//   （src/main.js 里 await renderer.compileAsync 后才 setReady 加 .loaded 淡出 1s）。
// ③ 禁用 demo 内部滚动、但完整保留指针交互：
//   demo 的"滚动探索"靠 #journey{height:500vh} + window scroll 驱动相机 progress
//   （scene.js: listen(window,'scroll')）。它自己**没有 wheel 监听器**，
//   所以只要 iframe 文档不滚，相机就锁定在起始机位：
//     · wheel/touchmove 在 capture 阶段 preventDefault → iframe 不滚 → 相机不动；
//     · 再把 deltaY 用 postMessage 交给 parent.window → 父页面 pager 翻屏。
//   ⚠ 绝不能用 pointer-events:none —— 那会连 demo 的拖动旋转镜头 / 射线点击热区 /
//     hover 标签一起杀掉（它们绑定在 host=#scene 的 pointerdown/move/up）。
//     滚轮与指针是不同事件，各走各的通道，互不干扰。
const HOST_CSS = `
#loading { display: none !important; }
.header { display: none !important; }
`;

// iframe 内部执行：劫持滚动 → 交还父页面；其余一概不碰。
// postMessage 是单向的（iframe → parent），父页面不回灌，因此不会有转发环路。
const HOST_JS = `
(function () {
  if (window.__streetHostHooked) return;
  window.__streetHostHooked = true;
  var post = function (dy, cx, cy) {
    try {
      window.parent.postMessage({
        __streetContact: true,
        type: 'wheel',
        deltaY: dy,
        clientX: cx,
        clientY: cy,
      }, '*');
    } catch (_) {}
  };
  window.addEventListener('wheel', function (ev) {
    if (ev.ctrlKey || ev.metaKey) return;          // 捏合缩放不管
    ev.preventDefault();                            // iframe 自己不滚 → demo 相机不动
    post(ev.deltaY, ev.clientX, ev.clientY);
  }, { passive: false, capture: true });
  // 触摸端同理：阻止 iframe 内滚动，把纵向位移交给父页面翻页。
  var tY = 0, tId = -1;
  window.addEventListener('touchstart', function (ev) {
    if (ev.touches.length !== 1) { tId = -1; return; }
    tId = ev.touches[0].identifier; tY = ev.touches[0].clientY;
  }, { passive: true, capture: true });
  window.addEventListener('touchmove', function (ev) {
    if (tId < 0) return;
    var i = -1;
    for (var k = 0; k < ev.touches.length; k += 1) if (ev.touches[k].identifier === tId) i = k;
    if (i < 0) { tId = -1; return; }
    var y = ev.touches[i].clientY;
    var dy = y - tY;
    if (Math.abs(dy) >= 2) { tY = y; post(dy, ev.touches[i].clientX, y); }
    ev.preventDefault();
  }, { passive: false, capture: true });
  window.addEventListener('touchend', function () { tId = -1; }, { passive: true, capture: true });
  window.addEventListener('touchcancel', function () { tId = -1; }, { passive: true, capture: true });
  // 冷启动期间若因任何原因产生了位移，归零，保证相机停在 overview 起始机位。
  window.scrollTo(0, 0);
})();
`;

function injectHostCss(doc) {
  if (!doc || !doc.head) return false;
  if (doc.getElementById('contact-host-css')) return true;
  const style = doc.createElement('style');
  style.id = 'contact-host-css';
  style.textContent = HOST_CSS;
  doc.head.appendChild(style);
  return true;
}

function injectHostJs(doc) {
  if (!doc || !doc.body) return false;
  if (doc.getElementById('contact-host-js')) return true;
  const el = doc.createElement('script');
  el.id = 'contact-host-js';
  el.textContent = HOST_JS;
  doc.body.appendChild(el);
  return true;
}

// 父页面侧接收 iframe 的滚动转发，合成 WheelEvent 交给 pager 的 onWheel。
function useStreetWheelBridge(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onMessage = (event) => {
      const d = event.data;
      if (!d || d.__streetContact !== true || d.type !== 'wheel') return;
      try {
        const dy = Number(d.deltaY) || 0;
        if (Math.abs(dy) < 2) return;
        window.dispatchEvent(new WheelEvent('wheel', {
          deltaY: dy,
          deltaX: 0,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          clientX: Number(d.clientX) || 0,
          clientY: Number(d.clientY) || 0,
        }));
      } catch (_) { /* 忽略 */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled]);
}

export default function ContactStreet({ active, preload }) {
  // 挂载条件：进入尾屏(active)，或提前一屏(preload)—— 提前挂载让 Three.js 的
  // WebGL 上下文创建与 shader 编译在翻页动画之前完成，避免"滑到尾屏一瞬间跳帧"。
  const [mounted, setMounted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const frameRef = useRef(null);
  const everActive = useRef(false);

  useEffect(() => {
    if (active) everActive.current = true;
    if (active || preload) setMounted(true);
  }, [active, preload]);

  useStreetWheelBridge(mounted && active);

  // 揭幕协调器（P-03 的核心）。
  //
  // 为什么必须有遮罩：iframe 与父页面**同源**，它的 JS（含 WebGL shader 编译）
  // 和父页面跑在**同一条主线程**上。所以父页面里的任何轮询/回调在编译期间都会被
  // 饿死 —— 实测 16ms 间隔的监视器只在忙碌前拿到 16 次采样，加载动画照样闪了
  // （探针 loadingEverVisible=true）。也就是说"在父页面抢时机注入 CSS"这条路
  // 物理上不可靠。
  //
  // 换成不依赖时机的做法：在 iframe 上面盖一层**父页面的**不透明遮罩（#101c26，
  // 与 demo 底色一致）。遮罩是父页面元素，完全不受同源阻塞影响，因此它从第一帧
  // 起就稳稳盖住 #loading（以及 .header），用户绝无可能看到加载动画。
  // 等 demo 自己给 #loading 加上 .loaded（= compileAsync 完成、场景就绪）后，
  // 再淡出遮罩。
  //
  // 顺序很重要：必须先确认 HOST_CSS 已注入（.header 被藏好），才揭幕。
  // 若主线程被饿死，只会推迟揭幕（遮罩多留一会儿），绝不会提前露出加载层 ——
  // 失败方向是安全的。
  useEffect(() => {
    if (!mounted) return undefined;
    let stopped = false;
    let raf = 0;
    let cssDone = false;
    let readyDone = false;
    let elapsed = 0;

    const attempt = () => {
      if (stopped) return;
      const frame = frameRef.current;
      if (!frame) { raf = window.requestAnimationFrame(attempt); return; }
      let doc = null;
      let win = null;
      try { doc = frame.contentDocument; win = frame.contentWindow; } catch (_) { doc = null; }
      if (doc) {
        if (!cssDone) {
          try { cssDone = injectHostCss(doc) && injectHostJs(doc); } catch (_) { cssDone = false; }
        }
        if (!readyDone) {
          // demo 的 ui.setReady() 就是给 #loading 加 .loaded（src/ui.js:35）。
          const loading = doc.getElementById('loading');
          if (loading && loading.classList.contains('loaded')) readyDone = true;
          else if (!loading && win && doc.querySelector('#scene canvas')) readyDone = true;
        }
        if (!readyDone) {
          // 兜底：demo 若因 WebGL 不可用走 catch 分支，也会调 setReady；
          // 若它彻底没跑起来，最多等 6s 就揭幕，让用户至少能看到联系方式入口。
          elapsed += 1;
          if (elapsed > 360) readyDone = true;
        }
      }
      if (cssDone && readyDone) {
        setRevealed(true);
        try { win && win.scrollTo(0, 0); } catch (_) { /* 未就绪 */ }
        return;
      }
      raf = window.requestAnimationFrame(attempt);
    };

    raf = window.requestAnimationFrame(attempt);
    return () => { stopped = true; window.cancelAnimationFrame(raf); };
  }, [mounted]);

  const handleLoad = useCallback(() => {
    // 文档已就位：补一次注入（幂等）。真正的揭幕由上面的协调器负责。
    try { applyHostOverrides(frameRef.current); } catch (_) { /* noop */ }
  }, []);

  if (!mounted) return null;
  return (
    <>
      <iframe
        ref={frameRef}
        className="street-contact-frame"
        src={DEMO_URL}
        title="Four Design · 夜深了，灵感还亮着"
        allow="autoplay; fullscreen"
        onLoad={handleLoad}
      />
      {/* 不透明揭幕遮罩：父页面元素，不受 iframe 同源主线程阻塞影响 */}
      <div className={`street-contact-veil${revealed ? ' is-gone' : ''}`} aria-hidden="true" />
    </>
  );
}

// onLoad 时的兜底注入（幂等）。真正的揭幕由上面的协调器负责。
function applyHostOverrides(iframe) {
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    injectHostCss(doc);
    injectHostJs(doc);
  } catch (_) {
    /* 同源 public 资源可读；跨域时静默跳过 */
  }
}