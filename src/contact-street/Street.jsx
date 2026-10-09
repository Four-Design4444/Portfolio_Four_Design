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
// 空转保活间隔（暂停档）。手机上空转帧实测 82~88ms/帧（PC 11~15ms）。
// ⚠ 2026-10-10：回撤 1s → 5s 那次改动（业主反馈「从首页滑到尾屏后要隔好一会才开始播」）。
// 当初的理由是"保活只要别让 WebGL 上下文凉掉，5s 够"—— **这个理由是错的**：
// demo 的冷启动要靠真的被喂帧才能跑完，而它落在暂停档，5s 一帧等于整个加载遮罩期
// 只喂了一两帧 → 冷启动没跑完 → 业主滑到尾屏时现场补冷启动。
// 实测（outputs/perf-reveal/tail-start-check.mjs，直接数街景 iframe 的 WebGL 绘制调用）：
// 尾屏进入视野后，档位立刻是满帧，**但第 2500ms 才画出第一帧** —— 就是那段"冻住"。
// 回到 1s（原值）后遮罩期能喂够帧。撞转场那一帧的概率会回升，但"尾屏能立刻开播"优先。
const IDLE_KEEPALIVE_MS = 1000;

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
  //   ③ 其余（未冷启动 / 烧完且不在尾屏）→ 空转保活（默认 5s 一帧，且交接期可挂起）
  // 不变量：尾屏只有在 ① 才满帧。所以无论时序如何，它都不可能再去抢首屏的主线程。
  // ② 的 armed 门控还有一个作用：**把 demo 的场景钟在冷启动期间冻住**（空转档每
  // 帧只推进 16ms、且 5s 才一帧）。这样烧录的第一帧 nf≈0，BURN_FRAMES 帧的账才算得准，
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
        win.__streetIdleMs = IDLE_KEEPALIVE_MS;
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

/* ── ⑨ 2026-10-09 业主终轮微调 ─────────────────────────────────────────────
   PC：业主「左右两边的文字信息保持底部对齐的同时一起往上移动」。
   ⚠ 底带里左侧文案的底边是钉在图标底边上的（关系①）、提示行是钉在图标上沿的
     （关系②）⇒ 只抬文字会让两者与图标脱开、底部对齐随之破掉。所以「一起上移」
     只能连右下那排图标一起抬 —— 抬的是 demo 的 .hud（☁ ‖ HIGH 就在它的
     .controls 里），值写进 --sq-lift；注入脚本量到的 iconBox 已含这一抬，
     三条关系全部自动跟随，任何视口都不用改数。
   56px 由设计稿反推：设计稿图标行 951..957（1081 高稿）↔ 实测盒子 1001..1035
   ⇒ 图标盒上移 56 后落在 945..979，两个按钮行随之精确落在设计稿的
   818..833 / 856..871（见 startStreetAlign）。
   移动端 --sq-lift 归零：业主只要求「按钮下移贴近图标」，图标本身不动。 */
:root { --sq-lift: 56px; }
@media (min-width: 701px) and (max-width: 1599px) {
  .hud { bottom: calc(35px + var(--sq-lift, 0px)) !important; }
}
@media (min-width: 1600px) {
  .hud { bottom: calc(45px + var(--sq-lift, 0px)) !important; }
}

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
/* ⚠ 2026-10-09 业主：移动端「INDEPENDENT CREATIVE STUDIO」不显示 —— demo 写死了
   .intro-foot span:last-child{display:none}（各尺寸段都隐藏）。设计稿里这行是
   显示的，宿主层强制开启（两端一致）。 */
.intro-foot span:last-child { display: inline !important; }

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
    /* 2026-10-09 三轮+：业主要求整组再上移 —— 返回街角大约落到其标注箭头处
       （截图里返回行在 30% 视口高、箭头在 21.5%）。给底部多垫 18vh，居中
       参考点随之整体上移 9vh，比例随视口高度自适应。 */
    padding-bottom: calc(120px + 18vh);
  }
}
/* 修10（2026-10-09 六轮）：移动端交互面板底部留白。demo ≤700 段把 #detail
   定成固定 57% 高的底部抽屉（top:43%），内容短时面板底剩大片空白（业主
   红框）。改为内容自适应高度 + 贴底：top:auto + height:auto（基础规则
   inset:0 0 0 auto 已含 bottom:0），抽屉顶边随内容收缩 ⇒ 上方镜头画面
   自然变高、展示更多场景。max-height 放宽到 68% 防超长内容（mail 面板）
   溢出，overflow-y:auto 沿用 demo 原值。demo JS 用 rect.top 判定
   「指针在面板上方 = 拖拽场景」，自适应后判定依然成立，无需改 JS。 */
@media (max-width:700px) {
  #detail {
    top: auto;
    height: auto;
    max-height: 68%;
  }
  /* 修11（2026-10-09 七轮）：① 面板文字整组再上移 —— 业主箭头标注「返回街角」
     应在 ≈52% 视口高（原 57.8%），底部 padding 垫高 6vh 把整组往上推；
     ② 移动端移除「返回街角」旁的 ESC 键帽（.back kbd），PC 保留。 */
  #detail {
    padding-bottom: calc(max(38px, env(safe-area-inset-bottom)) + 6vh);
  }
  .back kbd { display: none; }
}
/* 修7（2026-10-09 四轮）：底色层左移，提升工作室/汽车场景下的文字可读性。
   demo 原始：#detail 宽 44%、左缘从全透明渐入（e8 91% 不透明在 25% 面板宽 ≈11vw
   处才到位），文字起始列（padding-left 3vw）背后的底色只有 ~25% 不透明度，
   亮场景（工作室室内灯、汽车场）下文字发虚。做法：
   · 面板加宽 44%→52%（左边界向左移 8vw），padding-left 等量 +8vw —— 文字
     位置一像素不动，动效（panel-in 从右滑入）不受影响；
   · 渐变前段收陡：e8 提前到 12%（≈6.2vw）、fa 全不透明 32% —— 文字区从
     起始列起就处在 ≥90% 不透明度的底色上；
   · 701–1100 段 demo 是 46%/2vw，同差补偿为 54%/10vw。移动端（≤700）不动。 */
@media (min-width: 1101px) {
  #detail {
    width: 52%;
    padding-left: 11vw;
    background: linear-gradient(90deg, #0000, #101c26e8 12%, #101c26fa 32%);
  }
}
@media (min-width: 701px) and (max-width: 1100px) {
  #detail {
    width: 54%;
    padding-left: 10vw;
    background: linear-gradient(90deg, #0000, #101c26e8 12%, #101c26fa 32%);
  }
}
/* 修8（2026-10-09 四轮）：大字统一黑体。demo 里两处大标题是宋体系：
   .intro h1 = Georgia,Noto Serif SC,Songti SC,SimSun,serif（左下 intro），
   .detail-title = font:400 … Georgia,SimSun,serif（交互面板标题，shorthand
   连字重一起定成 400）。业主要求统一黑体 —— 换中文黑体栈并加粗；
   .detail-en（15px 英文斜体）不是大字且宿主面板已不渲染，不动。
   字号/字距/行高一概不碰，只换字族与字重。 */
/* 修8→修9（2026-10-09 五轮）：大字统一黑体但用**细体**（参考图为细黑体，
   700 粗体业主不要）——字族不变，字重 700 → 300（Microsoft YaHei Light）。
   .detail-title 的 demo shorthand 字重 400 也一并压到 300 保一致。
   字号/字距/行高一概不碰。 */
