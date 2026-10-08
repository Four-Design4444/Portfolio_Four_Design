// V3.1.12「联系我们」demo（雨夜街角 3D 场景）原封不动嵌入首页尾屏。
// 整包构建产物放在 public/contact-street/（index.html + assets + logo.svg +
// site-config.json；相对路径由 demo 的 base:'./' 保证），这里只用一个全屏
// iframe 加载它 —— demo 字节级不变、不进 React 构建图、不重移植。
import { useCallback, useEffect, useRef, useState } from 'react';

const DEMO_URL = `${import.meta.env.BASE_URL}contact-street/index.html`;

// 尾屏「烧录」——把这条街的冷启动代价全部塞进首屏 loading 遮罩期间，遮罩掀开时
// 用户只看到一条已经烧熟的街。为什么非要烧：这条街一旦满帧渲染就吃掉主线程
// 80%~87%，修复前它是在**首屏揭幕那一刻**才开始满帧烧的，实测在揭幕后 3200ms
// 窗口里独占主线程 2095ms（65%），正好压在 hero 入场动画上 —— 那就是"loading
// 结束后 hero 依旧长时间卡顿"的根因。现在改为：烧录只允许发生在 loading 期间，
// 且受控帧率（见 BURN_FRAME_MS），首屏揭幕后它绝不再抢主线程。
//
// 判据不是墙钟毫秒，而是「demo 的灯光到底亮没亮」：
//   ① 能读到 demo 自己的灯光脉冲值 n 时（HOST_JS 的一次性钩子）→ 烧到 n≥BURN_LIT；
//   ② 读不到时退化为帧预算 BURN_FRAMES —— demo 每帧最多推进 dt=0.05s，帧数即场景
//      时间，所以这个预算是可算的，而不是拍脑袋的毫秒数。机器慢只会让墙钟变长，
//      不会让"灯还没亮满"就揭幕。
//
// 烧录帧预算 —— **首选判据**，不依赖任何内部状态。
// demo 的灯光是一条 4.8s 周期的余弦脉冲（bundle 里 update(e,t) 的原文）：
//     n = (0.5 - 0.5*cos(e*2π/4.8))^1.3      // e = 累计场景时间 nf
//     mt.intensity = 0.015 + n*0.84           // 主光：近黑 → 全亮
//     at.emissiveIntensity = n*1.865          // 车灯/腰线光带
// n=0 在 e=0、4.8…；n=1（最亮）在 e=2.4、7.2…。而 demo 每帧最多推进 dt=0.05s
// （Math.min((e-rf)/1e3||.016,.05)），所以：
//     · 烧录档的渲染间隔就是 BURN_FRAME_MS(40ms)，回调报真实时钟，于是 dt≈0.04s；
//     · 配合「armed 之前把场景钟冻住」（见渲染档位 effect），烧录的第 0 帧 nf≈0；
//     · 于是 60 帧 ≈ 2.4s，正好推到波峰（52 帧只在 dt 恒为 0.05 时才够，真实
//       dt≈0.04 时只到 2.08s / n≈0.94，会在波峰前收工 —— 故上调到 60）。
const BURN_FRAMES = 60;
// 若能读到 demo 真正的脉冲值 n（HOST_JS 的一次性钩子，见 __streetState），就以它
// 为准：n≥0.95 即"已经最亮"。读到读数时**不再按帧数提前收工**，而是继续烧到亮为止
// （上限一个多周期），这样哪怕有帧被 demo 自己丢掉也不会停在半亮。
const BURN_LIT = 0.95;
const BURN_MAX_FRAMES = 130;
// 烧录档的**渲染间隔**。回调里报的是真实时钟，所以场景推进速度 = 真实 dt
// （≈ 这个值，且被 demo clamp 到 50ms 上限）—— 不再有独立的"场景步长"概念。
// 帧数由 BURN_FRAMES 定死（60 帧，CPU 总量因此定死 ≈0.6s），这个值只决定这
// 0.6s 摊在多少墙钟时间里：40ms ⇒ 约 2.4s、主线程占用约 25%，与 loading 动画
// 和平共处；调小能更快揭幕，但占用升高、动画会顿。
const BURN_FRAME_MS = 40;
// 墙钟兜底：demo 彻底卡死或帧率异常时，加载页也不能被它拖到永远。
const BURN_MAX_MS = 9000;

