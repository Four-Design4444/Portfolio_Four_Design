// V3.1.12「联系我们」demo（雨夜街角 3D 场景）原封不动嵌入首页尾屏。
// 整包构建产物放在 public/contact-street/（index.html + assets + logo.svg +
// site-config.json；相对路径由 demo 的 base:'./' 保证），这里只用一个全屏
// iframe 加载它 —— demo 字节级不变、不进 React 构建图、不重移植。
// 懒挂载：进入尾屏(active 为真)才把 src 挂上，避免提前 boot 重型 Three.js 场景。
import { useCallback, useEffect, useRef, useState } from 'react';

const DEMO_URL = `${import.meta.env.BASE_URL}contact-street/index.html`;

// ── 宿主侧叠加（全部在 demo 之外，绝不改动 V3.1.12 构建产物）──────────────────
// ①隐藏 demo 顶部那一栏品牌 / 天气 / 时钟文字（.header），保留底部导航栏。
// ② 隐藏加载动画：#loading 覆盖全屏且 z-index:100，demo 用它遮住 Three.js 冷启动
//   （src/main.js 里 await renderer.compileAsync 后才 setReady 加 .loaded 淡出 1s）。
//   直接 display:none 让它永不出现，场景一渲染好就是最终画面。
// ③ 禁用 demo 内部滚动、但完整保留指针交互：
//   demo 的"滚动探索"靠 #journey{height:500vh} + window scroll 驱动相机 progress
//   （scene.js: listen(window,'scroll') → progress = scrollY / 可滚动高度）。
//   所以只要掐掉 iframe 内的滚动即可，无需改它源码：
//     · wheel/touchmove 在 capture 阶段 preventDefault → iframe 文档不滚 → 相机不动；
//     · 再把deltaY 以合成 WheelEvent 派发给 parent.window → 父页面 pager 收到 → 翻屏。
//   ⚠ 绝不能用 pointer-events:none —— 那会连 demo 的拖动旋转镜头 / 点击热区 /
//     hover 标签一起杀掉（它们绑定在 host=#scene 的 pointerdown/move/up 上）。
//     滚轮与指针是不同事件，互不干扰，各走各的通道。
const HOST_CSS = `
#loading { display: none !important; }
.header { display: none !important; }
`;

// 在 iframe 内部执行：劫持滚动 → 交还父页面；其余一概不碰。
// 用 postMessage 把 deltaY 传给父页面，由父页面派发合成 WheelEvent（P-01 方案）：
// iframe → parent 只有一个方向，不存在父→iframe 的回灌，因此不会有转发环路。
const HOST_JS = `
(function () {
  if (window.__streetHostHooked) return;
  window.__streetHostHooked = true;
  var post = function (type, dy, cx, cy) {
    try {
      window.parent.postMessage({
        __streetContact: true,
        type: type,
        deltaY: dy,
        clientX: cx,
        clientY: cy,
      }, '*');
    } catch (_) {}
  };
  window.addEventListener('wheel', function (ev) {
    if (ev.ctrlKey || ev.metaKey) return;          // 捏合缩放不管
    ev.preventDefault();                            // iframe 自己不滚 → demo 相机不动
    post('wheel', ev.deltaY, ev.clientX, ev.clientY);
  }, { passive: false, capture: true });
  // 触摸端同理：阻止 iframe 内滚动，把纵向位移交给父页面翻屏。
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
    if (Math.abs(dy) >= 2) { tY = y; post('wheel', dy, ev.touches[i].clientX, y); }
    ev.preventDefault();
  }, { passive: false, capture: true });
  window.addEventListener('touchend', function () { tId = -1; }, { passive: true, capture: true });
  window.addEventListener('touchcancel', function () { tId = -1; }, { passive: true, capture: true });
  // 冷启动期间若因任何原因产生了位移，归零，保证相机停在 overview 起始机位。
  window.scrollTo(0, 0);
})();
`;

function applyHostOverrides(iframe) {
  if (!iframe) return;
  const doc = iframe.contentDocument;
  if (!doc) return;
  if (doc.head && !doc.getElementById('contact-host-css')) {
    const style = doc.createElement('style');
    style.id = 'contact-host-css';
    style.textContent = HOST_CSS;
    doc.head.appendChild(style);
  }
  if (doc.body && !doc.getElementById('contact-host-js')) {
    const el = doc.createElement('script');
    el.id = 'contact-host-js';
    el.textContent = HOST_JS;
    doc.body.appendChild(el);
  }
  // demo 的 #journey 有 500vh，若历史上滚过则把 iframe 内部滚动归零。
  try { iframe.contentWindow.scrollTo(0, 0); } catch (_) { /* 未就绪 */ }
}

export default function ContactStreet({ active }) {
  const [everActive, setEverActive] = useState(false);
  const frameRef = useRef(null);
  useEffect(() => { if (active) setEverActive(true); }, [active]);

  // 父页面侧接收 iframe 的滚动转发，合成 WheelEvent 交给 pager 的 onWheel。
  // pager 自己的 onWheel 会做 gesture gap / lock / preventDefault，无需额外状态。
  useEffect(() => {
    if (!everActive) return undefined;
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
  }, [everActive]);

  // onLoad 只在 iframe 每次加载后触发；demo 的 module script 是 defer/module，
  // onLoad 时 head/body 均已就绪，可以安全注入。
  const handleLoad = useCallback((e) => { applyHostOverrides(e.currentTarget); }, []);

  // 兜底：若 onLoad 已过（例如极快加载）而注入尚未生效，在挂载后再试一次。
  useEffect(() => {
    if (!everActive) return;
    const t = window.setTimeout(() => applyHostOverrides(frameRef.current), 0);
    return () => window.clearTimeout(t);
  }, [everActive]);

  if (!everActive) return null;
  return (
    <iframe
      ref={frameRef}
      className="street-contact-frame"
      src={DEMO_URL}
      title="Four Design · 夜深了，灵感还亮着"
      allow="autoplay; fullscreen"
      onLoad={handleLoad}
    />
  );
}