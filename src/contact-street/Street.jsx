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

  // ── 后台降频（宿主侧叠加，不改动 demo 产物）────────────────────────────
  // 这条街景是 Three.js 场景，一旦挂上就每帧全量渲染：即使用户停在首屏看视频、
  // 甚至已经翻到二级/三级页（那时 HomePage 只是被 display:none，同源 iframe 的
  // rAF 照样跑），它也在烧 CPU —— 实测占满主线程 80%~87%。
  // three 的 WebGLAnimation 是 "requestAnimationFrame(i)" 递归，每帧都会重新
  // 查全局，所以在这里包一层就能控帧：__streetPaused 时把回调交给 setTimeout，
  // 循环不断 —— WebGL 上下文、已编译的 shader、已加载的纹理全部保活，回到尾屏
  // 立刻满帧，预挂载红利一点不丢 —— 但 CPU 从"每帧渲染"降到 ~4fps 空转。
  window.__streetPaused = false;
  var rawRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return rawRaf(function (t) {
      if (window.__streetPaused) {
        window.setTimeout(function () { cb(t); }, 1000);
        return;
      }
      cb(t);
    });
  };

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
  // 触摸端:区分「滑动切页」与「拖拽镜头」(2026-10-06 重写)。
  //
  // ① 方向约定(踩过的坑):iframe 直接把手指位移 dy 当 deltaY 转发,而父页 pager 的
  //    onWheel 是 step(deltaY > 0 ? 1 : -1) —— 手指上滑(dy<0)会被判成"上一屏",
  //    与移动端通行约定(上滑=下一屏)、也与父页自身 onTouchMove 的
  //    step(deltaY < 0 ? 1 : -1) 全部相反。实测探针(移动端触摸模拟)确认:
  //    上滑退到作品屏、下滑锁在尾屏。所以触摸路径统一取 -dy,**滚轮路径不动**
  //    (鼠标滚轮 deltaY<0 = 往回滚 = 上一屏,那个本来就是对的)。
  //
  // ② 为什么不再用「长按 280ms → 相机模式」(旧实现):
  //    旧逻辑只靠一个 280ms 定时器,手指落下后停顿超过它就永久切到相机模式,
  //    touchmove 直接 return —— 既不转发也不翻页。真人上滑几乎都是"慢起步":
  //    先悬停几百毫秒再划,必中此坑(实测 344ms / 452ms 静置 → 转发 0 条)。
  //
  // ③ 现在的双判(位移+速度,无定时器):
  //    · 纵向为主 → 翻页。慢速快速都翻,永不被误判成相机。
  //    · 横向为主 → 转镜头(demo 的 yaw/pitch 拖拽)。
  //    · 快速纵向划(瞬时速度 ≥ FLICK_V)→ 翻页,即便此前已静止很久。
  //    · 完全静止不动 → 什么都不判定,不会"看一眼就进相机模式"。
  //  ⚠ demo 的镜头拖拽绑定在 host=#scene 的 pointer 事件上,触摸会派生
  //    pointer 事件,所以相机模式里只要我们不转发、不 stopPropagation,
  //    demo 就能照常收到 pointermove 完成旋转。
  var tId = -1, tStartX = 0, tStartY = 0, lastX = 0, lastY = 0, lastT = 0;
  var FLICK_V = 0.25;    // px/ms,纵向瞬时速度阈值
  var AXIS_D = 10;       // px,判定主轴所需的位移
  var tMode = 'pending'; // pending | swipe | cam

  // 相机模式合成的鼠标事件。demo 产物里的旋转门槛是
  //   pointermove: $d && (e.pointerType==='mouse' || mode!=='overview')
  //   pointerdown: e.isTrusted && (e.pointerType==='mouse' || t) && setPointerCapture
  // 也就是说【概览模式下 demo 只认鼠标】,手指的原生 pointer 事件 pointerType='touch'
  // 一律被挡在门外 —— 这是 demo 自己的既定行为(它为桌面设计),实测触摸拖动
  // pointerdown/pointermove 各派发 1/14 次但 yaw 恒为 0,同一拖动鼠标 yaw=-0.1186。
  // pointerType / isTrusted 都不可伪造,所以宿主侧只能**自己合成** mouse 事件喂给
  // #scene,让它走和 PC 拖拽完全相同的那条代码路径。
  //
  // ⚠ pointerId 必须沿用触摸那一次原生 pointerdown 的真实 id：demo 的 pointermove
  //   第一道门是ef && e.pointerId === ef.id,ef 是原生 pointerdown 建的,里面记着
  //   真实 pointerId。早期用固定 99 合成,事件确实派发到了 #scene(types 里能看到
  //   mouse),但整段仍被这道门跳过 —— yaw 恒 0。所以这里从原生 pointerdown 上"偷" id。
  var camPid = -1;
  var camMove = function (x, y) {
    var scene = document.getElementById('scene');
    if (!scene || camPid < 0) return;
    try {
      scene.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: camPid, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true,
        clientX: x, clientY: y, button: 0, buttons: 1,
      }));
    } catch (_) {}
  };
  var camUp = function (x, y) {
    var scene = document.getElementById('scene');
    if (!scene || camPid < 0) return;
    try {
      scene.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: camPid, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true,
        clientX: x, clientY: y, button: 0, buttons: 0,
      }));
    } catch (_) {}
    camPid = -1;
  };
  // 记住原生 pointerdown 的 pointerId（不 stopPropagation，demo 仍能收到它）。
  window.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'touch') camPid = ev.pointerId;
  }, { passive: true, capture: true });
  window.addEventListener('touchstart', function (ev) {
    if (ev.touches.length !== 1) { tId = -1; return; }
    var t = ev.touches[0];
    tId = t.identifier;
    tStartX = lastX = t.clientX;
    tStartY = lastY = t.clientY;
    lastT = performance.now();
    tMode = 'pending';
  }, { passive: true, capture: true });
  window.addEventListener('touchmove', function (ev) {
    if (tId < 0) return;
    var i = -1;
    for (var k = 0; k < ev.touches.length; k += 1) if (ev.touches[k].identifier === tId) i = k;
    if (i < 0) { tId = -1; return; }
    var x = ev.touches[i].clientX;
    var y = ev.touches[i].clientY;
    var dy = y - lastY;
    var ddx = x - tStartX;
    var ddy = y - tStartY;
    var now = performance.now();
    var dt = Math.max(1, now - lastT);
    var vy = dy / dt;
    ev.preventDefault();                           // iframe 自身永不滚
    if (tMode === 'pending') {
      var ax = Math.abs(ddx), ay = Math.abs(ddy);
      var flick = Math.abs(vy) >= FLICK_V && ay >= 6;
      if (flick) tMode = 'swipe';                  // 快速纵向划 → 永远翻页
      else if (ay > ax && ay >= AXIS_D) tMode = 'swipe';   // 纵向为主 → 翻页
      else if (ax >= AXIS_D) tMode = 'cam';               // 横向为主 → 转镜头
    }
    lastX = x; lastY = y; lastT = now;
    if (tMode !== 'swipe') { if (tMode === 'cam') camMove(x, y); return; }
    if (Math.abs(dy) >= 1) post(-dy, x, y);        // 取负 → 上滑 = 下一屏
  }, { passive: false, capture: true });
  window.addEventListener('touchend', function () {
    if (tMode === 'cam') camUp(lastX, lastY);
    tId = -1; tMode = 'pending';
  }, { passive: true, capture: true });
  window.addEventListener('touchcancel', function () {
    if (tMode === 'cam') camUp(lastX, lastY);
    tId = -1; tMode = 'pending';
  }, { passive: true, capture: true });
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