export default function ContactStreet({ active, preload, onTailReady, onTailBurned }) {
  // 挂载条件：进入尾屏(active)，或提前一屏(preload)—— 提前挂载让 Three.js 的
  // WebGL 上下文创建与 shader 编译在翻页动画之前完成，避免"滑到尾屏一瞬间跳帧"。
  const [mounted, setMounted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const frameRef = useRef(null);
  // demo 是否已冷启动完成（compileAsync 完成 / canvas 已画出）。烧录只在这之后开始，
  // 因为 demo 的动画循环是编译完成后才起的。
  const [armed, setArmed] = useState(false);
  // 灯光是否已烧完。烧完 = 尾屏进入瞬间就是"满亮度满帧"，不会再有提速跳变。
  const [burned, setBurned] = useState(false);
  const burnedRef = useRef(false);
  const tailReportedRef = useRef(false);
  const tailZeroRef = useRef(false);

  useEffect(() => {
    if (active || preload) setMounted(true);
  }, [active, preload]);

  // 烧录协调：冷启动完成 → 按帧预算烧到灯光波峰 → 熄灭（除非用户已在尾屏）。
  // 它完全发生在首屏 loading 遮罩期间，用户看不到，但揭幕时尾屏已经"熟"了：
  // 灯全亮、shader/纹理/阴影贴图全部就位，用户翻到尾屏的第一帧就是满帧好画面。
  useEffect(() => {
    if (!mounted || !armed || burnedRef.current) return undefined;
    let stopped = false;
    let poll = 0;
    const startedAt = performance.now();
    const readWin = () => {
      try { return (frameRef.current && frameRef.current.contentWindow) || null; } catch (_) { return null; }
    };
    const finish = () => {
      if (stopped || burnedRef.current) return;
      burnedRef.current = true;
      setBurned(true);
      try { window.dispatchEvent(new CustomEvent('loading:progress', { detail: { id: 'tail', weight: 2, progress: 1 } })); } catch (_) {}
      try { if (onTailBurned) onTailBurned(); } catch (_) { /* noop */ }
    };
    const check = () => {
      if (stopped) return;
      const win = readWin();
      const frames = (win && win.__streetBurnFrames) || 0;
      // 进度条如实反映烧录推进：0.75 → 1.0（单调，不会像按 n 那样来回跳）。
      try {
        window.dispatchEvent(new CustomEvent('loading:progress', {
          detail: { id: 'tail', weight: 2, progress: 0.75 + 0.25 * Math.min(1, frames / BURN_FRAMES) },
        }));
      } catch (_) {}
      // 能读到 demo 的脉冲值就以它为准（已经最亮就直接放行，不必凑满帧数）。
      let n = -1;
      try {
        const st = win && win.__streetState;
        if (st && st.charging) n = Number(st.charging.phase);
      } catch (_) { n = -1; }
      const wall = performance.now() - startedAt;
      // 有脉冲读数 → 烧到真的亮（n≥0.95）为止；没有读数 → 退化为帧预算（正好到波峰）。
      const done = n >= 0
        ? (n >= BURN_LIT || frames >= BURN_MAX_FRAMES)
        : frames >= BURN_FRAMES;
      if (done || wall >= BURN_MAX_MS) { finish(); return; }
      poll = window.setTimeout(check, 100);
    };
    poll = window.setTimeout(check, 100);
    return () => { stopped = true; if (poll) window.clearTimeout(poll); };
  }, [mounted, armed, onTailBurned]);

  // 渲染档位（P-04 + 2026-10-08 修正）：
  //   ① 用户已在尾屏(active)          → 满帧
  //   ② 冷启动完成且尚未烧完           → 受控帧率烧录（只在 loading 遮罩期，或
  //                                      兜底期；**绝不**满帧）
  //   ③ 其余（未冷启动 / 烧完且不在尾屏）→ 空转保活 ~1fps
  // 不变量：尾屏只有在 ① 才满帧。所以无论时序如何，它都不可能再去抢首屏的主线程。
  // ② 的 armed 门控还有一个作用：**把 demo 的场景钟在冷启动期间冻住**（空转档每
  // 帧只推进 16ms、且 1fps）。这样烧录的第一帧 nf≈0，BURN_FRAMES 帧的账才算得准，
  // 正好把灯光推到脉冲波峰；否则冷启动那几秒会偷偷把相位推走。
  useEffect(() => {
    if (!mounted) return undefined;
    let stopped = false;
    let timer = null;
    const apply = () => {
      if (stopped) return;
      const win = frameRef.current && frameRef.current.contentWindow;
      if (!win || !win.__streetHostHooked) { timer = window.setTimeout(apply, 100); return; }
      const burning = armed && !burnedRef.current;
      try {
        win.__streetFrameMs = active ? 0 : (burning ? BURN_FRAME_MS : 0);
        win.__streetPaused = !active && !burning;
      } catch (_) { /* 已销毁 / 跨域时静默 */ }
    };
    apply();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [mounted, active, armed, burned]);

// ── 宿主侧叠加（全部在 demo 之外，绝不改动 V3.1.12 构建产物）──────────────────
// ①隐藏 demo 顶部那一栏品牌 / 天气 / 时钟文字（.header）。
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
//   ⚠ 滚轮与指针是不同事件，各走各的通道，互不干扰。
//
// ④ 尾部版式改版（2026-10-08，按参考图 Frame 11.jpg）：
//   移除 · 底部文字 .explore-note（"拖动观察"）
//   移除 · 底部中央的交互按钮 #navigation（01 工作室 / 02 打个电话 / 03 写封信 / 04 汽车）
//   移除 · #scene-caption（它就占着右下角那块地，会与新块重叠）
//   新增 · 右下角 .street-quick：打个电话 / 发封邮件 两行 + 一行提示，
//         由宿主注入 DOM、点击时转交demo 自己的 phone / mail 面板。
//         所以 #navigation 只是被隐藏、**不从 DOM 移除** —— 它身上的事件委托与
//         demo setMode() 里的 `#navigation button` 全部照常工作（零侵入）。
//   左下横线 .tiny-line 按业主要求取 #6784A6。
//
// ⑤ 棕黄点缀 → 冷蓝点缀：demo 全站 16 个暖色（hue 33°~41°，如 --accent #e4b77d、
//   .tiny-line #c6ac84、状态点 #eac286…）统一按**同一色相锚点 #6784A6**重算：
//   明度v 原样搬运、饱和度 s×0.62，于是层级关系不变，只是"色相家族"整体从
//   暖黄换成冷蓝。--accent 一并换蓝，`.amber` 句号 / `.back>span` 箭头 /
//   focus 描边都跟着走。
//   ⚠ 3D 场景（canvas）里的暖色灯光属场景美术，不在替换范围 —— 参考图同样保留
//     街灯与室内的暖光，只把 UI 点缀换成冷蓝。
//
// ⑥ 左下文案按参考图 Frame 11.jpg 替换（2026-10-08 补做，第一轮漏了）：
//   eyebrow · SOMEWHERE, AN IDEA IS STILL AWAKE. → Let's Make It Happen.
//   h1      · 夜深了，/ 灵感还亮着。              → 有个有趣的想法？/ 不妨我们一起实现。
//   p · intro-foot · 与参考图一致，原样保留。
//   ⚠ 参考图句号是**纯白**（实测 p92 = 251,251,251，与正文同色），demo 原来那个
//     `<span class="amber">。</span>` 是暖黄点缀 ⇒ 换文案时一并去掉该 span。
//   字号按参考图 1920 宽量出的字高反推：h1 单行 32px、eyebrow 12px、p 13px。
//   文本用 injectIntroCopy() 改写 —— demo 的 setMode() 只写 `.intro` 的 opacity、
//     setProgress() 同理，都不碰内容（已核`innerHTML=` 仅 4 处，全在 #detail），
//     所以只在 overview 首帧改一次即可，不会被 demo 覆盖。
const HOST_CSS = `
#loading { display: none !important; }
.header { display: none !important; }

/* ── ④ 尾部版式：移除底部文字 / 底部中央按钮 / 让位给右下角新块 ────────────── */
.explore-note,
#navigation,
#scene-caption { display: none !important; }
.hud { justify-content: flex-end !important; }

/* ── ⑥ 左下文案按参考图替换 ────────────────────────────────────────────────
   参考图实测：h1 两行基线间距 48px、字高 32px；eyebrow 字高 12px、横线宽 39px；
   p 字高 13px；foot 字高 7px。demo 原值 h1 clamp(28,3.05vw,47)/line-height 1.42、
   eyebrow 8px、p 11px，均偏小，按参考图放大。 */
.intro .eyebrow { font-size: 11px; letter-spacing: 2.4px; color: #7d8489; }
.intro .tiny-line { width: 39px; height: 1px; }
.intro h1 {
  font-size: clamp(30px, 2.34vw, 45px);
  line-height: 1.5;
  letter-spacing: 4.5px;
  margin: 20px 0 22px;
  color: #fbfbfb;
}
.intro p { font-size: 12.5px; letter-spacing: 2.2px; color: #8a9095; }
.intro-foot { font-size: 8.5px; letter-spacing: 1.6px; margin-top: 34px; }
.intro-foot span:first-child { color: #f0f1f1; }
.intro-foot span:last-child { color: #4e6b82; }

/* ── ⑦ 详情面板文案按参考图严格替换（2026-10-09）───────────────────────────
   四个面板的文本由 HOST_JS 的 MutationObserver 重写（demo 的 innerHTML 模板
   照常运行，我们在其后整体替换 #detail-content），这里只补三处版式：
   · kicker 前的短横线 —— 参考图四张的 eyebrow 都带一条 39px 线（与 .intro
     .tiny-line 同款、同色 #6784A6）；
   · car 面板的「#一个留给自己的小彩蛋」注释行；
   · 面板落款改两段式 FOUR DESIGN / INDEPENDENT CREATIVE STUDIO（去掉状态点，
     参考图四张落款全同）。 */
.detail-kicker:before {
  content: "";
  display: inline-block;
  width: 39px;
  height: 1px;
  background: #6784A6;
  margin-right: 12px;
  vertical-align: 4px;
}
.car-note { margin: 26px 0 0; color: #e6ecf1; font-size: 11px; letter-spacing: 1.2px; font-weight: 600; }
.panel-signature { color: #6f7d88; gap: 14px; }
.panel-signature .ps-name { color: #f0f1f1; font-weight: 600; }
.panel-signature .ps-sub { color: #4e6b82; }

/* ── ⑧ 2026-10-09 二轮修正 ───────────────────────────────────────────────── */
/* 修2（三轮重做）：面板整组垂直居中。#detail 原本是从顶往下排（padding-top
   132px / ≥1600px 时 18vh），内容短时整块偏上。上一版用 flex + 正文
   margin:auto —— 那会把「返回街角」和落款分别钉到面板上下边缘（业主指出
   两者应保持原有间距）。改为：整组（返回按钮 + 正文 + 落款）一起居中，
   元素间保持 demo 原始间距（.back margin-bottom:55px、.panel-signature
   margin-top:45px）。safe center 防止内容超高时顶部被裁（不支持时整体
   回退为顶对齐 = demo 原状）。padding-top 归一到 132px：居中布局下 18vh
   的额外顶距会把整组往下拽出不对称。只在桌面段生效，移动端面板是底部
   57% 抽屉，保持原版式。 */
@media (min-width: 701px) {
  #detail {
    display: flex;
    flex-direction: column;
    justify-content: safe center;
    padding-top: 132px;
    padding-bottom: 120px;
  }
}
/* 修3：demo 打开面板会编程 focus「返回街角」，:focus-visible 的 2px 描边框
   （outline 2px var(--accent)）在参考图里没有 —— 去掉。 */
.back:focus, .back:focus-visible { outline: none !important; }
/* 修4：复制直进剪贴板，邮箱不出现文字选中态（demo 的 fallback 会选中文本）。 */
.contact-value { -webkit-user-select: none; user-select: none; }

/* ── ⑤ 棕黄点缀 → 冷蓝点缀（锚点 #6784A6，明度不变） ─────────────────────── */
:root { --accent: #a4c2e4; }
.tiny-line { background: #6784A6 !important; }
.weather-dot,
.status-dot { background: #acc9ea !important; box-shadow: 0 0 9px #85a4c888 !important; }
#navigation button:hover,
#navigation button[aria-current=true] { background: #b4c5d8 !important; }
.controls button:hover { color: #a4c2e4 !important; }
.controls button[aria-pressed=true] { color: #adbfd4 !important; }
.primary-action { color: #b2c8e2 !important; border-color: #76818d !important; }
.primary-action:hover { background: #9db7d4 !important; }
.inspiration-note { color: #c9d3df !important; border-left-color: #76889c !important; }
.services span:before { color: #758aa3 !important; }
.load-line:after { background: #a2bad6 !important; }
#toast { color: #d2dce7 !important; }
#hover-label { color: #c9d8e9 !important; }
.contact-value { color: #c9d7e8 !important; }
.skip { background: #b1c8e3 !important; }

/* ── ④ 右下角新块 ──────────────────────────────────────────────────────────
   坐标全部从参考图量出后按视口反推（参考图 1920×1081）：
     行1「打个电话」rows 818..833、行2「发封邮件」rows 856..871（行距 23px）
     提示行 rows 901..909（距行2 底 30px）；底部 .controls rows 948..959
   ⇒ 块底比 .controls 顶低 36px；.controls 高 34 + .hud 底 35/45/23
     ⇒ bottom 105 / 115 / 93。字号按参考图宽度等比缩到本站。 */
.street-quick {
  position: fixed; right: 46px; bottom: 105px; z-index: 5;
  display: flex; flex-direction: column; align-items: flex-end;
  text-align: right; pointer-events: none;
  transition: opacity .35s;
}
.sq-row {
  display: flex; align-items: center; gap: 14px;
  padding: 0; border: 0; background: none; cursor: pointer;
  pointer-events: auto; -webkit-tap-highlight-color: transparent;
  color: #cfd6dd; font-size: 12.5px; letter-spacing: 1.5px;
  transition: color .2s; font-family: inherit;
}
.sq-row + .sq-row { margin-top: 21px; }
.sq-row:hover { color: #eaf0f6; }
.sq-ico {
  width: 15px; height: 15px; flex: none;
  fill: none; stroke: currentColor; stroke-width: 1.2px;
  stroke-linecap: round; stroke-linejoin: round;
}
.sq-hint { margin: 28px 0 0; color: #7f8c96; font-size: 9px; letter-spacing: 1px; }
/* demo 进入 phone/mail/car 面板时 #detail 从右侧盖住 44% —— 新块同步淡出 */
body:not([data-mode="overview"]) .street-quick { opacity: 0; pointer-events: none; }

@media (min-width:1600px) { .street-quick { bottom: 115px; } }
@media (max-width:1100px) { .street-quick { right: 28px; } }
@media (max-width:700px) {
  /*⚠ 移动端不能沿用 105px：demo 的 ≤700 段把 .controls 改成
     position:absolute; bottom:71px（.hud 自身高度因此塌成 0），实测
     .controls 顶边落在视口底往上 123px 处 —— 新块 bottom:93 会压到它身上
     （探针 probe-street-mobile.mjs 实测 overlapControls=true）。
     这里取 controls 顶再上抬 37px（≈参考图 909→948 的 39px 间距）。 */
  .street-quick { right: 16px; bottom: 160px; }
  .sq-row { gap: 10px; font-size: 11px; letter-spacing: 1px; }
  .sq-ico { width: 13px; height: 13px; }
  .sq-row + .sq-row { margin-top: 16px; }
  .sq-hint { margin-top: 20px; font-size: 8px; }
  /* ⚠ ⑥ 的字号是照参考图（1920 宽PC）量的，直接搬到 402px 宽的移动端会让
     .intro 从w192 涨到 w311、高 142→204，**同时横向与纵向撞上右下新块**
     （探针实测 overlapIntro=true）。这里按demo 移动端基准缩回：
     h1 24px / 字距 2px ⇒ 「有个有趣的想法？」约 206px 宽，避开新块左沿 301。 */
  .intro .eyebrow { font-size: 8px; letter-spacing: 1.4px; }
  .intro .tiny-line { width: 26px; }
  .intro h1 { font-size: 24px; line-height: 1.42; letter-spacing: 2px; margin: 14px 0 12px; }
  .intro p { font-size: 10px; letter-spacing: 1.4px; }
  .intro-foot { font-size: 6.5px; letter-spacing: 1px; margin-top: 18px; }
}
`;

// iframe 内部执行：劫持滚动 → 交还父页面；其余一概不碰。
// postMessage 是单向的（iframe → parent），父页面不回灌，因此不会有转发环路。
const HOST_JS = `
(function () {
  if (window.__streetHostHooked) return;
  window.__streetHostHooked = true;

  // ── 一次性诊断通道 ────────────────────────────────────────────────────
  // demo 把运行状态挂在内部对象 zd 上（Object.defineProperty(zd, 'lighting', …)），
  // 但从不导出到 window，于是"灯光渐入到底走完没有"在外部无法观测。这里在
  // Object.defineProperty 上挂一个**一次性**钩子把 zd 捞出来，捞到就立刻还原 ——
  // 零稳态开销，demo 产物一个字节都不动。此后可读 __streetState.lighting /
  // .frameMs / .drawCalls（探针与人工排查都用它）。
  var rawDefineProperty = Object.defineProperty;
  Object.defineProperty = function (o, k, d) {
    if (k === 'lighting' && o && typeof o === 'object' && o.frameMs !== undefined) {
      window.__streetState = o;
      Object.defineProperty = rawDefineProperty;
    }
    return rawDefineProperty.apply(this, arguments);
  };

  // ── 后台降频 + 场景时间记账（宿主侧叠加，不改动 demo 产物）──────────────
  // 这条街景是 Three.js 场景，一旦挂上就每帧全量渲染：即使用户停在首屏看视频、
  // 甚至已经翻到二级/三级页（那时 HomePage 只是被 display:none，同源 iframe 的
  // rAF 照样跑），它也在烧 CPU —— 实测占满主线程 80%~87%。
  // three 的 WebGLAnimation 是 "requestAnimationFrame(i)" 递归，每帧都会重新
  // 查全局，所以在这里包一层就能控帧。
  //
  // 三个档位（都由宿主写 window 上的开关）：
  //   __streetPaused     —— 空转保活（约 1fps）。WebGL 上下文、已编译的 shader、
  //     已加载的纹理全部保活，回到尾屏立刻满帧，预挂载红利一点不丢。
  //   __streetFrameMs > 0 —— 受控帧率（"烧录档"）：把回调按截止时刻摊平到每
  //     frameMs 一帧。demo 的灯光渐入是 intro += dt/2.7、dt 取回调时间戳之差且
  //     **被 clamp 到 0.05s**（源码：Math.min((e-rf)/1e3||.016,.05)）。所以：
  //       · 每帧最多只能推进 0.05s 场景时间 → 2.7s 的渐入最少要 54 帧，这是硬下限；
  //       · 只要渲染间隔 ≤ 50ms，渐入就按真实时间推进，**降帧不降速**，纯赚 CPU。
  //   __streetFrameMs = 0 —— 满帧。
  //
  // ⚠⚠⚠ 时间轴铁律（2026-10-09 血泪）：**喂给 demo 的时间戳必须是真实时钟
  // （performance.now() 域），绝不能是任何自建的"人造累加轴"。**
  // 原因：demo 的镜头转场（点物体 → 相机推到特写）是这么算进度的：
  //     bf():  sf = !0; cf = performance.now();        // 起点取真实时钟
  //     i(e):  n = clamp((e - cf) / (studio?2150:1400), 0, 1)   // e = rAF 回调时间戳
  // 人造轴每帧只按固定步长递增（满帧档 +16ms、空转档每 1000ms 才 +16ms），
  // 而尾屏是**预挂载**的：它在首屏/二级页期间已经空转了很久，人造轴会落后
  // 真实时钟几十秒到几分钟。于是点下去那一刻 (e - cf) 恒为负 → n 恒等于 0 →
  // 相机永远停在起点，1.4s 的推进动效**整个消失**（表现为"点了没反应/硬切"）。
  // 降帧只能改"多久回调一次"，不能改"回调里报几点"。两者必须解耦。
  window.__streetPaused = false;
  window.__streetFrameMs = 0;
  // 累计场景时间（秒）：用与 demo 相同的 dt 算法（真实时钟差、clamp 到 0.05s）
  // 记账，用于诊断与探针核对；烧录是否收工另有判据（见 BURN_FRAMES）。
  window.__streetSceneSeconds = 0;
  // 只用于诊断/探针：烧录档实际渲染了多少帧、首帧墙钟时刻。
  window.__streetBurnFrames = 0;
  window.__streetBurnFirstAt = 0;
  var lastTickAt = 0;      // 上一帧交给 demo 的真实时刻
  var nextAt = 0;          // 烧录档的下一帧截止时刻
  var rawRaf = window.requestAnimationFrame.bind(window);
  // 统一出口：真实时钟 + 与 demo 同源的 dt 记账。isBurn 只影响烧录帧计数，
  // 不影响时间戳语义 —— 时间戳恒为"当下"，降帧只由上面的 setTimeout 负责。
  var emit = function (cb, isBurn) {
    var at = window.performance.now();
    var dt = lastTickAt ? (at - lastTickAt) / 1000 : 0.016;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;                 // 与 demo 自己的 clamp 上限一致
    lastTickAt = at;
    window.__streetSceneSeconds += dt;
    if (isBurn) {
      if (!window.__streetBurnFrames) window.__streetBurnFirstAt = at;
      window.__streetBurnFrames += 1;
    }
    cb(at);
  };
  window.requestAnimationFrame = function (cb) {
    return rawRaf(function () {
      if (window.__streetPaused) {
        nextAt = 0;
        window.setTimeout(function () { emit(cb, false); }, 1000);
        return;
      }
      var frameMs = window.__streetFrameMs;
      if (frameMs > 0) {
        // 按截止时刻摊平：不能"每次都再等 N 毫秒"，那会叠上 three 自己那一轮 rAF
        // 的等待（~16ms），实测间隔变成 ~66ms —— 而 dt 被 clamp 到 0.05s，于是
        // 场景时间只以 76% 的速度推进，灯光烧录被白白拖长近 1s。
        var now = window.performance.now();
        if (now < nextAt) {
          window.setTimeout(function () { emit(cb, true); }, nextAt - now);
          return;
        }
        nextAt = now + frameMs;
        emit(cb, true);
        return;
      }
      nextAt = 0;
      emit(cb, false);
    });
  };

  // ── ⑦ 详情面板文案替换 —— 不在这里做！HOST_JS 是每窗口只跑一次的一次性
  // 脚本，而 iframe 会先停在 about:blank 再导航到真文档：就算把 observer 挂上，
  // 它也随 about:blank 文档一起销毁，真文档里这段代码又因 __streetHostHooked
  // 早退、绝不重跑。所以 DOM 依赖的改写全部放在 React 侧 injectDetailCopy()
  // （随文档重注入，见该函数注释）。

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

// ── 右下角新块（参考图右下：打个电话 / 发封邮件 + 一行提示）─────────────────
// ⚠ 为什么由宿主注入、而不是改 demo 的 index.html：
//   demo 产物（public/contact-street/）按项目约定「字节级不变、不重移植」，
//   任何改动都只走宿主叠加层。这里 insertAdjacentHTML 追加到 <body>，
//   而点击行为**不自己实现**，而是把 click 转发给 #navigation 里对应
//   data-mode 的按钮 —— demo 既有的 setMode('phone'/'mail') 与
//   「点场景空白回街角」的射线热区因此全部原样生效。
const STREET_QUICK_HTML = `
<div class="street-quick" id="street-quick" aria-label="快捷联系">
  <button class="sq-row" type="button" data-sq-mode="phone">
    <svg class="sq-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5c0 8 6 14 14 14l2-3-4-2-2 2c-3-1.5-5.5-4-7-7l2-2-2-4z"/></svg>
    <span>打个电话</span>
  </button>
  <button class="sq-row" type="button" data-sq-mode="mail">
    <svg class="sq-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 6.5 12 13l8-6.5"/></svg>
    <span>发封邮件</span>
  </button>
  <p class="sq-hint">点击 / 拖动 探索场景</p>
</div>
`.trim();

// ── ⑥ 左下文案改写（参考图 Frame 11.jpg）────────────────────────────────────
//只改两处文本节点：.eyebrow 的文字 span、.intro h1 的两行。
//⚠ 不动 .intro p 与 .intro-foot —— 它们与参考图一致。
//⚠ h1 里那个 `<span class="amber">。</span>` 必须**连 span 一起去掉**（参考图句号
//   是纯白，而 .amber 继承 --accent，是个暖黄点缀）。
//   用 textContent 赋值天然会连 span 一起清掉，无需额外处理。
const INTRO_COPY = {
  eyebrow: "Let's Make It Happen.",
  h1: '有个有趣的想法？\n不妨我们一起实现。',
};

function injectIntroCopy(doc) {
  if (!doc || !doc.body) return false;
  const intro = doc.querySelector('.intro');
  if (!intro || intro.getAttribute('data-host-copy')) return !!intro;
  intro.setAttribute('data-host-copy', '1');
  const eyebrow = intro.querySelector('.eyebrow');
  // eyebrow 结构是 <span class="tiny-line"></span> SOMEWHERE...
  // tiny-line 是装饰横线，必须保留，只换它后面的裸文本节点。
  if (eyebrow) {
    eyebrow.textContent = '';
    eyebrow.appendChild(doc.createElement('span'));
    eyebrow.firstChild.className = 'tiny-line';
    eyebrow.appendChild(doc.createTextNode(INTRO_COPY.eyebrow));
  }
  const h1 = intro.querySelector('h1');
  if (h1) {
    // 参考图是两行，靠 <br> 断行；textContent 赋值会清掉旧的 <br> 与 .amber span，
    // 所以这里拆成两段再插 <br>。
    const [line1, line2] = INTRO_COPY.h1.split('\n');
    h1.textContent = '';
    h1.appendChild(doc.createTextNode(line1));
    h1.appendChild(doc.createElement('br'));
    h1.appendChild(doc.createTextNode(line2));
  }
  return true;
}

// ── ⑦ 详情面板文案严格替换（2026-10-09，按业主参考图四张）────────────────────
// demo 的四个面板模板（studio/phone/mail/car）硬编码在 bundle 里、每次 setMode
// 各写一段 innerHTML 到 #detail-content（随后再 append 一条 .gesture-note），
// 产物字节级不可改 ⇒ 宿主侧用 MutationObserver 跟随重写：demo 每写一次，
// 我们紧接着整体替换成参考图文案（.gesture-note「单击画面返回街角」参考图里
// 没有，随整体替换一起清掉）。防回环：替换前打 data-host-detail 标记，标记与
// 当前 mode 相同就不再动。
// ⚠ 为什么放 React 侧而不放 HOST_JS：HOST_JS 每窗口只跑一次，而 iframe 先停在
//   about:blank 再导航到真文档 —— 挂在 about:blank 里的 observer 会随文档销毁，
//   真文档里 HOST_JS 又因 __streetHostHooked 早退。injectDetailCopy 与
//   injectStreetQuick 同架构：幂等、跟着文档走、每次注入都重试。
// 交互不自己实现：data-copy / data-switch 是 demo 挂在 #detail 祖先上的事件
//   委托，替换内容不影响；tel / mailto 带原参重建（mailto subject 与 demo 一致）。
// 联系方式从 site-config.json 读（与 demo 同参），读到前用兜底常量 —— 两者
//   目前数值一致，所以即便 fetch 失败也显示正确。
const STREET_CFG_FALLBACK = { phone: '18219315597', email: 'Four4444.Design@gmail.com' };
let streetCfg = { ...STREET_CFG_FALLBACK };
try {
  fetch(`${import.meta.env.BASE_URL}contact-street/site-config.json`)
    .then((r) => r.json())
    .then((c) => {
      if (c && c.phone) streetCfg = { ...streetCfg, phone: String(c.phone) };
      if (c && c.email) streetCfg = { ...streetCfg, email: String(c.email) };
    })
    .catch(() => {});
} catch (_) { /* 保持兜底值 */ }

function formatStreetPhone(p) {
  try { return p.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3'); } catch (_) { return p; }
}

function detailHtmlFor(mode) {
  const mailHref = `mailto:${streetCfg.email}?subject=${encodeURIComponent('你好 Four Design，聊聊一个新想法')}`;
  // ⚠ 每个面板的第一个元素都带 data-host-copy="1" —— 它是「这一版内容是宿主写的」
  //   的子元素级标记：demo 每次重写 #detail-content 的 innerHTML 都会把我们的
  //   子节点全部换掉，标记随之下消失 ⇒ observer 下一轮必然重新替换。不要改成
  //   挂在 #detail-content 自身的 attribute —— 那正是「返回街角再进来就显示
  //   旧文案」的根因（attribute 在 demo 重写后仍残留， observer 被它挡住）。
  if (mode === 'studio') return '<p class="detail-kicker" data-host-copy="1">FOUR DESIGN</p>'
    + '<h2 id="detail-title" class="detail-title">以设计，<br>点亮未知的旷野。</h2>'
    + '<div class="detail-rule"></div>'
    + '<div class="services"><span>品牌设计</span><span>产品设计</span><span>视觉叙事</span></div>'
    + '<div class="actions"><button class="primary-action" data-switch="mail">聊聊你的想法 <span>↗</span></button></div>';
  if (mode === 'phone') return `<p class="detail-kicker" data-host-copy="1">LET&#39;S TALK</p>`
    + '<h2 id="detail-title" class="detail-title">链接，<br>从此刻开启。</h2>'
    + '<div class="detail-rule"></div>'
    + '<div class="contact-label">GIVE ME A CALL</div>'
    + `<a class="contact-value" href="tel:${streetCfg.phone}">${formatStreetPhone(streetCfg.phone)}</a>`
    + `<div class="actions"><a class="primary-action" href="tel:${streetCfg.phone}">拨打电话 <span>↗</span></a>`
    + '<button class="copy" data-copy>复制号码 ↗</button></div>';
  if (mode === 'mail') return '<p class="detail-kicker" data-host-copy="1">WRITE A LETTER</p>'
    + '<h2 id="detail-title" class="detail-title">把想法，<br>轻轻寄到这里。</h2>'
    + '<div class="detail-rule"></div>'
    + '<div class="contact-label">A LETTER TO FOUR</div>'
    + `<a class="contact-value email" href="${mailHref}">${streetCfg.email}</a>`
    + `<div class="actions"><a class="primary-action" href="${mailHref}">写一封信 <span>↗</span></a>`
    + '<button class="copy" data-copy>复制邮箱 ↗</button></div>';
  if (mode === 'car') return '<p class="detail-kicker" data-host-copy="1">FOUR DESIGN</p>'
    + '<h2 id="detail-title" class="detail-title">给自己充电，<br>驶向更远的明天。</h2>'
    + '<div class="detail-rule"></div>'
    + '<p class="detail-copy">每一次停歇，都是为了更远的抵达。<br>积蓄能量，勇敢奔赴那个你期待的未来。</p>'
    + '<p class="car-note">#一个留给自己的小彩蛋</p>';
  return null;
}

function applyDetailCopy(doc) {
  const dc = doc.getElementById('detail-content');
  if (!dc) return;
  const mode = doc.body.getAttribute('data-mode');
  if (!mode || mode === 'overview') return;
  // 防回环判据是「子元素里还有没有我们的标记」（见 detailHtmlFor 注释）：
  // demo 重写 innerHTML 会把标记节点一并清掉，所以这里必然重新接管；
  // 我们自己写完触发的下一轮 observer 也能正确跳过。
  if (dc.querySelector('[data-host-copy]')) return;
  const html = detailHtmlFor(mode);
  if (!html) return;
  dc.innerHTML = html;
}

// 修4：复制必须直进剪贴板。demo 的 data-copy 委托在 clipboard API 不可用时
// 会 fallback 成「选中文本 + 请复制已选中的联系方式」，还把邮箱染成选中态 ——
// 这里在 document 捕获阶段拦下 data-copy（祖先捕获先于 demo 的目标阶段委托），
// 阻断 demo 路径，自实现复制：clipboard API → 失败退 execCommand + 隐藏
// textarea（不碰可见文本）；toast 复用 demo 的 #toast（.show 样式同源）。
let streetCopyToastTimer = 0;
function streetToast(doc, msg) {
  try {
    const t = doc.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(streetCopyToastTimer);
    streetCopyToastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  } catch (_) { /* noop */ }
}

function streetCopyText(doc, text) {
  const done = () => streetToast(doc, '已复制，期待你的消息');
  const fail = () => streetToast(doc, '复制失败，请手动复制');
  const legacy = () => {
    try {
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      doc.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = doc.execCommand('copy');
      doc.body.removeChild(ta);
      ok ? done() : fail();
    } catch (_) { fail(); }
  };
  if (doc.defaultView.navigator.clipboard && doc.defaultView.navigator.clipboard.writeText) {
    doc.defaultView.navigator.clipboard.writeText(text).then(done, legacy);
  } else legacy();
}

function bindStreetCopy(doc) {
  if (doc.__streetCopyBound) return;
  doc.__streetCopyBound = true;
  doc.addEventListener('click', (ev) => {
    let btn = null;
    try { btn = ev.target && ev.target.closest ? ev.target.closest('[data-copy]') : null; } catch (_) { return; }
    if (!btn) return;
    const dc = doc.getElementById('detail-content');
    if (!dc || !dc.contains(btn)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const mode = doc.body.getAttribute('data-mode');
    streetCopyText(doc, mode === 'phone' ? streetCfg.phone : streetCfg.email);
  }, true);
}

function injectDetailCopy(doc) {
  if (!doc || !doc.body) return false;
  // 面板落款（#detail 底部静态节点，demo 从不回写）按参考图改为两段式，
  // 去掉状态点与原「THE LIGHT IS ON. COME SAY HELLO.」标语。
  const ps = doc.querySelector('.panel-signature');
  if (ps && !ps.querySelector('.ps-name')) {
    ps.innerHTML = '<span class="ps-name">FOUR DESIGN</span><span class="ps-sub">INDEPENDENT CREATIVE STUDIO</span>';
  }
  bindStreetCopy(doc);
  const dc = doc.getElementById('detail-content');
  if (!dc) return false;
  if (!dc.__hostDetailObserver) {
    try {
      dc.__hostDetailObserver = new MutationObserver(() => {
        try { applyDetailCopy(doc); } catch (_) { /* noop */ }
      });
      dc.__hostDetailObserver.observe(dc, { childList: true });
    } catch (_) { return false; }
  }
  applyDetailCopy(doc);
  return true;
}

function injectStreetQuick(doc) {
  if (!doc || !doc.body) return false;
  if (doc.getElementById('street-quick')) return true;
  const host = doc.body;
  host.insertAdjacentHTML('beforeend', STREET_QUICK_HTML);
  // 点击 → 转发给 demo 自己的 #navigation 按钮（它被 display:none 但仍在 DOM 里，
  // 事件委托 document.querySelectorAll('[data-mode]') 照样收得到）。
  const quick = doc.getElementById('street-quick');
  quick.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-sq-mode]');
    if (!btn) return;
    const mode = btn.getAttribute('data-sq-mode');
    const target = doc.querySelector('#navigation button[data-mode="' + mode + '"]');
    if (target) target.click();
  });
  return true;
}

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
    let injectedDoc = null;
    let elapsed = 0;
    // 把尾屏 WebGL 预载进度并回首屏 loading 进度条（见 index.html 监听）：
    // 挂载即登记 0，编译完成（#loading.loaded / canvas 已绘制）登记 0.75，
    // 灯光烧录完成再登记 1 —— 于是条子在烧录那几秒里仍在真实爬升，而不是干等。
    // ⚠ 用 ref 而不是局部变量：本 effect 在 burned 翻转时会重跑，局部变量会被重置，
    //   于是 tail 进度被重新报一遍 0 → 0.75（进度条靠 Math.max 兜住，但没必要）。
    const reportTailReady = () => {
      if (tailReportedRef.current) return;
      tailReportedRef.current = true;
      try { window.dispatchEvent(new CustomEvent('loading:progress', { detail: { id: 'tail', weight: 2, progress: 0.75 } })); } catch (_) {}
      try { if (onTailReady) onTailReady(); } catch (_) {}
      // 冷启动完成 = demo 的 rAF 循环已经跑起来，从这一刻起才可以烧录灯光。
      try { setArmed(true); } catch (_) {}
    };
    if (!tailZeroRef.current) {
      tailZeroRef.current = true;
      try { window.dispatchEvent(new CustomEvent('loading:progress', { detail: { id: 'tail', weight: 2, progress: 0 } })); } catch (_) {}
    }

    const attempt = () => {
      if (stopped) return;
      const frame = frameRef.current;
      if (!frame) { raf = window.requestAnimationFrame(attempt); return; }
      let doc = null;
      let win = null;
      try { doc = frame.contentDocument; win = frame.contentWindow; } catch (_) { doc = null; }
      if (doc) {
        // ⚠ 注入必须跟着**文档**走，不能一次性门控：iframe 会先从 about:blank 导航
        //   到真正的 demo 文档，注入到 about:blank 的那份会随导航一起丢掉。用
        //   cssDone 挡着的话就再也不会往真文档注入，只能退到 onLoad 兜底 ——
        //   而那时 demo 的模块早就跑完了：rAF 钩子晚装（时间轴与它自己的 rf 对不
        //   上，第一帧递过去一个**倒退**的时间戳 ⇒ dt 变负数 ⇒ 场景时间被凭空推走，
        //   实测灯光相位因此错开 1.37s），一次性诊断钩子更是完全捞不到状态。
        //   移动端实测就是这个路径。改为"文档换了就重新注入"，两个钩子都能在
        //   demo 模块执行前就位。
        if (doc !== injectedDoc) {
          injectedDoc = doc;
          try { cssDone = injectHostCss(doc) && injectHostJs(doc); } catch (_) { cssDone = false; }
        }
        // ⚠ 不挂在 cssDone 分支里 —— 那是一次性门控，若首帧 doc.body 还没就绪就会
        //   永远跳过。新块是纯静态 DOM，晚一步注入只是晚一步出现，无副作用。
        try { injectStreetQuick(doc); injectIntroCopy(doc); injectDetailCopy(doc); } catch (_) { /* onLoad 兜底 */ }
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
      // 遮罩多留一段：等灯光烧录完再揭幕（burned）。烧录期用户本来就还在看
      // 首屏 loading，尾屏挡住没有任何损失；反过来，若在烧录映到一半就揭幕，
      // 万一用户直接跳到尾屏就会看到"灯还没亮满"。失败方向必须是安全的。
      if (cssDone && readyDone && burned) {
        setRevealed(true);
        try { win && win.scrollTo(0, 0); } catch (_) { /* 未就绪 */ }
        return;
      }
      raf = window.requestAnimationFrame(attempt);
    };

    raf = window.requestAnimationFrame(attempt);
    return () => { stopped = true; window.cancelAnimationFrame(raf); };
  }, [mounted, burned]);

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
    injectStreetQuick(doc);
    injectIntroCopy(doc);
    injectDetailCopy(doc);
  } catch (_) {
    /* 同源 public 资源可读；跨域时静默跳过 */
  }
}