.intro h1,
.detail-title {
  font-family: "Microsoft YaHei Light", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif;
  font-weight: 300;
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
/* 业主 2026-10-09 第三轮：「点击后那个框还是没移除掉」——指 #quality（HIGH）。
   demo 的 .controls button:hover{border-color:#69818b} 会在鼠标移上去/点完之后
   现出一个 42×34 的圆角描边盒（截图为证：点击前不可见、hover 后整框显形）。
   业主不要这个框 ⇒ 只对 #quality 关掉描边，rain / motion 的悬停反馈保留。
   ⚠ 只改 border-color、不改 border-width：盒模型不变 ⇒ 不产生任何回流。 */
.controls #quality,
.controls #quality:hover,
.controls #quality:focus,
.controls #quality:focus-visible,
.controls #quality:active {
  border-color: transparent !important;
  outline: none !important;
  box-shadow: none !important;
}
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
     行1「打个电话」rows 818..833、行2「发封邮件」rows 856..871
     提示行 rows 931..937；底部控制条图标 rows 951..957
   ⚠ 2026-10-09 终版：三个位置关系（文案底＝图标底、hint 贴图标、按钮行对
     标题行）已改由注入脚本实测反推（见 injectStreetQuick），这里的 right /
     bottom 只作为 JS 执行前的兜底值，不再是最终位置。 */