// demo 的夜街有 2.7s 的 intro 灯光渐入（scene.js: intro += dt/2.7），intro 没走
// 完时灯只有 35% 亮度。尾屏挂载已提前到 loading 阶段（见 HomePage），但其渲染在
// 不可见时一律空转（__streetPaused）：灯光烧录只在真正进入尾屏（active=true）时
// 满帧播放，避免提前烧录的满帧渲染漏进 hero 播放期抢主线程/GPU。

export default function ContactStreet({ active, preload, onTailReady }) {
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

  // 降频开关（P-04）：尾屏不在视口内时，3D 渲染立即压到空转保活，绝不跑满帧
  // intro 烧录。原因：尾屏挂载已提前到 loading 阶段（见 HomePage），而 loading 通常
  // 比尾屏 intro 烧录（约 3.2s）短 —— 若此时满帧烧录，会漏进 hero 播放的头几秒，
  // 与首屏视频抢同一条主线程/GPU 造成卡顿（iframe 与父页面同源，JS 跑在同一条主线程上）。
  // shader 编译在 iframe 加载时一次性完成，与 __streetPaused 无关，所以"提前挂载"的
  // 预编译红利照样保留；灯光烧录改到真正进入尾屏（active=true）时再满帧播放即可。
  //
  // ⚠ 时序：HOST_JS 在 iframe 文档加载时把 window.__streetPaused 初始化为 false，
  // 若这里在文档就绪前就写 true，会写在与正式文档不同的 window 上、随后被 HOST_JS
  // 覆盖回 false —— 于是尾屏始终满帧。所以必须等 __streetHostHooked(=HOST_JS 已注入)
  // 之后再写；active 变化时本 effect 重跑会重新写入。
  useEffect(() => {
    if (!mounted) return undefined;
    let stopped = false;
    let timer = null;
    const apply = () => {
      if (stopped) return;
      const win = frameRef.current && frameRef.current.contentWindow;
      if (!win || !win.__streetHostHooked) { timer = window.setTimeout(apply, 100); return; }
      try { win.__streetPaused = !active; } catch (_) { /* 已销毁 / 跨域时静默 */ }
    };
    apply();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [mounted, active]);

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
    // 把尾屏 WebGL 预载进度并回首屏 loading 进度条（见 index.html 监听）：
    // 挂载即登记 0，编译完成（#loading.loaded / canvas 已绘制）登记 1，并通知父页面。
    let tailReported = false;
    const reportTailReady = () => {
      if (tailReported) return;
      tailReported = true;
      try { window.dispatchEvent(new CustomEvent('loading:progress', { detail: { id: 'tail', weight: 2, progress: 1 } })); } catch (_) {}
      try { if (onTailReady) onTailReady(); } catch (_) {}
    };
    try { window.dispatchEvent(new CustomEvent('loading:progress', { detail: { id: 'tail', weight: 2, progress: 0 } })); } catch (_) {}

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
          // 双信号就绪判定（任一成立即可）：
          //  ① demo 的 ui.setReady() 给 #loading 加 .loaded —— 时机是
          //     await renderer.compileAsync() 之后，即 shader 编译完成、场景可画
          //     （demo src/main.js:314 → ui.js:35）。
          //  ② canvas 已产生非零绘制尺寸 —— "真的画出来了"的物理证据，不依赖
          //     demo 的内部实现；demo 万一改了类名也不会误判。
    const loading = doc.getElementById('loading');
  if (loading && loading.classList.contains('loaded')) {
            readyDone = true;
            reportTailReady();
          } else {
            const canvas = doc.querySelector('#scene canvas');
            if (canvas && canvas.width > 0 && canvas.height > 0) {
              readyDone = true;
              reportTailReady();
            }
          }
        }
        if (!readyDone) {
          // 兜底：demo 因 WebGL 不可用走 catch 分支时也会调 setReady()；若它彻底
          // 没跑起来，最多等 15s 才强制揭幕。
          // ⚠ 原值 6s 太短 —— 慢 GPU / 同时开着其他 WebGL 页面时编译可能超过 6s，
          //   就会把"还没编译完"误判成"好了"，揭幕后用户看到一片空白底色
          //   （业主反馈"有时下滑下来模型还加载不出来"）。宁可遮罩多留一会儿，
          //   也绝不能提前露出未就绪的场景 —— 失败方向必须是安全的。
elapsed += 1;
          if (elapsed > 900) { readyDone = true; reportTailReady(); }
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