.street-quick {
  position: fixed; right: 46px; bottom: 135px; z-index: 5;
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
/* 行距由脚本写常量（--sq-gap，PC＝设计稿行距 38 − 按钮行高；移动端回到下面兜底的 16px） */
.sq-row + .sq-row { margin-top: var(--sq-gap, 22px); }
.sq-row:hover { color: #eaf0f6; }
.sq-ico {
  width: 15px; height: 15px; flex: none;
  fill: none; stroke: currentColor; stroke-width: 1.2px;
  stroke-linecap: round; stroke-linejoin: round;
}
/* 听筒图标是 fill 型（业主 2026-10-09 提供 SVG）——整块填色、无描边 */
.sq-ico-fill { fill: currentColor; stroke: none; }
/* ⚠ 邮件图标（业主 2026-10-10 提供 Group 29.svg）——SVG 内部（路径 / 0.7 描边 /
   rect）一个字节不许动；显示尺寸走**等比缩放**。第三轮（同日）：业主实测信封
   仍明显大于听筒（信封 glyph 几乎撑满画框、听筒本体小一圈），要求「单独缩小 +
   与电话 icon 水平对齐」。做法：宽度锁成与听筒同宽（PC 15 / 移动 13），高度按
   18:17 固有比例自动反推 ⇒ ① 视觉上比听筒矮一截=缩小；② 两行右缘对齐、文本
   等宽 ⇒ 图标左缘严格垂直对齐。信封 glyph 的下划线 rect 也在框内，不越界。 */
.sq-ico-raw { flex: none; display: block; width: 15px; height: auto; }
/* 提示行到「发封邮件」的间距由脚本写入常量（--sq-hint-mt，PC 40px），底边同时钉在图标上沿 */
.sq-hint { margin: var(--sq-hint-mt, 40px) 0 0; color: #7f8c96; font-size: 9px; letter-spacing: 1px; }
/* 业主 2026-10-09：面板里「复制号码 / 复制邮箱」太贴主按钮 —— demo gap
   桌面 20px / ≤700 段 10px，各拉开一档（宿主层覆盖，demo 产物不动）。 */
.actions { gap: 24px !important; }
/* demo 进入 phone/mail/car 面板时 #detail 从右侧盖住 44% —— 新块同步淡出 */
body:not([data-mode="overview"]) .street-quick { opacity: 0; pointer-events: none; }

@media (min-width:1600px) { .street-quick { bottom: 145px; } }
@media (max-width:1100px) { .street-quick { right: 28px; } }
@media (max-width:700px) {
  /* ⑨ 移动端：图标不抬（--sq-lift 归零）；业主删掉「点击 / 拖动 探索场景」提示行 ——
     元素保留在 DOM 里（注入脚本要用它判断 PC/移动分支），只隐藏。 */
  :root { --sq-lift: 0px; }
  .sq-hint { display: none !important; }
  /*⚠ 移动端不能沿用 105px：demo 的 ≤700 段把 .controls 改成
     position:absolute; bottom:71px（.hud 自身高度因此塌成 0），实测
     .controls 顶边落在视口底往上 123px 处 —— 新块 bottom:93 会压到它身上
     （探针 probe-street-mobile.mjs 实测 overlapControls=true）。
     这里取 controls 顶再上抬 37px（≈参考图 909→948 的 39px 间距）。 */
  /* ⑨ 移动端兜底：图标不抬、提示行隐藏 ⇒ 整列底边 = 图标上沿 − 14（实测图标
     上沿距视口底 123 ⇒ 137）。JS 跑起来后会再实测一次覆盖它。 */
  .street-quick { right: 16px; bottom: 140px; }
  .sq-row { gap: 10px; font-size: 11px; letter-spacing: 1px; }
  /* ⚠ 这条只命中「打个电话」的听筒（class=sq-ico）；邮件图标 .sq-ico-raw
     在下面单独等比缩到与听筒同宽（13px），高度按 18:17 自适应。 */
  .sq-ico { width: 13px; height: 13px; }
  .sq-ico-raw { width: 13px; }
  .sq-row + .sq-row { margin-top: var(--sq-gap, 16px); }
  .sq-hint { margin-top: var(--sq-hint-mt, 30px); font-size: 8px; }
  /* 业主 2026-10-09：移动端面板「复制号码/复制邮箱」贴主按钮（demo ≤700 段 gap:10px） */
  .actions { gap: 18px !important; }
  /* ⚠ ⑥ 的字号是照参考图（1920 宽PC）量的，直接搬到 402px 宽的移动端会让
     .intro 从w192 涨到 w311、高 142→204，**同时横向与纵向撞上右下新块**
     （探针实测 overlapIntro=true）。这里按demo 移动端基准缩回：
     h1 24px / 字距 2px ⇒ 「有个有趣的想法？」约 206px 宽，避开新块左沿 301。 */
  .intro .eyebrow { font-size: 8px; letter-spacing: 1.4px; }
  .intro .tiny-line { width: 26px; }
  /* ⚠ 2026-10-09 终版：margin 从 14/12 调成 8/28 —— 设计稿里 h1 两行与右侧
     两个按钮同节奏（第一行对第一行）。文案块底边钉在图标底边后，标题原本比
     设计稿低 ≈17px（于是按钮看起来"浮"在标题上方）；把 margin-bottom 加大
     17px 让标题整块上移、margin-top 减小 6px 让 eyebrow 只上移 10px，即与
     设计稿重合。数值按 402×874 实测反推，不改字号。
     ⚠ ⑨ 2026-10-09 业主「左边文字的高度间距收一下，现在有点宽」——
     行高 1.42→1.24（标题两行 34→29.8）、标题 margin-bottom 28→18、
     落款 margin-top 18→12：整块高 152→128（实测反推），底边仍钉在图标底边，
     所以是"顶部往下收"而不是整体挪位。字号一概不动。 */
  .intro h1 { font-size: 24px; line-height: 1.24; letter-spacing: 2px; margin: 8px 0 18px; }
  .intro p { font-size: 10px; letter-spacing: 1.4px; }
  /* ⑨ 业主「FOUR DESIGN / INDEPENDENT CREATIVE STUDIO 之间间距收窄」：
     demo 是 gap:18px + letter-spacing 1px（6.5px 字号下相当于 3 个字宽）。 */
  .intro-foot { font-size: 6.5px; letter-spacing: .8px; margin-top: 12px; gap: 8px; }
}
`;

// iframe 内部执行：劫持滚动 → 交还父页面；其余一概不碰。
// postMessage 是单向的（iframe → parent），父页面不回灌，因此不会有转发环路。
const HOST_JS = `
(function () {
  if (window.__streetHostHooked) return;
  window.__streetHostHooked = true;

  // 汽车机位叠加（两个平台共用一个 WeakMap 钩子，捕获即恢复）：
  //   · 移动端 —— 位置偏移做前侧特写（按参考图保留侧身透视与轻微俯角）。
  //   · PC 端 —— 相机沿自身右向量整体平移（注视点同步平移 ⇒ 纯平移、不转向）。
  // lookAt 前应用机位偏移，下次回调前还原，避免插值累加偏移。
  //
  // ⚠ PC 端为什么必须是「真平移」而不是 setViewOffset 投影横移：
  //   投影横移是屏幕空间整体位移，车和充电桩位移**完全相同** ⇒ 桩永远出不来。
  //   真平移才有视差（位移 ∝ 1/深度）：车近、充电桩远 ⇒ 桩相对车右移才露得出来。
  //   右向量取 normalize(cross(forward, up))，与 demo 内部的 mf 完全同式，方向一定对。
  var carCamera = null;
  var carCameraOffset = null;
  // PC 平移量（世界单位，沿相机右向量；正值 ⇒ 相机右移 ⇒ 场景左移）。
  // 0.5 ≈ 车中心左移 5.4% 视口宽（1512 宽下约 82px）：右侧充电桩完整露出，
  // 车头左缘仍有约 3% 视口宽余量（再大就裁车头，实测 0.6 起前灯出画）。
  var CAR_PAN_PC = 0.5;

  // ── 移动端「初始镜头拉近」（2026-10-10 第一轮，取代 10-09 的 canvas CSS 缩放）─
  // 业主需求：移动端 overview 场景太小要拉近，但**交互后的镜头是他单独调过的**，
  // 一个字节都不能动。上一版给 canvas 加 transform:scale 之所以是错的：放大发生在
  // 光栅之后，overview 与所有交互终态被等比放大 ⇒ 四套交互机位全部要重调。
  //
  // 正解 = 只改**主相机的 fov**（投影阶段，等价于换长焦镜头）：
  //   · fov 只在 nonzero(overview) 时被压窄，其余模式恒回 demo 原始 40；
  //   · 交互的终态由 demo 自己的相机插值决定（position/target），与 fov 无关，
  //     且我们在 transition 走完时 fov 已精确回到 40 ⇒ **交互机位与业主调过的
  //     完全一致**，一套都不用重调；
  //   · 进出 handler：ê mode 从 overview ↔ 其它切换时，用与 demo 同款 smootherstep
  //     在 ZOOM_MS 内把缩放量平滑推到 0/1 ⇒ 看起来就是本次转场的一部分；
  //   · 每帧在 demo 的帧回调**之前**写 fov + updateProjectionMatrix：demo 从不写
  //     fov（bundle 已核：fov 只在初始化出现一次）⇒ 不会打架；射线拾取用的是
  //     同一份 projectionMatrix ⇒ 点击判定与看到的画面严格一致。
  // ⚠ 运行时可调（不必重新构建，下一帧生效）：
  //     window.__streetMobileZoom —— ≤700px 的倍率（>1 越大越近）
  //     window.__streetZoomPc     —— ≥701px 的倍率
  //   铁律不变：只拉近 overview（初始镜头），交互模式 fov 恒为 demo 原始 40。
  var BASE_FOV = 40;
  // 业主 2026-10-10 第二轮：移动端在 1.25 基础上再微微放大；PC 端同样拉近初始
  // 镜头（PC 视口宽、街景本身已经看得比较全 ⇒ 用更温和的倍率）。
  var ZOOM_MOBILE = 1.32;
  var ZOOM_PC = 1.18;
  var ZOOM_MS = 1400;                       // 与 demo 镜头转场同量级
  var ZOOM_DUR = ZOOM_MS / 1000;
  var zoomBlend = 1;                        // 1 = 完全拉近，0 = demo 原视角
  var zoomFrom = 1, zoomTo = 1, zoomT0 = 0, zoomLastMode = null;
  var smoothstep = function (t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  var applyOverviewZoom = function (now) {
    var cam = carCamera;
    if (!cam) return;
    var narrowViewport = window.innerWidth <= 700;
    var mode = (window.__four && window.__four.mode) || 'overview';
    if (mode !== zoomLastMode) {
      zoomLastMode = mode;
      zoomFrom = zoomBlend;
      zoomTo = mode === 'overview' ? 1 : 0;
      zoomT0 = now;
    }
    if (zoomBlend !== zoomTo) {
      var p = ZOOM_DUR > 0 ? Math.min(1, (now - zoomT0) / ZOOM_MS) : 1;
      zoomBlend = zoomFrom + (zoomTo - zoomFrom) * smoothstep(p);
    }
    var knob = narrowViewport
      ? (typeof window.__streetMobileZoom === 'number' ? window.__streetMobileZoom : ZOOM_MOBILE)
      : (typeof window.__streetZoomPc === 'number' ? window.__streetZoomPc : ZOOM_PC);
    var mag = 1 + (knob - 1) * zoomBlend;     // 实际放大倍率
    if (mag <= 1.0005) {
      if (cam.fov !== BASE_FOV) { cam.fov = BASE_FOV; cam.updateProjectionMatrix(); }
      return;
    }
    var half = BASE_FOV * Math.PI / 360;
    cam.fov = 2 * Math.atan(Math.tan(half) / mag) * 180 / Math.PI;
    cam.updateProjectionMatrix();
  };
  window.__streetZoomDebug = function () {
    return {
      blend: +zoomBlend.toFixed(3),
      fov: carCamera ? +carCamera.fov.toFixed(2) : null,
      mode: (window.__four && window.__four.mode) || null,
      wide: window.innerWidth > 700,
      mag: +(1 / Math.tan(carCamera ? carCamera.fov * Math.PI / 360 : BASE_FOV * Math.PI / 360) * Math.tan(BASE_FOV * Math.PI / 360)).toFixed(3)
    };
  };
  // Reflector 每帧以主相机为 WeakMap key，支持宿主注入晚于相机创建。
  // 捕获一次即恢复 get，后续只包装当前 iframe 的主相机。
  var originalWeakGet = WeakMap.prototype.get;
  var captureCamera = function (key) {
    if (key && key.isPerspectiveCamera && key.fov === 40 && key.near === 0.18 && key.far === 120) {
      carCamera = key;
      WeakMap.prototype.get = originalWeakGet;
      window.__streetCarCameraReady = true;
      var originalLookAt = key.lookAt;
      key.lookAt = function () {
        var state = window.__four;
        if (state && state.mode === 'car') {
          var transition = state.transition;
          var progress = transition && transition.active ? Math.min(1, Math.max(0, transition.elapsed / 1.4)) : 1;
          var eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
          if (window.innerWidth <= 700) {
            carCameraOffset = { x: 1.35 * eased, y: -1.6 * eased, z: -0.25 * eased };
            key.position.x += carCameraOffset.x;
            key.position.y += carCameraOffset.y;
            key.position.z += carCameraOffset.z;
            var view = key.view;
            key.setViewOffset(window.innerWidth, window.innerHeight,
              (view && view.enabled ? view.offsetX : 0) + window.innerWidth * 0.025 * eased,
              (view && view.enabled ? view.offsetY : 0) + window.innerHeight * 0.009 * eased,
              window.innerWidth, window.innerHeight);
          } else {
            var tgt = arguments[0];
            if (tgt && tgt.isVector3) {
              var px = key.position.x, py = key.position.y, pz = key.position.z;
              var fx = tgt.x - px, fy = tgt.y - py, fz = tgt.z - pz;
              var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
              fx /= fl; fy /= fl; fz /= fl;
              // up = (0,1,0) ⇒ right = normalize(-f.z, 0, f.x)
              var rx = -fz, rz = fx;
              var rl = Math.sqrt(rx * rx + rz * rz) || 1;
              rx /= rl; rz /= rl;
              var panUnits = typeof window.__streetCarPan === 'number' ? window.__streetCarPan : CAR_PAN_PC;
              var d = panUnits * eased;
              carCameraOffset = { x: rx * d, y: 0, z: rz * d };
              key.position.x = px + carCameraOffset.x;
              key.position.z = pz + carCameraOffset.z;
              var moved = tgt.clone();
              moved.x += carCameraOffset.x;
              moved.z += carCameraOffset.z;
              window.__streetCarPanApplied = { panUnits: panUnits, eased: +eased.toFixed(3) };
              return originalLookAt.call(this, moved);
            }
          }
        }
        return originalLookAt.apply(this, arguments);
      };
    }
    return originalWeakGet.apply(this, arguments);
  };
  WeakMap.prototype.get = captureCamera;
  window.setTimeout(function () {
    if (WeakMap.prototype.get === captureCamera) WeakMap.prototype.get = originalWeakGet;
  }, 15000);

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
  //   __streetPaused     —— 空转保活（默认 5s 一帧，见 __streetIdleMs；早期是 1s，
  //     但手机上一帧 85ms，太密会撞进跨级转场）。WebGL 上下文、已编译的 shader、
  //     已加载的纹理全部保活，回到尾屏立刻满帧，预挂载红利一点不丢。
  //     期间宿主可用 __streetHold / parent.__streetHoldUntil 让它一帧都不喂。
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
  // 人造轴每帧只按固定步长递增（满帧档 +16ms、空转档每 __streetIdleMs 才 +16ms），
  // 而尾屏是**预挂载**的：它在首屏/二级页期间已经空转了很久，人造轴会落后
  // 真实时钟几十秒到几分钟。于是点下去那一刻 (e - cf) 恒为负 → n 恒等于 0 →
  // 相机永远停在起点，1.4s 的推进动效**整个消失**（表现为"点了没反应/硬切"）。
  // 降帧只能改"多久回调一次"，不能改"回调里报几点"。两者必须解耦。
  window.__streetPaused = false;
  window.__streetFrameMs = 0;
  // 空转保活间隔（毫秒，宿主可写）。**原值 1000ms**；2026-10-10 曾改到 5000，因业主
  // 反馈"尾屏开播要等好一会"而回撤（原因见文件上方 IDLE_KEEPALIVE_MS 的注释）。
  window.__streetIdleMs = 1000;
  // ⚠ 2026-10-10 起 __streetHold 不再被消费（保活分支里的"转场期间不喂帧"已回撤）。
  // 保留这个字段只是为了让旧宿主调用不至于报错，新代码不应再依赖它。
  window.__streetHold = false;
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
    if (carCamera && carCameraOffset) {
      if (window.__four && window.__four.mode === 'car') {
        carCamera.position.x -= carCameraOffset.x;
        carCamera.position.y -= carCameraOffset.y;
        carCamera.position.z -= carCameraOffset.z;
      }
      carCameraOffset = null;
    }
    applyOverviewZoom(at);   // ⚠ 必须在 cb 之前：cb 里才是 demo 的绘图
    cb(at);
  };
  window.requestAnimationFrame = function (cb) {
    return rawRaf(function () {
      if (window.__streetPaused) {
        nextAt = 0;
        // 空转保活：只负责「别凉」，间隔由宿主给（见上面的 __streetIdleMs）。
        // ⚠ 2026-10-10 回撤：这里原来读父窗口的 __streetHoldUntil / __streetHold，
        // 在跨级转场那 1.8s 里"一帧都不喂"。回撤原因是它两头不讨好：
        //   ① 业主反馈尾屏开播变慢（喂帧变少 → demo 冷启动更晚跑完，见上面常量注释）；
        //   ② 修好探针闸门后的配对测量里，它也拿不出可见的收益。
        // ⚠ 同日第二处：保活等待期间**看着档位**，一旦宿主把尾屏切回满帧/烧录档就立刻
        // 恢复喂帧，不再把已经排好的那段等待干等完。原来是一个 setTimeout 干等到点，
        // 业主滑到尾屏后最长要等满一个保活间隔才动第一帧（实测：间隔 5s 时 2500ms
        // 才画出第一帧、回到 1s 后仍有 1000ms）—— 这就是"隔好一会才开始播"的残余。
        // 代价只是每 100ms 一次空 setTimeout（真正贵的是帧本身，不是这次唤醒）。
        var idleMs = window.__streetIdleMs || 1000;
        var idleAt = window.performance.now();
        var watch = function () {
          if (!window.__streetPaused) { emit(cb, window.__streetFrameMs > 0); return; }
          var left = idleMs - (window.performance.now() - idleAt);
          if (left <= 0) { emit(cb, false); return; }
          window.setTimeout(watch, left > 100 ? 100 : left);
        };
        window.setTimeout(watch, 100);
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
    <svg class="sq-ico sq-ico-fill" viewBox="0 0 17 17" aria-hidden="true"><path d="M1.11101 7.5624C0.773845 6.44865 -0.0604549 2.7024 3.35876 1.12695C3.68397 0.974487 4.04365 0.910494 4.40149 0.941425C4.75933 0.972357 5.10269 1.09712 5.39692 1.30312C6.02445 1.79696 6.5466 2.4116 6.9325 3.11071C7.3184 3.80982 7.56022 4.5792 7.64366 5.37337C7.68315 5.88594 7.53736 6.39566 7.23282 6.80983C6.92827 7.224 6.4852 7.51511 5.98417 7.63024C6.18667 8.24989 6.88631 9.55399 9.24037 10.6323C9.47325 9.90229 10.0645 8.57287 11.315 8.42809C12.3352 8.47047 13.3059 8.8796 14.0487 9.58031C14.7409 10.0809 15.2345 10.8093 15.4429 11.6377C15.613 13.8227 13.1648 15.1977 11.805 15.3222C11.522 15.349 11.2378 15.3625 10.9535 15.3627C4.83802 15.3617 1.60207 9.17632 1.11101 7.5624ZM3.69288 1.84987C0.935845 3.1236 1.50285 6.10744 1.87038 7.33053C2.50927 9.43451 6.04289 15.0427 11.7311 14.5284C12.7892 14.4322 14.7767 13.3448 14.6491 11.6995C14.4617 11.0869 14.0715 10.5563 13.5425 10.1949C12.9585 9.63996 12.2059 9.29606 11.4041 9.21784C10.2964 9.34642 9.89647 11.2368 9.89445 11.256C9.88267 11.3137 9.85846 11.3682 9.82348 11.4155C9.78851 11.4629 9.74362 11.5021 9.69195 11.5304C9.63983 11.5581 9.5823 11.5741 9.52336 11.5772C9.46442 11.5804 9.4055 11.5706 9.35073 11.5486C5.30985 9.88811 5.10937 7.4247 5.09823 7.32142C5.09424 7.26801 5.10117 7.21435 5.11857 7.1637C5.13598 7.11304 5.16351 7.06646 5.19948 7.02679C5.23564 6.98682 5.27967 6.95477 5.3288 6.93265C5.37794 6.91052 5.43112 6.89879 5.48501 6.8982C5.67727 6.89579 5.86692 6.85342 6.04192 6.77376C6.21692 6.6941 6.37343 6.57891 6.50151 6.4355C6.62959 6.29209 6.72643 6.12361 6.78587 5.94076C6.84532 5.7579 6.86608 5.56468 6.84682 5.37337C6.68506 4.04003 6.01163 2.82167 4.96863 1.97542C4.74643 1.82188 4.48432 1.73638 4.21432 1.72939C4.03377 1.7308 3.85575 1.77193 3.69288 1.84987ZM13.9343 6.27247C13.7725 5.14389 13.2449 4.09954 12.4325 3.29959C11.6201 2.49963 10.5677 1.98823 9.4368 1.8438C9.33518 1.82665 9.24414 1.77085 9.18275 1.68808C9.12136 1.6053 9.09438 1.50199 9.10747 1.39977C9.12056 1.29755 9.1727 1.20436 9.25296 1.13973C9.33322 1.07509 9.43539 1.04402 9.53804 1.05304C10.8433 1.21913 12.0579 1.80902 12.9955 2.73215C13.9331 3.65528 14.5418 4.86062 14.7281 6.16312C14.7429 6.26784 14.7154 6.37413 14.6518 6.45862C14.5882 6.5431 14.4936 6.59888 14.3889 6.61369C14.3704 6.61473 14.3518 6.61473 14.3332 6.61369C14.2366 6.61513 14.1428 6.58127 14.0693 6.51845C13.9959 6.45563 13.9479 6.36817 13.9343 6.27247ZM11.5549 6.17122C11.4865 5.69206 11.2625 5.24864 10.9175 4.90914C10.5725 4.56963 10.1256 4.35282 9.64537 4.29202C9.59352 4.28537 9.54348 4.26858 9.49811 4.24259C9.45275 4.2166 9.41295 4.18194 9.38098 4.14057C9.34901 4.0992 9.32551 4.05194 9.3118 4.00149C9.2981 3.95104 9.29447 3.89838 9.30112 3.84652C9.30777 3.79467 9.32456 3.74463 9.35055 3.69926C9.37654 3.6539 9.41121 3.6141 9.45257 3.58213C9.49394 3.55017 9.5412 3.52666 9.59165 3.51296C9.64211 3.49926 9.69476 3.49562 9.74662 3.50227C10.3999 3.5853 11.0079 3.88034 11.4774 4.34214C11.9469 4.80394 12.2519 5.40701 12.3457 6.05884C12.3531 6.11063 12.3503 6.16339 12.3373 6.21408C12.3243 6.26478 12.3015 6.31241 12.2701 6.35426C12.2387 6.39612 12.1993 6.43136 12.1543 6.45798C12.1092 6.4846 12.0593 6.50207 12.0075 6.5094C11.9887 6.51113 11.9697 6.51113 11.9508 6.5094C11.8557 6.50874 11.7639 6.4741 11.692 6.41171C11.6202 6.34933 11.573 6.26332 11.559 6.1692L11.5549 6.17122Z"/></svg>
    <span>打个电话</span>
  </button>
  <button class="sq-row" type="button" data-sq-mode="mail">
    <svg class="sq-ico-raw" width="18" height="17" viewBox="0 0 18 17" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M0.929493 7.91446L10.3493 0.820988C10.5919 0.638262 10.9368 0.686841 11.1195 0.929492L15.9921 7.40004C16.1748 7.64269 16.1262 7.98753 15.8836 8.17025L6.46378 15.2637C6.22112 15.4465 5.87629 15.3979 5.69356 15.1552L0.820989 8.68468C0.638263 8.44203 0.686842 8.09719 0.929493 7.91446Z" stroke-width="0.7" stroke="white"/><path d="M0.931641 8.27344L7.26486 8.09936C8.03364 8.07823 8.70407 7.571 8.93347 6.83694L10.8 0.864038" stroke-width="0.7" stroke="white"/><rect y="15" width="17.1" height="0.8" rx="0.4" fill="white"/></svg>
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
    + '<div class="actions"><button class="primary-action" data-switch="phone">聊聊你的想法 <span>↗</span></button></div>';
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
    // 「写一封信」按业主指定跳 QQ 邮箱网页版（新标签页），不再走 mailto。
    + '<div class="actions"><a class="primary-action" href="https://wx.mail.qq.com/" target="_blank" rel="noopener noreferrer">写一封信 <span>↗</span></a>'
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

// ── 尾屏初始态精确排版（业主 2026-10-09 设计稿终版 + 终轮微调）────────────────
//  PC（提示行在）：
//   ① 左下文案**墨迹**底边（.intro-foot 看得见的字底）＝ 右下图标行**墨迹**底边
//   ② 「点击 / 拖动 探索场景」提示行底边 ＝ 图标上沿 − HINT_OFF
//   ③ 两个按钮行距 ＝ 标题行距 × 0.56（设计稿 38/68，比标题两行紧）
//  ④ 提示行 ↔「发封邮件」间距 ＝ 常量 HINT_MT（变小＝两按钮整体下移）
// 移动端（提示行已隐藏）：
//   ① 同 PC；② 整列底边钉在图标上沿 − MOB_ICON_GAP（业主「贴近图标」）；行距交回 CSS。
// 两端共通：
//   ⑤ 右缘：整块右边缘 ＝ #quality 里 "HIGH" 的文字**墨迹**右缘（不是那个按钮盒）
// 位置关系全部实测反推、不写死 px ⇒ 任何机型、地址栏/安全区变化、缩放都自动跟随
// （CSS 里的 bottom / 行距只作 JS 执行前的兜底）。
// ⚠ ① ⑤ 的量取口径是**墨迹**（眼睛看到的边）而不是盒：文字走 canvas measureText 的
//   actualBoundingBox，svg 走 getBBox 映射。原因：.intro-foot 的行盒含 2px 下伸部、
//   图标按钮是 34px 盒里居中 16px 图形、#quality 是带 6px 内边距的按钮 —— 按盒对齐
//   时"看着没对齐"，业主 2026-10-09 连着两轮都是指这个。
// ⚠ 图标自身的抬升在 HOST_CSS ⑨ 里用 --sq-lift 声明（PC 56px、移动端 0）：本文只负责
//   「数量关系」，不碰绝对位置，所以业主改主意要再抬/再压，只动那一个 CSS 变量。
//
// ⚠⚠ 第十九轮（业主 2026-10-09「PC 端还是没有对齐」）真根因：
//   原实现把 rAF 校准循环写在 injectStreetQuick 内部「插入 DOM 之后」，而
//   injectStreetQuick 是**一次性**的（#street-quick 已存在就 early-return）。
//   首次注入发生在 iframe 文档刚创建、body 才开始解析的瞬间 —— 那一刻
//   <main>/.intro 还没被解析出来 ⇒ 守卫 `if (introEl && …)` 失败，校准循环
//   **从未启动**；而 #street-quick 已经插进 DOM，后续每次重入都 early-return，
//   永远没有第二次机会。真实渲染就全程停在 CSS 写的兜底值上（hint/按钮离线很远），
//   即业主看到的"完全没对齐"。headless 本地加载极快，第一次读 contentDocument
//   时文档已解析完，所以探针一直测不出来 —— 典型的时序型 bug。
//   修法：排版抽成**幂等、可重入**的 startStreetAlign()：
//     · 每次调用先立刻校准一次，并重开一段有期限的 rAF 校准窗口；
//     · 节点没齐不算失败，窗口内继续等（不消耗预算，等文档解析完自然成）；
//     · MutationObserver 自愈（进场动画/字体晚到/data-mode 切换都会改几何）；
//     · 暴露 win.__streetAlignNow()，React 侧在「滑到尾屏(active)」时再触发一次。
function startStreetAlign(doc) {
  if (!doc || !doc.body) return false;
  const win = doc.defaultView;
  if (!win) return false;
  // 幂等：已装过就只触发一次即时校准（不再挂监听、不再起循环）
  if (typeof win.__streetAlignNow === 'function') {
    try { win.__streetAlignNow(); } catch (_) { /* noop */ }
    return true;
  }
  const HINT_OFF = 10;      // PC：提示行底边到图标行上沿的间距（设计稿 ≈10px）
  // PC：提示行到「发封邮件」的间距。⚠ 整块是**底部锚定**的（提示行底边钉在图标上沿），
  // 所以这个值变小＝两个按钮整体**下移**（提示行不动）。业主 2026-10-09 第二轮：
  // 「右边的电话和邮箱按钮再往下移动一些」⇒ 52 → 40（按钮下移 12px）。
  const HINT_MT = 40;
  const BTN_PITCH_RATIO = 0.56; // PC：两按钮行距 ÷ 标题行距（设计稿 38/68）
  const MIN_BTN_PITCH = 34; // PC：行距下限（窄屏标题变小，而按钮字号恒 12.5px）
  const MOB_ICON_GAP = 14;  // 移动端：「发封邮件」底边到图标上沿（业主「贴近图标」）
  // demo 的 #quality 标签集合（源码：e.currentTarget.textContent = ['HIGH','ECO'][f]）。
  // 右缘锚点按「最宽的那个」算 ⇒ 切换标签时锚点恒定（业主 2026-10-09 第三轮）。
  const Q_LABELS = ['HIGH', 'ECO'];
  const WINDOW_MS = 2500;  // 每次触发后的连续校准窗口（覆盖进场过渡）
  // 诊断计数器（探针读）：tick 跑了几次 / 卡在 pick 还是 iconBox / 有没有真的写值。
  // 静默 catch 会把异常吞掉，没有这个就只能靠猜。
  const dbg = { tick: 0, align: 0, pick: 0, box: 0, wrote: 0, err: '', kick: 0, ink: '' };
  win.__streetAlignDbg = dbg;

  let timerId = 0;
  let deadline = 0;
  let moRef = null;
  let moTimer = 0;
  const OBS_OPTS = {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['class', 'style', 'data-mode'],
  };

  // ⚠ 校准窗口用 win.setTimeout 而不是 rAF：宿主把 iframe 的 requestAnimationFrame
  //   包成「尾屏不在视野就降频/推迟」（见 HOST_JS 的 __streetPaused），空转档下要等
  //   满一个保活间隔才喂一帧 —— 实测 walk 循环 20s 一次都没跑（dbg.tick = 0）。
  //   setTimeout 不受那层包装影响，100ms 一轮、2.5s 窗口 = 25 次实测，足够覆盖
  //   进场过渡；真正的实时性由「尾屏激活时父页面侧多点重触发」保证。

  const pick = () => {
    // ⚠ 用 win.document 而不是闭包捕获的 doc：startStreetAlign 可能在 iframe 还停在
    //   about:blank 时就被调用，那个 document 随导航一起失效（查询恒 null）⇒
    //   修复前必须确认这里取的是"当前活着的文档"。
    const d = win.document || doc;
    dbg.sameDoc = (d === doc);
    dbg.docUrl = String(d.URL || '');
    if (win.__streetAlignObserved) dbg.obsLive = (win.__streetAlignObserved === d.documentElement);
    // ⚠ 文档对象会被替换（实测：注入后 win.document 换了一个新对象，旧对象成死节点）
    //   ⇒ 观察器必须每次校准自检、发现目标变了就重新 observe，否则等于没挂。
    if (moRef) {
      const root = d.documentElement;
      if (root && win.__streetAlignObserved !== root) {
        try { moRef.observe(root, OBS_OPTS); win.__streetAlignObserved = root; } catch (_) { /* noop */ }
      }
    }
    const introEl = d.querySelector('.intro');
    const h1 = d.querySelector('.intro h1');
    const footEl = d.querySelector('.intro-foot');
    const controls = d.querySelector('.controls');
    const quality = d.getElementById('quality');
    const quick = d.getElementById('street-quick');
    const hint = quick && quick.querySelector('.sq-hint');
    const rows = quick ? Array.prototype.slice.call(quick.querySelectorAll('.sq-row')) : [];
    if (!introEl) { dbg.miss = 'intro'; return null; }
    if (!h1) { dbg.miss = 'h1'; return null; }
    if (!footEl) { dbg.miss = 'foot'; return null; }
    if (!controls) { dbg.miss = 'controls'; return null; }
    if (!quick) { dbg.miss = 'quick'; return null; }
    // ⚠ hint 不列为必需：移动端业主已把它隐藏（甚至将来可能整条删掉），
    //   缺了它只影响 PC 分支的"贴图标"关系，不该让整条对齐静默失效。
    if (!hint) dbg.noHint = 1;
    if (rows.length !== 2) { dbg.miss = 'rows=' + rows.length; return null; }
    return { introEl, h1, footEl, controls, quality, quick, hint, rows };
  };

  // ── 视觉墨迹框（"眼睛看到的边"）─────────────────────────────────────────────
  // ⚠ 业主 2026-10-09 两轮都指同一件事：按**盒**对齐 ≠ 按**看得见的边**对齐。
  //   左英文 .intro-foot：8.5px 字体 + line-height:normal ⇒ 行盒底比字底多 2px
  //     下伸部（全大写，实际无下伸字母）；
  //   右图标：34px 的 .controls button 里居中一个 16px 的 svg ⇒ 上下各 9px 空白。
  //   于是"盒对盒"看着差 ≈10px（实测：英文墨迹底 976.5 / 图标墨迹底 966.5）。
  //   这里把口径换成墨迹：文字用 canvas measureText 的 actualBoundingBox，
  //   svg 用 getBBox() 映射回屏幕坐标。量不到时上层退回旧的"盒"算法。
  const ctxFor = (el) => {
    let step = 'cs';
    try {
      const c = win.getComputedStyle(el);
      step = 'create';
      // ⚠ 必须走 win.document：本函数在 startStreetAlign 作用域，取不到 pick() 里的 d
      const cv = win.document.createElement('canvas');
      step = 'ctx';
      const g = cv.getContext && cv.getContext('2d');
      if (!g) { dbg.ink = 'ctxnull'; return null; }
      step = 'font';
      g.font = [c.fontStyle, c.fontWeight, c.fontSize, c.fontFamily].join(' ');
      step = 'ok';
      return g;
    } catch (e) { dbg.ink = 'ctx@' + step + ':' + (e && e.message); return null; }
  };
  // 元素里**最后一个**非空文本节点（.sq-row 里 svg 之后那段文字 / #quality 的 "HIGH"）
  // ⚠ 不要用 TreeWalker + NodeFilter：注入上下文里 `NodeFilter` 取不到（实测 dbg.ink='notn'，
  //   被 try/catch 静默吞掉、整条墨迹对齐悄悄退回盒对齐）。这里只认 nodeType 数字。
  const textNodeOf = (el) => {
    let last = null;
    const walk = (node) => {
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType === 3) { if ((c.textContent || '').trim()) last = c; }
        else if (c.nodeType === 1) walk(c);
      }
    };
    try { walk(el); } catch (_) { return null; }
    return last;
  };
  const textInk = (el) => {
    if (!el) { dbg.ink = 'noel'; return null; }
    const tn = textNodeOf(el);
    if (!tn) { dbg.ink = 'notn'; return null; }
    const cv = ctxFor(el);
    if (!cv) return null; // ctxFor 内部已写 dbg.ink 的失败步骤码，这里别再覆盖
    let m;
    try { m = cv.measureText((tn.textContent || '').trim()); } catch (e) { dbg.ink = 'mt:' + (e && e.message); return null; }
    if (!m || m.actualBoundingBoxAscent == null) { dbg.ink = 'nomb'; return null; }
    let r = null;
    try {
      const rg = win.document.createRange();
      rg.selectNodeContents(tn);
      r = rg.getClientRects()[0];
    } catch (e) { dbg.ink = 'rg:' + (e && e.message); return null; }
    if (!r) { dbg.ink = 'norect'; return null; }
    dbg.ink = 'ok';
    // line-height:normal ⇒ 行盒高 = fontBoundingBoxAscent + fontBoundingBoxDescent，
    // 基线就在 r.top + fontAscent 处（无 half-leading）
    const fa = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : m.actualBoundingBoxAscent;
    const base = r.top + fa;
    // ⚠ 横向不用 canvas 的 actualBoundingBoxRight：它不含 letter-spacing，而布局里每个
    //   字后都补了字距（尾字也补）⇒ 会低估右缘。行盒右缘减掉尾随字距才是"看得见的右缘"
    //   （实测：行盒右 1866 − 字距 1.5 ⇒ 墨迹右 1864.5，像素量到 1864）。
    const ls = parseFloat(win.getComputedStyle(el).letterSpacing);
    const lsx = isFinite(ls) ? ls : 0;
    return {
      left: r.left,
      right: r.right - lsx,
      top: base - m.actualBoundingBoxAscent,
      bottom: base + m.actualBoundingBoxDescent,
    };
  };
  // svg 内容的墨迹框：getBBox() 是用户坐标，按 preserveAspectRatio(默认 xMidYMid meet) 映射
  const svgInk = (svg) => {
    try {
      const r = svg.getBoundingClientRect();
      const bb = svg.getBBox();
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height || !isFinite(bb.width) || !isFinite(bb.height)) return null;
      const sc = Math.min(r.width / vb.width, r.height / vb.height);
      const ox = r.left + (r.width - vb.width * sc) / 2 - vb.x * sc;
      const oy = r.top + (r.height - vb.height * sc) / 2 - vb.y * sc;
      return {
        left: ox + bb.x * sc, right: ox + (bb.x + bb.width) * sc,
        top: oy + bb.y * sc, bottom: oy + (bb.y + bb.height) * sc,
      };
    } catch (_) { return null; }
  };
  // .controls 子元素墨迹的并集（有 svg 就用 svg 墨迹，纯文字就用文字墨迹）
  const ctrlInk = (controls) => {
    let t = Infinity; let b = -Infinity; let l = Infinity; let r = -Infinity;
    Array.prototype.forEach.call(controls.children, (el) => {
      if (win.getComputedStyle(el).display === 'none') return;
      const svg = el.querySelector('svg');
      let ink = (svg && !(el.textContent || '').trim()) ? svgInk(svg) : textInk(el);
      if (!ink) {
        const rr = el.getBoundingClientRect();
        if (rr.height > 0) ink = { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom };
      }
      if (!ink) return;
      if (ink.top < t) t = ink.top;
      if (ink.bottom > b) b = ink.bottom;
      if (ink.left < l) l = ink.left;
      if (ink.right > r) r = ink.right;
    });
    return (isFinite(t) && b > t) ? { top: t, bottom: b, left: l, right: r } : null;
  };

  // 图标行 = .controls 里可见子元素的并集（.controls 自身可能含 padding）。
  // ⚠ 只排除 display:none，**不要**排除 visibility:hidden —— 非 overview 模式下
  //   demo 给 .controls 挂的是 `visibility:hidden`（保留布局），而那正是我们要
  //   锚定的几何；一旦按可见性过滤，iconBox() 恒为 null、整条对齐静默失效
  //   （2026-10-09 实测踩过：探针里 inline 值全空就是这个原因）。
  const iconBox = (controls) => {
    let t = Infinity; let b = -Infinity;
    Array.prototype.forEach.call(controls.children, (el) => {
      if (win.getComputedStyle(el).display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.height <= 0) return;
      if (r.top < t) t = r.top;
      if (r.bottom > b) b = r.bottom;
    });
    return (isFinite(t) && b > t) ? { top: t, bottom: b } : null;
  };

  // 「变了才写」——既是省开销，也是防 MutationObserver 自激（写 style 会触发观察器）
  const setPx = (el, prop, value) => {
    const v = Math.round(value) + 'px';
    if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v);
  };

  // 返回 false = 几何还没齐（不是错误，等待下一帧/下一次触发）
  const align = () => {
    dbg.align += 1;
    const n = pick();
    if (!n) { dbg.pick += 1; return false; }
    const box = iconBox(n.controls);
    if (!box) { dbg.box += 1; return false; }
    const vh = win.innerHeight;
    // ① 左英文的**墨迹**底边 = 图标行的**墨迹**底边（业主 2026-10-09 第二轮：
    //    「查看红色线框，左边英文和右边图标底部还没有进行对齐」）。旧实现用盒：
    //    foot 行盒底含 2px 下伸部、图标按钮 34px 盒里居中 16px 图形 ⇒ 看着差 ≈10px。
    //    descendGap = foot 行盒底 − foot 墨迹底（字体常量，与位置无关）；
    //    目标 foot 盒底 = 图标墨迹底 + descendGap ⇒ 两端"看得见的边"重合。
    //    图标本身已被 CSS 的 --sq-lift 抬过（见 HOST_CSS ⑨），量到多少就贴多少
    //    ⇒ 两端（PC 抬过 / 移动端没抬）同一套代码。
    const inGap = n.introEl.getBoundingClientRect().bottom - n.footEl.getBoundingClientRect().bottom;
    const fInk = textInk(n.footEl);
    const cInk = ctrlInk(n.controls);
    if (fInk && cInk) {
      const descendGap = n.footEl.getBoundingClientRect().bottom - fInk.bottom;
      setPx(n.introEl, 'bottom', vh - (cInk.bottom + descendGap) - inGap);
    } else {
      setPx(n.introEl, 'bottom', vh - box.bottom - inGap); // 兜底：字体未就绪时退回盒对齐
    }
    const rowH = n.rows[0].getBoundingClientRect().height;

    // ⑤ 右缘：锚点必须**与当前标签无关**，否则 HIGH↔ECO 切换时整块跟着动。
    //    业主 2026-10-09 第三轮：「从 high 切换到 ECO 的时候，因为字体数量减少导致上面
    //    这些内容全部产生位移」。探针复核（probe-high-toggle.mjs）：demo 自己不动 ——
    //    .controls / #rain / #motion / #quality 四个盒切换前后完全一致；动的是我这条对齐，
    //    它跟着「当前标签的墨迹右缘」跑了 2px（1865 ↔ 1863）。
    //    demo 的 #quality 是 width:42px 的定宽盒 + 文字居中（.controls button 带
    //    place-items:center），所以稳定锚点 ＝「盒中心 ± 最宽标签的墨迹半宽」：
    //    与文案无关，且在最宽的那个标签（HIGH）显示时正好等于 HIGH 的墨迹右缘。
    //    ⚠ 标签集合取自 demo 源码：textContent = ['HIGH','ECO'][f]（点击在两者间循环）。
    const qAnchor = (() => {
      const q = n.quality;
      if (!q) return null;
      const rect = q.getBoundingClientRect();
      const cv = ctxFor(q);
      if (!cv) return null;
      const ls2 = parseFloat(win.getComputedStyle(q).letterSpacing);
      const cur = (q.textContent || '').trim();
      const list = [];
      Q_LABELS.forEach((s) => { if (list.indexOf(s) < 0) list.push(s); });
      if (cur && list.indexOf(cur) < 0) list.push(cur);
      let w = 0;
      list.forEach((s) => {
        let m2;
        try { m2 = cv.measureText(s); } catch (_) { return; }
        const t = (m2.actualBoundingBoxLeft || 0) + (m2.actualBoundingBoxRight || 0);
        if (t > w) w = t;
      });
      if (!w) return null;
      // 行盒（含尾随字距）在盒里居中 ⇒ 墨迹中心 = 盒中心 − ls/2
      return rect.left + rect.width / 2 - (isFinite(ls2) ? ls2 : 0) / 2 + w / 2;
    })();
    let rowInkRight = -Infinity;
    const track = (el) => { const i2 = textInk(el); if (i2 && i2.right > rowInkRight) rowInkRight = i2.right; };
    n.rows.forEach(track);
    // 移动端提示行 display:none：跳过（否则 textInk 会往 dbg.ink 里写个 'norect' 假故障）
    if (n.hint && win.getComputedStyle(n.hint).display !== 'none') track(n.hint);
    dbg.qAnchor = qAnchor == null ? -1 : Math.round(qAnchor);
    dbg.rowInk = isFinite(rowInkRight) ? Math.round(rowInkRight) : -1;
    if (qAnchor != null && isFinite(rowInkRight)) {
      const curRight = parseFloat(win.getComputedStyle(n.quick).right);
      if (isFinite(curRight)) setPx(n.quick, 'right', curRight - (qAnchor - rowInkRight));
    }

    // 提示行是否参战 = PC / 移动 的分支判据（移动端业主已按 ⑨ 隐藏它）
    const hintOn = !!n.hint && win.getComputedStyle(n.hint).display !== 'none'
      && n.hint.getBoundingClientRect().height > 0;
    dbg.hintOn = hintOn;

    if (hintOn) {
      // ── PC ─────────────────────────────────────────────────────────────────
      // ② 提示行底边 = 图标上沿 − HINT_OFF（业主「提示贴图标」）
      // ③ 两按钮行距 = 标题行距 × 0.56（设计稿 38/68）。业主 2026-10-09：「打个电话
      //    跟发封邮件的间距太宽」—— 旧实现取的是"与标题两行同心"⇒ 行距 = 标题行距
      //    67px，比设计稿紧 29px 的观感差一截。
      // ④ 提示行到「发封邮件」的间距 = 常量 HINT_MT（变小＝两按钮一起下移）。
      const lineH = n.h1.getBoundingClientRect().height / 2;
      const pitch = Math.max(MIN_BTN_PITCH, Math.round(lineH * BTN_PITCH_RATIO));
      const rowGap = Math.max(0, pitch - rowH);
      if (n.quick.style.getPropertyValue('--sq-gap') !== rowGap + 'px') {
        n.quick.style.setProperty('--sq-gap', rowGap + 'px');
      }
      if (n.quick.style.getPropertyValue('--sq-hint-mt') !== HINT_MT + 'px') {
        n.quick.style.setProperty('--sq-hint-mt', HINT_MT + 'px');
      }
      setPx(n.quick, 'bottom', vh - (box.top - HINT_OFF));
      dbg.wrote += 1;
      return true;
    }

    // ── 移动端（无提示行）─────────────────────────────────────────────────────
    // 业主：「右边的两个按钮往下移动一些，贴近右下角的 3 个图标」⇒ 整列底边直接钉在
    // 图标上沿往下 MOB_ICON_GAP 处（旧实现钉在提示行底边，把提示行删掉后自然就位）。
    // 行距交回 CSS 兜底 16px：不再与标题行距联动（标题这会正在被 ⑨ 收窄，联动会一并缩）。
    if (n.quick.style.getPropertyValue('--sq-gap')) n.quick.style.removeProperty('--sq-gap');
    if (n.quick.style.getPropertyValue('--sq-hint-mt')) n.quick.style.removeProperty('--sq-hint-mt');
    setPx(n.quick, 'bottom', vh - box.top + MOB_ICON_GAP);
    dbg.wrote += 1;
    return true;
  };

  const tick = () => {
    timerId = 0;
    dbg.tick += 1;
    try { align(); } catch (e) { dbg.err = 'align:' + (e && e.message); }
    try {
      if (win.performance.now() < deadline) timerId = win.setTimeout(tick, 100);
    } catch (e) { dbg.err = 'tick-to:' + (e && e.message); }
  };
  const kick = (ms) => {
    dbg.kick += 1;
    try {
      deadline = Math.max(deadline, win.performance.now() + (ms || WINDOW_MS));
      if (!timerId) timerId = win.setTimeout(tick, 0);
    } catch (e) { dbg.err = 'kick-to:' + (e && e.message); }
  };
  const now = () => {
    try { align(); } catch (_) { /* noop */ }
    kick(WINDOW_MS);
  };
  win.__streetAlignNow = now;
  try { win.addEventListener('resize', now); } catch (_) { /* noop */ }
  // 自愈：进场动画(transform)、字体晚到、data-mode 切换、demo 自己挪布局都会改几何。
  // 变更后延迟一次重排；align 内部「变了才写」⇒ 收敛后零写入、零自激。
  try {
    moRef = new win.MutationObserver(() => {
      if (moTimer) return;
      moTimer = win.setTimeout(() => {
        moTimer = 0;
        try { align(); } catch (_) { /* noop */ }
      }, 120);
    });
    // ⚠ 必须盯**活着的**文档（win.document），而且要在每次 align 里自检重挂：
    //   实测注入后 win.document 会被替换成一个新对象（旧对象成死节点），一次性
    //   observe 挂上去等于没挂（探针 obsLive=false、观察器全程零回调）。真正的
    //   自愈主力是父页面侧的周期重触发，这里只作附加保险。
    const el = (win.document || doc).documentElement || (win.document || doc);
    moRef.observe(el, OBS_OPTS);
    win.__streetAlignObserver = moRef;
    win.__streetAlignObserved = el;
  } catch (_) { /* noop */ }
  kick(WINDOW_MS);
  return true;
}

function injectStreetQuick(doc) {
  if (!doc || !doc.body) return false;
  if (doc.getElementById('street-quick')) { startStreetAlign(doc); return true; }
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
  // 排版：三条关系全实测反推，见 startStreetAlign（幂等可重入）
  startStreetAlign(doc);
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

  // 业主滑到尾屏时**再触发一次**尾屏排版校准（见 startStreetAlign 的长注释）：
  // 注入可能发生在文档刚创建那几帧（那时 .intro/.controls 还没解析出来，或文档随后
  // 被导航替换 ⇒ 闭包里的 doc 失效），这里是"真的到了尾屏"这个确定时机的兜底。
  // 用**父页面侧**的 setTimeout 触发，不依赖 iframe 内的 rAF（被宿主包装降频）/
  // MutationObserver（实测在 iframe 里能工作，但作为唯一自愈手段不可靠）。
  // 定点 7 次覆盖进场过渡，之后 600ms 一轮共 12s：把「几何被挪走」这类问题也兜住，
  // 12s 后停（不长期空转）。每次触发都会重开 iframe 内的校准窗口。
  useEffect(() => {
    if (!active) return undefined;
    const poke = () => {
      const frame = frameRef.current;
      let w = null;
      try { w = frame && frame.contentWindow; } catch (_) { w = null; }
      if (w && typeof w.__streetAlignNow === 'function') {
        try { w.__streetAlignNow(); } catch (_) { /* noop */ }
      }
    };
    const timers = [0, 120, 320, 700, 1200, 2000, 3200].map((ms) => window.setTimeout(poke, ms));
    const iv = window.setInterval(poke, 600);
    const stop = window.setTimeout(() => window.clearInterval(iv), 12000);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(iv);
      window.clearTimeout(stop);
    };
  }, [active]);

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