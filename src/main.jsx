import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Copy, House, Mail, Phone } from 'lucide-react';
import './styles.css';
import './mobile.css';
import group10Markup from './assets/group-10.svg?raw';
import { createWebCodecsPlayer } from './heroWebCodecs';
import ContactStreet from './contact-street/Street.jsx';

const HERO_HEVC_BASE_SRC = '/media/hero-hevc.mp4';
const HERO_HEVC_MASK_SRC = '/media/hero-mask-hevc.mp4';
const HERO_FALLBACK_BASE_SRC = '/media/hero-base.mp4';
// Grayscale matte for the no-HEVC path (composited through the same WebGL
// matte pipeline as the HEVC pair). The VP9 alpha webm remains only as the
// terminal no-WebGL fallback via HERO_FALLBACK_ALPHA_SRC below.
const HERO_FALLBACK_MASK_SRC = '/media/hero-mask-fallback.mp4';
const HERO_FALLBACK_ALPHA_SRC = '/media/hero-cat-alpha.webm';
const HERO_MOBILE_SRC = '/media/hero-mobile.mp4';
const HERO_MOBILE_FALLBACK_SRC = '/media/hero-mobile-fallback.mp4';
// First frame of the mobile hero, shown before/while the video starts. WeChat
// kernels that refuse autoplay would otherwise leave a black hero.
const HERO_MOBILE_POSTER_SRC = '/media/hero-mobile-poster.webp';
// PC hero first frame (extracted from hero-hevc.mp4). The three-plane canvas
// pipeline only paints once both video clocks have decoded, so without this
// the desktop hero sits as a flat black rectangle during warm-up.
const HERO_PC_POSTER_SRC = '/media/hero-pc-poster.webp';
// MPEG-1 transport stream decoded by JSMpeg straight onto a <canvas>. Used only
// inside WeChat's mobile browser: because no <video> element is involved, the
// autoplay policy never applies and playback really starts on its own.
const HERO_MOBILE_JSMPEG_SRC = '/media/hero-mobile-jsmpeg.ts';
const JSMPEG_VENDOR_SRC = '/vendor/jsmpeg.min.js';
// Raw H.264 (Annex-B, no B-frames) decoded with WebCodecs onto a canvas. This
// is the preferred WeChat path: smaller than the MPEG-1 stream and visually
// lossless, and XWeb's decoder uses the hardware block.
const HERO_MOBILE_WEBCODECS_SRC = '/media/hero-mobile-webcodecs.264';
// Native resolution of the hero master (1440x2560), decoded by the hardware
// block inside WeChat. Level 5.1 matches the encode; `avc1.640033` = High/5.1.
const HERO_MOBILE_WEBCODECS_SIZE = { width: 1440, height: 2560, fps: 24, codec: 'avc1.640033' };
const HERO_HEVC_CODEC_TYPES = [
  'video/mp4; codecs="hvc1.1.6.L153.B0"',
  'video/mp4; codecs="hvc1"'
];
// WeChat's X5/XWeb kernels report spurious HEVC support via canPlayType but their
// players frequently fail to decode it (silent black frame). Never trust HEVC there.
const IS_WECHAT_BROWSER = /MicroMessenger/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : ''
);

// JSMpeg is ~138 KB and only WeChat ever needs it, so it is injected on demand
// rather than bundled into the main chunk. A failed load clears the cache so a
// remount (or a retry after the fallback) can try again.
let jsmpegScriptPromise = null;
function loadJSMpeg() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.JSMpeg) return Promise.resolve(window.JSMpeg);
  if (!jsmpegScriptPromise) {
    jsmpegScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSMPEG_VENDOR_SRC;
      script.async = true;
      script.onload = () => (
        window.JSMpeg ? resolve(window.JSMpeg) : reject(new Error('JSMpeg global missing after load'))
      );
      script.onerror = () => reject(new Error('JSMpeg script failed to load'));
      document.head.appendChild(script);
    });
    jsmpegScriptPromise.catch(() => { jsmpegScriptPromise = null; });
  }
  return jsmpegScriptPromise;
}

const GROUP10_VIEWBOX = '0 0 1640 241';
const GROUP10_PATH_CENTERS = [
  { x: 0.049, y: 0.431 },
  { x: 0.177, y: 0.432 },
  { x: 0.316, y: 0.432 },
  { x: 0.418, y: 0.431 },
  { x: 0.521, y: 0.432 },
  { x: 0.642, y: 0.432 },
  { x: 0.771, y: 0.432 },
  { x: 0.832, y: 0.432 },
  { x: 0.927, y: 0.432 }
];

// The new SVG already contains seven independent white paths for "welcome".
// Keep a fallback center for each one so the interaction remains stable even
// while an SVG is being re-mounted or before getBBox() becomes available.
const GROUP10_WELCOME_SUBPATH_CENTERS = [
  { x: 0.981, y: 0.894 },
  { x: 0.931, y: 0.894 },
  { x: 0.883, y: 0.894 },
  { x: 0.856, y: 0.894 },
  { x: 0.829, y: 0.894 },
  { x: 0.802, y: 0.894 },
  { x: 0.776, y: 0.894 }
];

// 移动端副标 "Four Design" 的入场时机与位置，都以 hero 中心 SVG 的 R 字母为准：
// PORTFOLIO 字标 = P(0) O(1) R(2) T(3) F(4) O(5) L(6) I(7) O(8)，每个 path 入场 =
// index*120 + 1800ms；R 是第 3 个字母(index 2) → 2*120 + 1800 = 2040ms(名义时长结束)。
// ② 位置：把 "Four Design" 左缘对齐到 R 的右缘(实测 R 的 getBoundingClientRect().right)，
//    使首字母 F 正好接在 R 结束的地方，形成纵向连续的视觉关系。
//
// ⚠ 2026-10-07 定稿(业主第五次反馈)。前四版都错在同一个思路上：我一直在给 FOUR DESIGN
//   「逐字错峰」(v1 2040/120/1800 拖到 5000ms；v2 1720/100/650 提前开头；v3 1720/85/380 更快；
//    v4 1080/120/1800 复用上面 path 公式但仍逐字)，而业主要的是**整行一起出现，不要逐字分开**。
//   → 现在：11 个字符共用同一个 delay，同一条曲线同时开始、同时结束，整行作为一个整体浮现。
//   动效本体仍与上面 SVG 同源(业主同时要求"跟上面 SVG 一样的入场动效")：
//     · 同样的 easing     —— smooth() (smootherstep)，与 path 的 intro 同一个函数
//     · 同样的时长        —— 1800ms
//     · 同样的解模糊幅度   —— blur(52px → 0)，这是那"从糊里浮出来"的观感本体
//     · 同样没有位移       —— SVG 的 transform 只由指针悬停驱动，入场阶段是 0；副标也不做上浮
//   唯一的差别 = 没有逐字间距(那是业主明确要求的)。
//   起手点 BYLINE_INTRO_START_MS = 1080：PORTFOLIO 的 9 个 path 占 0~960ms 的 delay，
//   1080 正是第 10 个位置(= welcome 首字)的时刻 —— 也就是**上面最后一个大写字母刚起步入场时，
//   FOUR DESIGN 整行就同时跟着入场**，与上面重叠收尾，不会"等上面全入场完才出现"。
const BYLINE_INTRO_START_MS = 1080;   // = welcome 首字时刻；整行同一刻起手
const BYLINE_CHAR_DURATION_MS = 1800; // 与 PORTFOLIO 淡入时长完全一致
const HERO_INTRO_BLUR_PX = 52;        // 与 PORTFOLIO 解模糊幅度完全一致(入场观感的本体)
const BYLINE_TEXT = 'Four Design';
import figmaIcon from './assets/profile/figma.webp';
import comfyuiIcon from './assets/profile/comfyui.webp';
import blenderIcon from './assets/profile/blender.webp';
import codexIcon from './assets/profile/codex.webp';
import photoshopIcon from './assets/profile/photoshop.webp';
import pcPortraitBg from './assets/profile/pc-portrait-bg.webp';
/* 2026-10-05: 移动端个人信息页专用竖版形象照(1080 宽 webp,32KB)。
   移动/PC 是两张不同的照片 —— PC 继续用 pc-portrait-bg,不要共用。 */
import mobPortraitBg from './assets/profile/mob-portrait-bg.webp';
import expYearsIcon from './assets/profile/exp-years.svg';
import expToolsIcon from './assets/profile/exp-tools.svg';
import expCasesIcon from './assets/profile/exp-cases.svg';
import BorderGlow from './components/BorderGlow';
import SideRays from './components/SideRays';
import { DETAIL_SCROLLS } from './data/detailScrolls';

const tools = [
  { name: 'Figma', icon: figmaIcon },
  { name: 'Comfyui', icon: comfyuiIcon },
  { name: 'Blender', icon: blenderIcon },
  { name: 'Codex', icon: codexIcon },
  { name: 'Photoshop', icon: photoshopIcon }
];

/* PC personal-info screen (2026-09-30 redesign). Hovering a tool swaps the
   stats/contact block for a description card and collapses the row into an
   accordion — the reference is 技能展示.jpg. Descriptions below were drafted
   from the mock copy for Figma; the others follow the same tone. */
const PC_SKILLS = [
  {
    id: 'figma', name: 'Figma', icon: figmaIcon, title: 'UI Design',
    text: '使用 Figma 进行 UI/UX 设计、组件化设计系统搭建与交互原型制作，具备开发思维了解组件复用、自适应、状态闭环等概念，熟悉 Auto Layout、Variants、Variables，能高效完成从设计到开发的交付。'
  },
  {
    id: 'comfyui', name: 'Comfyui', icon: comfyuiIcon, title: 'AIGC Workflow',
    text: '熟悉 ComfyUI 节点式工作流搭建，能独立完成模型加载、LoRA 微调、ControlNet 条件控制与高清放大等流程，把 AI 生成能力稳定嵌入日常设计生产链。'
  },
  {
    id: 'blender', name: 'Blender', icon: blenderIcon, title: '3D Design',
    text: '掌握 Blender 建模、材质、灯光与渲染全流程，能完成产品可视化与三维动效制作，为品牌与界面提供更具空间感的表达。'
  },
  {
    id: 'codex', name: 'Codex', icon: codexIcon, title: 'AI Coding',
    text: '借助 Codex 等 AI 编程工具参与前端实现，理解组件结构与交付逻辑，让设计方案在开发环节被高效、高保真地还原。'
  },
  {
    id: 'photoshop', name: 'Photoshop', icon: photoshopIcon, title: 'Visual Design',
    text: '精通 Photoshop 图像处理与视觉合成，覆盖精修、调色、版式与物料延展，保障每一处视觉输出的完成度与一致性。'
  }
];

/* The three personal-experience stats. Hovering one swaps the contact block
   for a tab-style composite (个人信息-经验.jpg): the stat row returns as
   tabs docked on top of a wide description card — the mirror of the skill
   strip interaction below. */
const PC_STATS = [
  {
    id: 'years', value: '5+', label: 'Years Design', icon: expYearsIcon,
    text: '5年设计经验，横跨UI/UX、平面设计、3D建模与AIGC。擅长从用户视角构建清晰流畅的界面体验，以版式与视觉语言传递内容情绪，具备从概念到落地的完整执行能力，持续探索技术与设计的融合，让创意更自由地实现。'
  },
  {
    id: 'tools', value: '10+', label: 'Design Tool', icon: expToolsIcon,
    text: '十余项专业软件掌握，具备较强学习能力与跨领域能力，近年来持续探索AIGC与设计工作流的结合，让技术成为创意的加速器。以稳定的专业输出和跨领域的适应力，持续为品牌创造价值。'
  },
  {
    id: 'cases', value: '50+', label: 'Work Case', icon: expCasesIcon,
    text: '多项完整商业项目经验，曾为多家企业提供年度设计支持，在长期合作中保持稳定输出，成为品牌设计环节中可信赖的长期伙伴。'
  }
];

const categories = [
  { id: 'ui', title: 'UI Design', cn: 'UI 设计', label: 'Product Interface' },
  { id: 'vi', title: 'VI Design', cn: 'VI 设计', label: 'Brand Visual' },
  { id: '3d', title: '3D Design', cn: '3D 设计', label: 'Spatial / Motion' },
  { id: 'aigc', title: 'AIGC', cn: 'AIGC', label: 'AI Creative' }
];


// Covers are exported per aspect ratio by .workbuddy/tools/build-cover-set.py
// (q85 WebP from the 封面合集 material; the long-scroll gallery itself is served by
// DETAIL_SCROLLS, so no work needs a hand-picked image set).
//
// Three ratios, three different card slots — the CSS aspect-ratio is the contract,
// and object-fit:cover would silently re-crop a mismatched source:
//
//   cover43  4:3   PC 首页卡组 .showcase-deck-card + 移动端缩览图 .mob-thumb
//   detailHero 16:9 PC 二级主卡 / 二级列表缩览 / 地面倒影 + 详情页 hero
//   image    3:5   移动端一级卡组主卡·副卡 + 移动端二级轨道卡 .mw-card
//
// ⚠ 移动端一级与二级必须共用 image(3:5):跨级转场是**同一张卡面**在飞,
//   两端比例不同会让卡片在交接瞬间换形(见 WorksPage 的跨级转场注释)。
const worksByCategory = {
  ui: [
    {
      id: 'coomo-home-mini',
      title: 'COOMO LIFE',
      subtitle: '家居产品小程序',
      cover43: '/detail/coomo-home-mini/v1/cover-43.webp',
      image: '/detail/coomo-home-mini/v1/cover-portrait.webp',
      detailHero: '/detail/coomo-home-mini/v1/cover.webp'
    },
    {
      id: 'smart-home-platform',
      title: 'COOMO LINK',
      subtitle: '智能家居中控',
      cover43: '/detail/smart-home-platform/v1/cover-43.webp',
      image: '/detail/smart-home-platform/v1/cover-portrait.webp',
      detailHero: '/detail/smart-home-platform/v1/cover.webp'
    },
    {
      id: 'coomo-official',
      title: 'COOMO官网',
      subtitle: '家居官方网站',
      cover43: '/detail/coomo-official/v1/cover-43.webp',
      image: '/detail/coomo-official/v1/cover-portrait.webp',
      detailHero: '/detail/coomo-official/v1/cover.webp'
    },
    {
      id: 'muguan-official',
      title: 'MORGAN官网',
      subtitle: '家居官方网站',
      cover43: '/detail/muguan-official/v1/cover-43.webp',
      image: '/detail/muguan-official/v1/cover-portrait.webp',
      detailHero: '/detail/muguan-official/v1/cover.webp'
    }
  ],
  vi: [
    {
      id: 'brand-summer',
      title: 'Mieye品牌设计',
      subtitle: '咖啡品牌设计',
      cover43: '/detail/brand-summer/v1/cover-43.webp',
      image: '/detail/brand-summer/v1/cover-portrait.webp',
      detailHero: '/detail/brand-summer/v1/cover.webp'
    },
    {
      id: 'campaign-visual',
      title: '平面视觉设计',
      subtitle: '商业活动视觉',
      cover43: '/detail/campaign-visual/v1/cover-43.webp',
      image: '/detail/campaign-visual/v1/cover-portrait.webp',
      detailHero: '/detail/campaign-visual/v1/cover.webp'
    },
    {
      id: 'packaging-system',
      title: '品牌运营设计',
      subtitle: '海报视觉设计',
      cover43: '/detail/packaging-system/v1/cover-43.webp',
      image: '/detail/packaging-system/v1/cover-portrait.webp',
      detailHero: '/detail/packaging-system/v1/cover.webp'
    }
  ],
  '3d': [
    {
      id: 'future-chair',
      title: '3D Design',
      subtitle: '产品三维渲染',
      cover43: '/detail/future-chair/v1/cover-43.webp',
      image: '/detail/future-chair/v1/cover-portrait.webp',
      detailHero: '/detail/future-chair/v1/cover.webp'
    }
  ],
  aigc: [
    {
      id: 'ai-poster-lab',
      title: 'AIGC工作流',
      subtitle: 'ComfyUI商业应用',
      cover43: '/detail/ai-poster-lab/v1/cover-43.webp',
      image: '/detail/ai-poster-lab/v1/cover-portrait.webp',
      detailHero: '/detail/ai-poster-lab/v1/cover.webp'
    },
    {
      id: 'aigc-model',
      title: 'AI Model',
      subtitle: 'AI模特一致性',
      cover43: '/detail/aigc-model/v1/cover-43.webp',
      image: '/detail/aigc-model/v1/cover-portrait.webp',
      detailHero: '/detail/aigc-model/v1/cover.webp'
    },
    {
      id: 'aigc-style',
      title: 'AIGC QQ',
      subtitle: '吉祥物IP',
      cover43: '/detail/aigc-style/v1/cover-43.webp',
      image: '/detail/aigc-style/v1/cover-portrait.webp',
      detailHero: '/detail/aigc-style/v1/cover.webp'
    }
  ]
};

/* 移动端「项目轨道」的唯一数据源(2026-10-07 打通一级/二级)。
   顺序 = 导航分类顺序(ui → vi → 3d → aigc),与首页卡组的 mobileWorksItems
   逐一对应(同一批卡、同一个顺序)。一级和二级必须是同一张卡,前提就是两级
   渲染的是同一个列表 —— 任何一处顺序不同,跨级飞行的落点就会换人。
   category 字段补进每一项,这样「主卡滑到谁」就能直接推出上方导航该高亮谁。 */
const WORKS_RAIL = Object.entries(worksByCategory).flatMap(([category, list]) =>
  list.filter((work) => work.id !== 'motion-space').map((work) => ({ ...work, category }))
);
/* 闭环轮回:轨道渲染两份副本,当前索引始终待在允许区间内,越界时整轨瞬移一份。
   瞬移前后可见窗口里的卡与位置逐像素相同(同一批卡的同一批顺序),所以看不见。
   11 = WORKS_RAIL.length,写成常量以便算窗口边界。
   ⚠ 2026-10-09(项4):副本数 3 → 2。三份 = 33 个节点,**一次性挂载**的样式重算 +
      布局实测就是跨级转场里最贵的那一块(4× 手机降速下「样式/布局」自耗稳定在
      500ms 上下,占该阶段一半以上)。两份仍然满足下面那个前提:任何允许停留的位置
      ±RAIL_WINDOW 都落在数组范围内(见 RAIL_LO / RAIL_HI)。 */
const RAIL_N = WORKS_RAIL.length;
const RAIL_COPIES = 2;
const RAIL_SLIDES = [...WORKS_RAIL, ...WORKS_RAIL];

/* ── 作品图片总清单：首屏 loading 的**唯一**数据来源（2026-10-13 业主口径）─────────
   业主原话：「一级页面的作品封面和二级页面的作品封面都要进 loading 一同加载；
   以后我在同一位置替换了图，不用重新告诉你这些图要进加载任务；加了新的加载内容，
   进度和加载时间也要跟着变，不能还按旧任务量算。」
   所以这里**不写死一张张图，而是扫数据**：
     · worksByCategory 里每个作品对象的**所有字符串字段**，凡是站内图片路径
       （/ 开头 + 图片后缀）都算 ⇒ 以后新增字段（新比例、新详情图）、新增作品、
       把一个字段换成另一张图，都会自动进入 loading，不需要改这段代码；
     · 再加「详情页首屏那一块」= 每件作品长图的第一块 tile（按设备选宽度：视口
       ≤1100px 用 @714 版，与 ScrollTile 的 sizes 断点一致 —— 预载的必须和真页面
       会请求的是同一个文件，否则白下一份）。
   长图其余 tile（单作品 19 块 / 桌面 ~2MB）**故意不进 loading**：那是滚动才看的，
   而且 ScrollTile 自带 LQIP 模糊占位，进去不会白屏。
   下面的 IMAGE_FIELD_PRIORITY 只管**先下哪张**（排序），不影响成员资格 ——
   漏写在这里的字段照样进 loading，只是排在后面。 */
const IMG_PATH_RE = /^\/.*\.(?:webp|jpe?g|png|avif|gif)$/i;
/* 详情页长图 tile 的两个宽度版本，浏览器是**按 srcSet 规则自己挑**的：
   ScrollTile 的 sizes =「≤1100px 视口 → calc(100vw - 36px)，否则 min(1470px, 100vw - 220px)」，
   候选 714w / 1470w，挑"不小于 槽宽 × DPR 的最小候选"。
   ⇒ 393px 视口 + DPR 3 的手机：槽宽 357css → 要 1071 设备像素 → 浏览器挑的是
     **1470w（桌面版）**，不是 @714。预载错版本 = 白下一份、真页面还得再下一份。
   这里严格照同一套规则算，保证预载的就是页面会请求的那一个。 */
function scrollTileVariant() {
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1440;
  const slotCss = vw <= 1100
    ? Math.max(1, vw - 36)
    : Math.min(DETAIL_SCROLLS.desktopWidth, vw - 220);
  return slotCss * dpr <= DETAIL_SCROLLS.mobileWidth ? '@714' : '';
}
/* 本机马上就会显示的两套比例（进 loading，参与揭幕）；剩下那套是**换设备/跨断点**
   才会用到的（PC 上的 3:5、手机上的 16:9），历史上一律是不参与闸门的后台预热 ——
   一次 660~730KB，卡在启动路径上纯属浪费。新出现的未知字段归到「本机」这一侧：
   宁可多等一点，也不能让新内容被漏算（业主 2026-10-13 口径）。 */
const DEVICE_FIELDS = { mobile: ['image', 'cover43'], pc: ['cover43', 'detailHero'] };
const CROSS_FIELDS = { mobile: ['detailHero'], pc: ['image'] };
function worksImageInventory(isMobile) {
  const key = isMobile ? 'mobile' : 'pc';
  const order = DEVICE_FIELDS[key];
  const crossOrder = CROSS_FIELDS[key];
  const buckets = new Map(order.map((field) => [field, []]));
  const crossBuckets = new Map(crossOrder.map((field) => [field, []]));
  const extra = [];
  const seen = new Set();
  const push = (bucket, src) => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    bucket.push(src);
  };
  Object.values(worksByCategory).forEach((list) => list.forEach((work) => {
    Object.entries(work).forEach(([field, value]) => {
      if (typeof value !== 'string' || !IMG_PATH_RE.test(value)) return;
      push(buckets.get(field) || crossBuckets.get(field) || extra, value);
    });
  }));
  const tiles = [];
  const variant = scrollTileVariant();
  Object.entries(DETAIL_SCROLLS.works).forEach(([workId, work]) => {
    const scroll = work && work.scrolls && work.scrolls[0];
    const tile = scroll && scroll.tiles && scroll.tiles[0];
    if (!tile) return;
    const base = `/detail/${workId}/${scroll.slug}/tile-${String(tile.i).padStart(3, '0')}`;
    push(tiles, `${base}${variant}.webp`);
  });
  return {
    covers: [...order.flatMap((field) => buckets.get(field)), ...extra],
    cross: crossOrder.flatMap((field) => crossBuckets.get(field)),
    tiles,
  };
}
const RAIL_HOME = RAIL_N;        // 初始落点 = 第二份的第一张
/* 「活跃窗口」(2026-10-07 性能):只有距当前索引 ±RAIL_WINDOW 的卡参与绘制
   (data-far → visibility:hidden),再远的整份副本既不渲染也不解码图片。
   ⚠ 为什么必须这么做:入场初始姿态要求「源卡尺寸」的每张卡都缩到主卡位置上,
     于是 33 张卡在同一矩形里叠成一摞 —— 浏览器得把这一摞**全部**画出来
     (每张都带大圆角 + 56px 投影 + 蒙版渐变 + 圆角裁剪的位图)。实测这一个
     绘制任务就把主线程堵了 60~200ms,正好卡在动画起跑那一帧,读起来就是
     「点了没反应,然后突然张开」。去掉投影/滤镜/蒙版任一项只能省一部分,
     33 → 9 才是量级上的解法(2026-10-09 再往下压一档:副本 3→2、窗口 ±4→±2,
     同时参与绘制的只剩 5 张)。
   为什么不会露馅:窗口边缘(±2)距中心 2×270px ≈ 541px,视口半宽才 196px,
     所以卡「进入窗口」这件事永远发生在屏外;而入场那一摞里,窗口外的副本
     本来就被主卡(z-index 2)完整盖住,隐藏它们没有任何视觉差别。 */
const RAIL_WINDOW = 2;
/* 允许停留的索引区间:必须保证 pos ± RAIL_WINDOW 都落在 [0, slides-1] 内。
   越界那一帧会读到不存在的槽位 —— 那些位置虽然落在屏外看不见,但状态机不该依赖它。 */
const RAIL_LO = RAIL_WINDOW;
const RAIL_HI = RAIL_N * RAIL_COPIES - 1 - RAIL_WINDOW;
/* 跨级转场时长:入场(从源卡姿态张开到静止)与离场(收拢回首页那张卡)同值。
   必须与 .mw-entering/.mw-leaving 的过渡时长一致,否则主卡与副卡会分家。 */
const RAIL_EMERGE_MS = 700;
const RAIL_LEAVE_MS = 560;

/* 2026-10-08:首页卡组从 7 张扩到 11 张(全部作品直接上首页,不再只挑精选)。
   ⚠ 排版铁律:**错落,不是扇形**。
   - left 等距铺开(步长 7.0%,卡宽 15.9% ⇒ 每张露出约 44%,右侧被后一张压住);
   - rot 是**不规则**的小角度(在 ±2.3° 内正负交替、不单调递增),绝不能从
     负值线性扫到正值 —— 那样整排会读成一个扇形,和现版的"随手错落"完全两回事;
   - restY 是几像素的上下错动,配合 rot 制造参差;
   - z 从左到右递增 ⇒ 右侧卡压住左侧卡,hover 时把当前卡提到最上层并左右推开。
   每张卡在地面各有一份倒影(见 ShowcaseDeck)。

   2026-10-08 二次调整:卡整体等比放大 30%(12.2% → 15.9%),步长同时收窄
   (7.4% → 7.0%)把相邻卡拉近,首卡 left 由居中公式给出:
     START_X = (100 - 10*STEP_X - CARD_W) / 2
   卡内文字同步缩小(见 .showcase-deck-copy),避免标题顶到卡右缘。

   2026-10-08 三次调整:7.0% 的步长相邻卡叠得太死(每张只露出 44%),步长放宽到
   8.2%(每张露出约 52%),START_X 由同一公式自动算成 1.05 —— 整排几乎铺满 deck
   宽度,deck 自身在 .project-list 里还有 72px 视口边距,所以不会顶到屏幕边。 */
const DECK_STEP_X = 8.2;     // 相邻卡 left 步长(%)，加大 = 相邻卡左右拉开、每张露出更多
const DECK_CARD_W = 17.5;    // 与 styles.css 的 .showcase-deck-card width 必须同值
const DECK_START_X = (100 - DECK_STEP_X * 10 - DECK_CARD_W) / 2;  // = 0.25，左右留白对称
const projectShowcases = [
  {
    id: 'coomo-home-mini',
    category: 'ui',
    work: 0,
    index: '01',
    title: 'COOMO LIFE',
    meta: '家居产品小程序',
    description: '以简洁界面与流畅购物流程重构家居线上体验，平衡品牌调性与转化效率。',
    deck: { left: DECK_START_X + DECK_STEP_X * 0, rot: -2.3, restY: 8, z: 1 }
  },
  {
    id: 'smart-home-platform',
    category: 'ui',
    work: 1,
    index: '02',
    title: 'COOMO LINK',
    meta: '智能家居中控',
    description: '将多设备控制与场景联动整合为直观的可视化系统，降低用户决策成本。',
    deck: { left: DECK_START_X + DECK_STEP_X * 1, rot: -0.8, restY: -2, z: 2 }
  },
  {
    id: 'coomo-official',
    category: 'ui',
    work: 2,
    index: '03',
    title: 'COOMO官网',
    meta: '家居官方网站',
    description: '在多种终端上保持品牌叙事的一致性与高级感，让内容成为视觉主角。',
    deck: { left: DECK_START_X + DECK_STEP_X * 2, rot: -1.9, restY: 3, z: 3 }
  },
  {
    id: 'muguan-official',
    category: 'ui',
    work: 3,
    index: '04',
    title: 'MORGAN官网',
    meta: '家居官方网站',
    description: '以沉稳的排版与材质感呈现家具品牌调性，让产品在页面中成为主角。',
    deck: { left: DECK_START_X + DECK_STEP_X * 3, rot: -0.4, restY: -4, z: 4 }
  },
  {
    id: 'brand-summer',
    category: 'vi',
    work: 0,
    index: '05',
    title: 'Mieye品牌设计',
    meta: '咖啡品牌设计',
    description: '以统一的图形语言与色彩体系传递品牌核心价值，建立可识别的视觉资产。',
    deck: { left: DECK_START_X + DECK_STEP_X * 4, rot: 1.2, restY: -5, z: 5 }
  },
  {
    id: 'campaign-visual',
    category: 'vi',
    work: 1,
    index: '06',
    title: '平面视觉设计',
    meta: '商业活动视觉',
    description: '围绕主题构建具有冲击力与记忆点的传播画面，让信息在第一眼被捕捉。',
    deck: { left: DECK_START_X + DECK_STEP_X * 5, rot: -1.0, restY: 1, z: 6 }
  },
  {
    id: 'packaging-system',
    category: 'vi',
    work: 2,
    index: '07',
    title: '品牌运营设计',
    meta: '海报视觉设计',
    description: '把高频运营需求沉淀成可复用的版式与图形规则，让产出既快又稳。',
    deck: { left: DECK_START_X + DECK_STEP_X * 6, rot: 0.6, restY: -3, z: 7 }
  },
  {
    id: 'future-chair',
    category: '3d',
    work: 0,
    index: '08',
    title: '3D Design',
    meta: '产品三维渲染',
    description: '用光影与材质塑造真实可信的商品视觉表达，强化产品的高级感与细节张力。',
    deck: { left: DECK_START_X + DECK_STEP_X * 7, rot: -1.6, restY: 7, z: 8 }
  },
  {
    id: 'ai-poster-lab',
    category: 'aigc',
    work: 0,
    index: '09',
    title: 'AIGC工作流',
    meta: 'ComfyUI商业应用',
    description: '把 AI 能力固化为可复用的视觉生产管线，让创意探索从随机走向可控。',
    deck: { left: DECK_START_X + DECK_STEP_X * 8, rot: 1.4, restY: -1, z: 9 }
  },
  {
    id: 'aigc-model',
    category: 'aigc',
    work: 1,
    index: '10',
    title: 'AI Model',
    meta: 'AI模特一致性',
    description: '用同一套条件控制锁住人物特征，让批量生成在不同场景下仍是同一个人。',
    deck: { left: DECK_START_X + DECK_STEP_X * 9, rot: 0.3, restY: 4, z: 10 }
  },
  {
    id: 'aigc-style',
    category: 'aigc',
    work: 2,
    index: '11',
    title: 'AIGC QQ',
    meta: '吉祥物IP',
    description: '为品牌角色建立可延展的表情与姿态库，让 IP 在各类物料中保持同一性格。',
    deck: { left: DECK_START_X + DECK_STEP_X * 10, rot: 1.8, restY: 2, z: 11 }
  }
];


const heroSignals = [
  { id: 'interface', index: '01', title: 'Interface', cn: 'UI 系统', meta: 'Product / Interaction' },
  { id: 'visual', index: '02', title: 'Visual', cn: '视觉语言', meta: 'Brand / Campaign' },
  { id: 'ai', index: '03', title: 'AI Flow', cn: 'AI 工作流', meta: 'ComfyUI / Codex' },
  { id: 'motion', index: '04', title: 'Motion', cn: '动态与三维', meta: '3D / Render' }
];

/* HIDDEN_HERO_FOUR_LOGO_ARCHIVE_START
   Original FOUR Logo artwork and pointer-driven interaction.
   This archive is intentionally not rendered by the live HERO. Keep this
   marker stable so the effect can be restored later without rediscovering it.
*/
const fourLetterPaths = {
  f: [
    'M1.59209e-07 0H138V14H1.59209e-07V0Z',
    'M33 95H113V109H33V95Z',
    'M14 0L14 200H0L1.59209e-07 0H14Z'
  ],
  o: [
    'M256.732 0C311.618 0.000100937 356.112 44.4939 356.112 99.3799C356.112 154.252 311.641 198.736 256.774 198.759V184.356C303.686 184.334 341.708 146.297 341.708 99.3799C341.708 52.4484 303.663 14.4034 256.732 14.4033C209.8 14.4033 171.754 52.4484 171.754 99.3799C171.754 100.241 171.769 101.099 171.794 101.954H157.384C157.363 101.099 157.352 100.241 157.352 99.3799C157.352 44.4939 201.846 0 256.732 0Z'
  ],
  u: [
    'M399.403 0.360046V125.485C399.403 154.572 420.369 178.761 448.013 183.766V198.358C412.379 193.21 385 162.545 385 125.485V0.360046H399.403Z',
    'M532.27 0.360046V125.485C532.27 162.42 505.075 193.002 469.617 198.304V183.699C497.083 178.549 517.866 154.445 517.866 125.485V0.360046H532.27Z'
  ],
  r: [
    'M642.09 14.7629C666.65 14.7629 686.559 34.6723 686.559 59.2318C686.559 83.7914 666.65 103.701 642.09 103.701H586.744L667.596 197.86H686.559L619 118.104H642.09C674.604 118.104 700.962 91.7458 700.962 59.2318C700.962 26.7178 674.604 0.360046 642.09 0.360046H569.281V14.7629H642.09Z'
  ]
};

/* The mark is inlined rather than loaded through <img src=...svg>.
   Why (2026-10-07): as an <img> the SVG is rasterised into its own composited
   layer, and on real phones the edges of that layer showed up as a 2px
   near-black rectangle wrapped around the whole wordmark (measured at exactly
   #101010, 2px wide, closed on all four sides, sitting ~2px outside the img
   box). Chromium's headless mode never reproduces it, and it survived every
   style-level fix (no border/outline/shadow paints it -- verified by dumping
   the paint properties of the button, the img and the capsule on both nav
   levels), which is why it looked like "nothing draws it". Inlining the same
   paths lets the logo paint into the nav's own layer, so there is no separate
   texture to fringe.

   The paths and the 701x200 viewBox are byte-identical to four-logo.svg, so
   the rendered geometry is unchanged: CSS still drives width/height, and the
   width/height transitions morph exactly as before. */
function LogoMark({ large = false }) {
  return (
    <svg
      className={large ? 'four-logo four-logo-large' : 'four-logo'}
      viewBox="0 0 701 200"
      width="701"
      height="200"
      /* xMidYMid meet = 按比例缩放并完整放入盒内,绝不裁切。
         盒比例一旦与 701:200 不符,多出来的部分变成对称留白而不是拉伸。 */
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="FOUR"
      focusable="false"
    >
      <path d="M399.403 0.360046V125.485C399.403 154.572 420.369 178.761 448.013 183.766V198.358C412.379 193.21 385 162.545 385 125.485V0.360046H399.403Z" fill="white" />
      <path d="M532.27 0.360046V125.485C532.27 162.42 505.075 193.002 469.617 198.304V183.699C497.083 178.549 517.866 154.445 517.866 125.485V0.360046H532.27Z" fill="white" />
      <path d="M642.09 14.7629C666.65 14.7629 686.559 34.6723 686.559 59.2318C686.559 83.7914 666.65 103.701 642.09 103.701H586.744L667.596 197.86H686.559L619 118.104H642.09C674.604 118.104 700.962 91.7458 700.962 59.2318C700.962 26.7178 674.604 0.360046 642.09 0.360046H569.281V14.7629H642.09Z" fill="white" />
      <path d="M256.732 0C311.618 0.000100937 356.112 44.4939 356.112 99.3799C356.112 154.252 311.641 198.736 256.774 198.759V184.356C303.686 184.334 341.708 146.297 341.708 99.3799C341.708 52.4484 303.663 14.4034 256.732 14.4033C209.8 14.4033 171.754 52.4484 171.754 99.3799C171.754 100.241 171.769 101.099 171.794 101.954H157.384C157.363 101.099 157.352 100.241 157.352 99.3799C157.352 44.4939 201.846 0 256.732 0Z" fill="white" />
      <path d="M1.59209e-07 0H138V14H1.59209e-07V0Z" fill="white" />
      <path d="M33 95H113V109H33V95Z" fill="white" />
      <path d="M14 0L14 200H0L1.59209e-07 0H14Z" fill="white" />
    </svg>
  );
}

// 设备形态只由 index.html 头部脚本判定一次(data-device),渲染期内不变
const isMobileDevice = () => document.documentElement.getAttribute('data-device') === 'mobile';

function parseRoute() {
  const hash = window.location.hash;
  if (hash.startsWith('#/detail')) {
    const params = new URLSearchParams(hash.split('?')[1] ?? '');
    return { page: 'detail', category: params.get('category') ?? 'ui', workId: params.get('work') ?? '' };
  }
  if (hash.startsWith('#/works')) {
    const params = new URLSearchParams(hash.split('?')[1] ?? '');
    // 2026-10-06: 移动端二级页改为单屏卡组,首页点卡进入时携带 work,
    // 让被点的项目直接成为当前卡(放大动效的落点)。
    return { page: 'works', category: params.get('category') ?? 'ui', workId: params.get('work') ?? '' };
  }
  return { page: 'home', category: 'ui', workId: '' };
}

// 2026-10-08: 三级页头图已删,顶部恒为纯黑 ⇒ 导航玻璃不再需要按 hero 亮度预判
// (predictDetailOnLight 已随之移除);滚动中的实时自适应仍由 useDetailNavOnLight 负责。

// 2026-10-05: 三级导航实时自适应亮背景。详情页滚动时导航条底下掠过的内容亮度
// 会变化(顶部 hero 暗、下滑大图可能很亮)。用 elementsFromPoint 探测导航带正下方
// 当前盖着的元素,图片用 canvas 采样真实像素估算平均亮度;超阈值给 body 挂
// .nav-on-light 让玻璃翻深色、保证白字可读。rAF 节流 + 滞回阈值防抖。
// 2026-10-07: PC 与移动端都生效。移动端此前被 early-return 跳过(导航是另一套
// 固定暗色),现在移动端二/三级导航已与 PC 统一为亮色玻璃,同样需要实时翻暗。
// 差异只有滚动容器:PC 走 window scroll,移动端详情页是 .work-detail-page 内滚。
function useDetailNavOnLight(isDetail) {
  useEffect(() => {
    if (!isDetail) {
      document.body.classList.remove('nav-on-light');
      return undefined;
    }

    const isMobile = document.documentElement.dataset.device === 'mobile';
    // 移动端滚动发生在这个层内(scrollHeight 远大于视口时);PC 走 window。
    const scrollHost = () => (isMobile ? document.querySelector('.work-detail-page') : null);

    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const LUMA_ON = 0.58;   // 平均亮度高于此 → 深色玻璃
    const LUMA_OFF = 0.46;  // 低于此 → 切回浅玻璃
    const COLS = 22;

    const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const getHeader = () => document.querySelector('.morph-nav.nav-detail');

    const sampleImage = (img, clientX, band) => {
      const rect = img.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh || !img.complete) return null;
      const fit = getComputedStyle(img).objectFit || 'fill';
      const scale = (fit === 'cover' || fit === 'none')
        ? Math.max(rect.width / nw, rect.height / nh)
        : Math.min(rect.width / nw, rect.height / nh);
      const cw = nw * scale, ch = nh * scale;
      const cx = rect.left + (rect.width - cw) / 2;
      const cy = rect.top + (rect.height - ch) / 2;
      const sx = ((clientX - cx) / cw) * nw;
      if (!(sx >= 0) || sx >= nw) return null;
      const sy0 = Math.max(0, ((band.top - cy) / ch) * nh);
      const sy1 = Math.min(nh, ((band.bottom - cy) / ch) * nh);
      if (sy1 - sy0 < 1) return null;
      try {
        ctx.clearRect(0, 0, 1, 1);
        ctx.drawImage(img, sx, sy0, 1, sy1 - sy0, 0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return luma(d[0], d[1], d[2]);
      } catch {
        return null;
      }
    };

    const estimateAt = (x, y, band, navEl) => {
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) {
        if (el === canvas || navEl.contains(el)) continue;
        if (el instanceof HTMLImageElement) {
          const v = sampleImage(el, x, band);
          if (v != null) return v;
          continue;
        }
        const bg = getComputedStyle(el).backgroundColor;
        const m = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/]\s*([\d.]+))?\)/.exec(bg || '');
        if (m) {
          const a = m[4] === undefined ? 1 : parseFloat(m[4]);
          if (a > 0.05) return luma(+m[1], +m[2], +m[3]) * a; // 混黑底
        }
      }
      return 0; // 页面底色黑
    };

    let onLight = false;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const navEl = getHeader();
      if (!navEl) return;
      const r = navEl.getBoundingClientRect();
      const band = {
        left: r.left + r.width * 0.02,
        right: r.left + r.width * 0.98,
        top: r.top + r.height * 0.28,
        bottom: r.top + r.height * 0.72,
      };
      let sum = 0;
      for (let i = 0; i < COLS; i++) {
        const x = band.left + (i + 0.5) * ((band.right - band.left) / COLS);
        sum += estimateAt(x, (band.top + band.bottom) / 2, band, navEl);
      }
      const avg = sum / COLS;
      const next = onLight ? avg < LUMA_OFF : avg > LUMA_ON;
      if (next) {
        onLight = !onLight;
        document.body.classList.toggle('nav-on-light', onLight);
      }
    };

    let scrollStopTimer = 0;
    const onScroll = () => {
      // 滚动过程中不做逐帧采样：measure 内含 22 次 drawImage+getImageData，
      // 每帧强制大图同步回读，是三级页滚动卡顿的主因。改为滚动停止 ~160ms 后
      // 采一次——导航条是固定的，视觉无差，主线程立即释放。
      if (scrollStopTimer) window.clearTimeout(scrollStopTimer);
      scrollStopTimer = window.setTimeout(() => {
        if (frame) return;
        frame = window.requestAnimationFrame(measure);
      }, 160);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('load', onScroll, true);
    // 移动端详情页内滚:滚动事件不冒泡到 window,必须挂在内滚层上。
    const host = scrollHost();
    if (host) host.addEventListener('scroll', onScroll, { passive: true });

    // 入场 + 大图懒加载分批到位,延迟复采几次
    const timers = [0, 350, 900, 1800].map((t) => window.setTimeout(measure, t));

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('load', onScroll, true);
      if (host) host.removeEventListener('scroll', onScroll);
      timers.forEach((t) => window.clearTimeout(t));
      if (scrollStopTimer) window.clearTimeout(scrollStopTimer);
      if (frame) window.cancelAnimationFrame(frame);
      document.body.classList.remove('nav-on-light');
    };
  }, [isDetail]);
}

/* PC 二级页离场（回一级）的挂载时长：卡片反向坠下 340ms + 反向错峰 120ms
   = 460ms，底衬溶解到 500ms，这里留 60ms 余量。到点才把二级层卸下。
   时间轴写在这里、动画时长写在 styles.css 的 .orbit-fall 规则里，
   两边改动要同步（差值只影响"最后会不会截到动画尾巴"）。 */
const PC_WORKS_EXIT_MS = 560;

function App() {
  const [route, setRoute] = useState(parseRoute);
  const [homeActiveSection, setHomeActiveSection] = useState('hero');
  const [homeScrollY, setHomeScrollY] = useState(() => Number(window.sessionStorage.getItem('portfolioHomeScrollY') ?? 0));
  const [worksScrollY, setWorksScrollY] = useState(() => Number(window.sessionStorage.getItem('portfolioWorksScrollY') ?? 0));
  const paging = usePagingEnabled(route.page === 'home');
  const [navMotion, setNavMotion] = useState('');
  const [sharedPill, setSharedPill] = useState(null);
  const [worksActiveLocked, setWorksActiveLocked] = useState(false);
  const previousPageRef = useRef(route.page);
  /* 供延时回调读取"此刻真正生效的路由"(不重建闭包就能判"这次恢复还有没有效")。 */
  const routeRef = useRef(route);
  routeRef.current = route;
  /* 2026-10-06 移动端二级/三级交互合并:
     - mobileFlip = 'enter' 详情页正从顶部下滑翻入(works 保持在底下可见)
                  = 'cover' 详情页已落定(works 隐藏但保持挂载)
                  = 'exit'  详情页整体上滑翻回 works(不重置内滚)
     - exitDetail 保存退出翻页期间的 {category, work},防止 route 先切回 works
       时 WorkDetailPage 拿到错误的 work 而闪帧。 */
  const [mobileFlip, setMobileFlip] = useState(null);
  const [exitDetail, setExitDetail] = useState(null);
  /* 2026-10-07 移动端跨级转场改为「轨道自己执行」,不再用裸露 img 覆盖层:
     - worksEntry:一级点卡进二级时把**源卡矩形**交给二级轨道,轨道据此把主卡
       先摆到源卡位置(同位置、同尺寸),再与副卡同帧张开。
     - exitWorks:二级返回一级时让二级页**保持挂载**到收拢动画结束 —— 收拢动作
       由二级轨道自己在原地做(缩回首页那张卡),结束后才卸下。 */
  const [worksEntry, setWorksEntry] = useState(null);
  const [exitWorks, setExitWorks] = useState(false);
  /* 2026-10-08 第八轮 PC 离场:一级↔二级在 PC 上是同一批 orbit 卡面,业主要求
     离场走与入场相反的一套动效(卡片反向坠下淡出)。移动端用 exitWorks 让二级页
     在原地收拢;**PC 单独用一个 pcWorksExit**,不复用 exitWorks —— 后者会顺带
     翻动 HomePage 的 revealProjects / deckVeiled(移动端语义),PC 上没必要动它们。
     期间二级层浮到首页之上(fixed, z-index 30),路由与导航立刻切回一级,
     等坠下动画演完再卸层。 */
  const [pcWorksExit, setPcWorksExit] = useState(false);
  const pcWorksExitTimerRef = useRef(null);
  const [deckFocusId, setDeckFocusId] = useState('');
  /* 2026-10-07 业主第四轮:一级页「其余元素」(Project Display 标题 / 计数器 /
     圆点 / 查看全部 / 缩略图条)在跨级时必须有自己的入场 / 离场动效。
     两条机制:
       chromeHidden = 这些元素退场(隐藏姿态)。去程点卡时立刻置 true → 它们先
                      退场,再交出屏幕;回程收拢结束后置 false → 它们升回来。
       homeHandoff  = 去程期间**暂缓隐藏一级页**:一级层要留在场上,其余元素才
                      有地方演退场。退场演完(≈340ms)再撤,一级层随之隐藏。
                      (works 层的不透明底同时淡入,所以这 340ms 里看得见退场。) */
  const [chromeHidden, setChromeHidden] = useState(false);
  /* 2026-10-07 第五轮:回程「其余元素」的入场改用 **CSS animation**(is-chrome-in)。
     之前用「摘掉 is-chrome-out + transition」驱动,但一级层在二级页期间是
     display:none —— 从 display:none 里出来的元素没有"上一次的计算值"可供
     过渡,浏览器直接从新值起画;延时两帧再摘类则要赌 rAF 与 React 提交的
     相对顺序,探针实测两种时序都会出现,其中一种就是 0→1 一帧硬切。
     animation 自带 from 关键帧,不依赖任何历史计算值,机制上不存在竞态。 */
  const [chromeIn, setChromeIn] = useState(false);
  const [homeHandoff, setHomeHandoff] = useState(false);
  const chromeTimerRef = useRef(0);
  const chromeInTimerRef = useRef(0);
  /* ✗ 2026-10-10 已停用：业主第 2 条"转场期间禁止操作屏幕"的**遮罩方案失败**。
     两种实现（React state 挂载 / 纯 DOM 直接挂载）都让逐帧探针的 hero 帧
     从 2 帧涨到 16~17 帧（**每一轮转场都闪**）。机理：在 body 上插入/移除全屏
     节点会在关键时刻触发布局失效，把 App 自己的"隐藏一级层 / 复位滚动"挤到
     另一次提交，正好制造出"一级层仍可见 + 滚动已为 0"的那一帧。
     按纪律停用（可测指标变差的改动不上）。正确的做法下一轮改走**手势处理器**
     这一层：一级卡组/导航的指针与触摸回调里加同一个 `window.__worksMorphUntil`
     判定，完全不碰 DOM 结构与时序 —— 与已有的翻页锁同一机制。 */
  const armMorphGuard = () => {};
  const disarmMorphGuard = () => {};
  /* ★ 2026-10-10 业主第 2 条（正确做法）：转场期间禁止操作 —— 走**处理器**这一层，
     不碰 DOM 结构、不碰渲染时序。转场起跑时置位 `window.__worksMorphUntil`
     （goWorks / goHome），转场真正结束（onEntryArmed / onLeavingDone）清零。
     任何"会引发新转场/翻页"的入口先问一句 morphLocked()。 */
  const morphLocked = () => performance.now() < (window.__worksMorphUntil || 0);
  /* ★ 2026-10-10「进二级页闪一帧 hero」的取证（业主反馈:来回切换时很快闪过一个
     接近 hero 的画面）。逐帧探针 outputs/perf-reveal/flash-hunt.mjs 实测:
     移动端点卡进二级时，一级层按设计留在场上演 620ms 的元素退场，而这 620ms 里
     文档高度会塌、窗口滚动被浏览器钳回 0 —— **仍在场的一级层当帧跳回首屏 hero**，
     连续 2 帧、间隔 9ms（肉眼就是"闪一下"）。修法与结论写在 goWorks 里。 */
  /* 回程滚动复位(2026-10-07 业主第五轮):一级层是 display:none 隐藏的,隐藏
     期间文档高度塌掉、窗口滚动被浏览器钳回 0;路由切回 home 的同一提交里
     一级层重新可见,若此刻还停在 0,用户会看到首屏 hero 闪一帧再跳回原屏。
     useLayoutEffect 在提交后、绘制前同步滚回,连一帧都不会露。

     ⚠ 2026-10-10 复测:上面这句"连一帧都不会露"**没有完全做到**。业主反馈
     "来回切换时很快闪过一个接近 hero 的画面";逐帧探针
     (outputs/perf-reveal/flash-hunt.mjs,判据:一级层已可见 + 窗口 scrollY≈0
     而用户原本停在 1697)稳定量到 **2 帧**(约 12~17ms),实测时序:
       t+0     一级层 display:none, document 高 852(只有二级页那么高)
       t+11ms  一级层恢复 block      但 scrollY 仍是 0 ⇒ **这一帧画的就是 hero**
       t+17ms  scrollY 才回到 1697
     根因:写入发生在"一级层刚从 display:none 出来、浏览器还没重算布局"的那一刻,
     文档高度还是旧的 → scrollTo 被钳成 0。已验证**"补写"这条路走不通**:
       · rAF 里逐帧重申 window.scrollY → 钳位发生在 rAF 之后的布局阶段,每次被覆盖;
       · 写入后强制重排再写(最多 3 次)→ 计数仍是 1~2 帧;
       · 改成"反复重申直到落位"(最多 12 帧)→ 揭示正好落在两次 rAF 之间,第一帧
         仍会漏;而且这版还有真实风险:用户回程后立刻滑动会被拽回最长 200ms,已撤。
     结论:唯一稳的修法是**别让文档在隐藏期间塌到装不下这个偏移**(即一级层隐藏时
     保留其高度 / 给文档一个不小于 saved+视口的最小高度),这样浏览器根本没有机会
     把它钳成 0,揭示那一帧天然就是对的。属于结构性改动,待业主拍板后再动。 */
  const pendingHomeScrollRef = useRef(null);
  useLayoutEffect(() => {
    if (route.page !== 'home' || pendingHomeScrollRef.current === null) return undefined;
    const y = pendingHomeScrollRef.current;
    pendingHomeScrollRef.current = null;
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    return undefined;
  }, [route.page]);
  /* ★ 2026-10-10（业主拍板）「一级↔二级来回切换闪一帧 hero」的结构性修法。

     取证见 outputs/perf-reveal/flash-hunt.mjs：回程时一级层刚从 display:none 出来、
     浏览器还没重算布局，文档仍只有"二级页那么高"，于是"回到用户原位置"的写入被钳成 0
     —— 揭示那一帧画的就是首屏 hero，稳定 2 帧（约 12~17ms）。三种"事后补写"都被钳位
     打败（都撤了，见上面 useLayoutEffect 的注释）。

     所以改治源头：**一级层隐藏期间，把它的高度占回来**（body 给一个不小于
     「用户原位置 + 一屏高」的最小高度），浏览器就没有机会把滚动位置清零；
     等回程揭示时位置本来就是对的，不需要任何补写。

     同时**锁掉根节点滚动**：二级层是 position:fixed、有自己的滚动容器，不依赖窗口滚动；
     但文档被垫高之后，在二级页上拖动有可能把背后（不可见的）一级页滚走，所以锁住。
     只作用于移动端的二级页（PC 的二级页走文档滚动，不动），且两步都在绘制前完成。 */
  useLayoutEffect(() => {
    if (!isMobileDevice() || route.page !== 'works' || homeHandoff) return undefined;
    const body = document.body;
    const saved = Math.max(
      Number(window.sessionStorage.getItem('portfolioHomeScrollY') || 0),
      window.scrollY || 0
    );
    const need = Math.ceil(saved + (window.innerHeight || 0) + 1);
    body.style.minHeight = need + 'px';
    /* ⚠ 不要用 html{overflow:hidden} 来锁滚动 —— 实测（hash-scroll-check.mjs ⑤⑦）
       它会把滚动位置**直接清零**（1704 → 0），正好把我上面保住的位置又抹掉。
       改用"滚动监听按回原位":一级层此刻不可见,所以推回去完全无感;
       而且它不动 overflow,不会触发清零。 */
    const onScroll = () => {
      if (Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    /* ⚠ 关键的一笔:上面那句"复位到 0"（goWorks 的 620ms timeout）已经把滚动清零了,
       而**文档后来变高并不会把被清零的位置自己找回来** —— 必须在这里补写回去。
       此刻高度已经够(刚垫的 minHeight),写入一定成立;而且一级层还不可见,
       用户看不到这一下。补写之后,回程揭示时位置本来就是对的 → 不再有 hero 帧。 */
    if (saved > 0 && Math.abs(window.scrollY - saved) > 1) {
      document.documentElement.style.scrollBehavior = 'auto';
      document.body.style.scrollBehavior = 'auto';
      window.scrollTo(0, saved);
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      body.style.minHeight = '';
      /* 回程揭示这一提交里把位置落定(在绘制之前),这样第一帧画的就是原位置。 */
      if (saved > 0 && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    };
  }, [route.page, homeHandoff]);

  /* 环境光(SideRays)单例 (2026-10-07):一级首页与二级作品页**共用同一个实例**。
     以前两级各挂一份(一级 .home-rays-layer、二级 .works-side-rays),跨级时是两个
     WebGL 上下文、各自 shader,视觉参数虽同但始终是"两个光"。现在提升到 App 顶层:
       - raysMounted:是否已挂载。**首次点亮后就常驻**,之后一级/二级来回都复用同一个
         WebGL 实例与 shader,不再重建 → 无上下文开销、无首帧闪烁,天然「同一个」。
       - raysLit:当前是否点亮(是否在发光)。一级在 projects/contact 视口内、二级常态
         点亮;详情页不点亮(视觉与改动前一致,且隐藏时停渲零空转)。
     视觉一律以一级为准(参数、z-index 20、mask 78%、移动端 opacity 0.8)。 */
  const [raysMounted, setRaysMounted] = useState(false);
  const [raysLit, setRaysLit] = useState(false);
  const appRaysLayerRef = useRef(null);
  const appRaysHitRef = useRef(false);
  const mobileFlipTimerRef = useRef(0);
  const scheduleMobileFlipClear = () => {
    window.clearTimeout(mobileFlipTimerRef.current);
    // 翻页动画 420ms(2026-10-07 提速),留 100ms 余量即可清理,别让
    // exitDetail 多挂 300ms —— 那段时间详情层虽已翻出屏幕,但仍占着挂载。
    mobileFlipTimerRef.current = window.setTimeout(() => {
      setMobileFlip(null);
      setExitDetail(null);
    }, 520);
  };

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /* 环境光单例的点亮/停渲驱动 (2026-10-07)。
     点亮判据:
       - 二级作品页(route.page === 'works'):常态点亮(整页都是光的舞台)。
       - 首页(route.page === 'home'):沿用它原有的「作品展示/联系屏与视口相交」语义,
         从 live 文档读这两段 rect(#projects / #contact),相交即点亮。
       - 详情页:不点亮(停渲,视觉与改动前一致)。
     实例生命周期:自上向下**只挂载、不卸载**(一旦点亮过就常驻)。这样一级/二级/详情
     之间来回始终是同一个 WebGL 实例,既没有上下文重建开销,也不再换页闪一下 ——
     这就是"两级共用一个环境光"的字面实现。
     走的是 refs(classList / style)而不是 diff 类名,故不依赖 React 在下一次
     render 才写 DOM。 */
  useEffect(() => {
    let frame = 0;

    const homeSections = () => ['projects', 'contact']
      .map((id) => document.getElementById(id))
      .filter((el) => el && el.isConnected);

    const setLit = (on) => {
      const layer = appRaysLayerRef.current;
      if (layer) {
        if (on) layer.classList.add('is-on');
        else layer.classList.remove('is-on');
      }
      if (on) setRaysLit(true);
      else setRaysLit(false);
    };

    const syncRays = () => {
      frame = 0;
      const page = parseRoute().page;
      if (page === 'detail') {
        // 停渲但保持挂载(实例常驻),重新点亮当帧即续。
        if (appRaysHitRef.current) { appRaysHitRef.current = false; setLit(false); }
        return;
      }

      let hit = false;
      if (page === 'works') {
        hit = true;
        // 二级页把这层钉回视口:一级的"跟随内容 translate"在二级会把层推
        // 出屏幕(沿用首页的 follow 值),IntersectionObserver 随即判不可见 →
        // 卸载 canvas。二级整页都是光的舞台,transform 归零即可。
        const layer = appRaysLayerRef.current;
        if (layer) layer.style.transform = 'translate3d(0, 0, 0)';
      } else if (page === 'home') {
        const elements = homeSections();
        if (!elements.length) return;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const rects = elements.map((element) => element.getBoundingClientRect());
        hit = rects.some((rect) => rect.top < viewportHeight && rect.bottom > 0);
        // 最上方的那段决定偏移:它在视口之上时钳到 0(层钉住),往上滚动把它
        // 推下来时层跟着它走 —— 与改动前一致。
        const lead = Math.min(...rects.map((rect) => rect.top));
        const follow = Math.max(0, Math.min(lead, viewportHeight));
        const layer = appRaysLayerRef.current;
        if (layer) layer.style.transform = `translate3d(0, ${Math.round(follow)}px, 0)`;
      }

      if (hit === appRaysHitRef.current) return;
      appRaysHitRef.current = hit;
      if (hit) {
        // 首次点亮即挂载,此后常驻;再次点亮不重建。
        setRaysMounted(true);
        setLit(true);
      } else {
        // 回滚到 hero:仅熄灭(保留 canvas 供回来时复用)。
        setLit(false);
      }
    };

    const onScrollOrResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(syncRays);
    };

    syncRays();
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [route.page]);

  // 卸载/熄灭时确保摘掉点亮类,避免残留。
  useEffect(() => {
    if (raysMounted) return;
    const layer = appRaysLayerRef.current;
    if (layer) layer.classList.remove('is-on');
  }, [raysMounted]);

  /* 环境光预热（2026-10-13，GPT 清单第 5 条：环境光的 WebGL 初始化、编译与首次绘制）。
     过去 WebGL 上下文 + 全屏片元 shader 的编译发生在**首次点亮那一刻**（滚到作品屏
     或进二级页）—— 正好压在滚动和跨级转场的起跑上。现在趁 loading 遮罩还在时把它
     挂起来（active=false → 只建上下文与 program，不渲染），编译成本留在遮罩下，
     首次点亮当帧即续（SideRays 本来就是为"常驻不重建"设计的）。
     ⚠ 只在遮罩仍在时挂：揭幕后才挂就等于在首屏加一次冷启动，那是反效果。 */
  useEffect(() => {
    if (raysMounted) return undefined;
    /* ⚠ 不能用"遮罩节点在不在"当判据（2026-10-13 实测踩坑）：遮罩 div 由 index.html
       的 body 内联脚本创建，而它的执行时机与 React 首帧**没有先后保证** —— 首次实测
       就是这个 effect 跑在遮罩入 DOM 之前，预热被静默跳过（探针里 raysCanvas 一直 false）。
       换成 App 级权威信号：HomePage 在 hero 视频"够播"那一声 hero:ready（那时遮罩
       通常还剩 ~1–2.5s，正是预热的窗口），外加 1.8s 兜底。__appRevealed 之后不再预热，
       避免把冷启动搬到用户看得见的首屏上。 */
    const masked = () => !window.__appRevealed;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      if (masked()) setRaysMounted(true);
    };
    if (window.__heroReady) fire();
    window.addEventListener('hero:ready', fire);
    const t = window.setTimeout(fire, 1800);
    return () => {
      window.removeEventListener('hero:ready', fire);
      window.clearTimeout(t);
    };
  }, [raysMounted]);

  useEffect(() => {
    if (route.page !== 'home') {
      setHomeActiveSection('hero');
      return undefined;
    }

    let frame = 0;
    const syncActiveSection = () => {
      frame = 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const marker = viewportHeight * 0.52;
      let activeId = 'hero';
      for (const id of HOME_PAGE_IDS) {
        const section = document.getElementById(id);
        if (!section) continue;
        const rect = section.getBoundingClientRect();
        if (rect.top <= marker && rect.bottom > marker) {
          activeId = id;
          break;
        }
      }
      setHomeActiveSection((current) => current === activeId ? current : activeId);
    };
    const requestSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(syncActiveSection);
    };

    syncActiveSection();
    window.addEventListener('scroll', requestSync, { passive: true });
    window.addEventListener('resize', requestSync);
    window.addEventListener('scrollend', requestSync);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', requestSync);
      window.removeEventListener('resize', requestSync);
      window.removeEventListener('scrollend', requestSync);
    };
  }, [route.page]);

  useEffect(() => {
    if (!navMotion) return undefined;
    const settleDelay = navMotion === 'to-works' ? 880 : 760;
    const timer = window.setTimeout(() => {
      setNavMotion('');
      if (route.page === 'works' && navMotion === 'home-to-works') {
        setSharedPill(null);
      }
    }, settleDelay);
    return () => window.clearTimeout(timer);
  }, [navMotion, route.page]);

  const activeCategory = categories.find((item) => item.id === route.category) ?? categories[0];
  const works = worksByCategory[activeCategory.id] ?? [];
  const activeIndex = Math.max(0, works.findIndex((item) => item.id === route.workId));
  const activeWork = works[activeIndex] ?? works[0];

  useLayoutEffect(() => {
    const previousPage = previousPageRef.current;
    previousPageRef.current = route.page;

    // 「这次导航是哪个方向」的唯一信号:只看 page 有没有在
    // home ⇄ 非 home 之间翻转,与"谁触发的"无关。
    // 2026-10-04:此前只有 goHome()/goWorks() 里显式挂类,浏览器后退/前进走的是
    // hashchange → setRoute(parseRoute()),绕过这两个函数 —— 漏掉类会丢掉
    // PC 分类行的入场动画,以及移动端回程那套"线先转白、白圆慢半拍"的配色。
    // 放在 useLayoutEffect 里是为了在浏览器绘制这一帧之前把类挂上。
    // (icon 的 d 形变已回到纯 transition,不再依赖这个类;类只是节奏信号。)
    // (goHome/goWorks 里那两处 setNavMotion 仍然保留:它们还兼管"works 内部换分类
    //  时提前撤掉上一轮的类"这类额外语义,这里只是补上缺失的那条路径。)
    if (previousPage !== route.page) {
      if (previousPage === 'home') setNavMotion('home-to-works');
      else if (route.page === 'home') setNavMotion('works-to-home');
      else setNavMotion('');
    }

    if (route.page === 'home') {
      setSharedPill(null);
      return undefined;
    }

    if (route.page === 'works' && previousPage === 'works') {
      // In-place category changes are animated by the nav's own indicator.
      // Creating a shared overlay here would hide that indicator and make the
      // category change look like an instant swap.
      setSharedPill(null);
      return undefined;
    }

    let frame = 0;
    let trackingUntil = 0;
    let disposed = false;
    const selector = route.page === 'detail' ? '[data-detail-category-pill="true"]' : `[data-category-pill="${activeCategory.id}"]`;

    // The nav itself morphs with CSS. The shared active pill is a separate
    // fixed layer, so sampling only once leaves it behind when a quick swipe
    // starts another morph before the previous one has settled. Track the
    // anchor for the duration of the morph and keep the existing pill CSS
    // transition intact.
    const updatePill = () => {
      if (disposed) return;
      const rect = readNavRect(selector);
      if (rect) {
        setSharedPill((current) => {
          const next = {
            rect,
            title: activeCategory.title,
            mode: route.page === 'detail' ? 'detail' : 'works'
          };
          if (
            current && current.title === next.title && current.mode === next.mode &&
            Math.abs(current.rect.x - rect.x) < 0.25 &&
            Math.abs(current.rect.y - rect.y) < 0.25 &&
            Math.abs(current.rect.width - rect.width) < 0.25 &&
            Math.abs(current.rect.height - rect.height) < 0.25
          ) return current;
          return next;
        });
      }
      if (performance.now() < trackingUntil) {
        frame = window.requestAnimationFrame(updatePill);
      }
    };

    const startTracking = (duration = 1100) => {
      trackingUntil = Math.max(trackingUntil, performance.now() + duration);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePill);
    };

    if (route.page === 'works' && previousPage !== 'detail') {
      setSharedPill(null);
      // 2026-10-04: home → works 时**没有源胶囊可变形**(首页导航里根本不存在
      // 那枚蓝胶囊)。此前仍会新建浮层,效果是这个新元素每帧追锚点、却带着自己
      // 的 680ms left/top 过渡 —— 探针实测:相对锚点最多滞后 5.6px,且文字
      // 325ms 已淡入到 1,胶囊要到 542ms 才停 —— 业主看到的「文字都出现了,
      // 胶囊还在动/有弹性地飘进来」。
      // 改:直接交给**行内指示器** (.works-nav-indicator)。它是选项行的子元素,
      // 跟随行的 opacity 一起淡入、随整条栏一起位移,与文字完全同步、零滞后。
      if (previousPage === 'home') return undefined;
      startTracking();
    } else {
      startTracking();
    }
    const handleResize = () => startTracking(900);
    const handleScroll = () => startTracking(900);
    // 三级页导航胶囊固定在顶栏，内容滚动不会移动它，无需逐滚动帧重追锚点
    // （否则每次滚动都开启一个 ~900ms 的 rAF 重追循环，加剧滚动卡顿）。
    // 仅在 works（分类行指示器可能平移）保留滚动重追。
    if (route.page !== 'detail') {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('resize', handleResize);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [route.page, activeCategory.id, activeCategory.title]);

  /* ★ 2026-10-10 第 16 轮(业主重点 BUG:返回一级时随机闪一帧 hero):
     这个"延时两帧再写"原先是**无条件**的 —— 若这两帧里用户又点进了二级
     (或别的入口改了路由),待会儿照样把窗口滚回首屏偏移,而那时一级层可能
     正在交接期**画在屏幕上** ⇒ 直接闪一帧 hero。
     修法:① 只在"此刻确实要回到目标页"时才落定(route 仍是目标页);
          ② 写入前先把文档撑到"目标 + 一屏",杜绝写入被钳成 0 —— 钳位正是
             「揭示那一帧停在页首」的物理原因(见保位 effect 的同一条机理)。 */
  const restoreScroll = (key, fallback, expectPage = null) => {
    const saved = Number(window.sessionStorage.getItem(key) ?? fallback);
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (expectPage && routeRef.current.page !== expectPage) return;
      if (saved > 0) {
        const need = Math.ceil(saved + (window.innerHeight || 0) + 1);
        if (document.documentElement.scrollHeight < need) document.body.style.minHeight = `${need}px`;
      }
      window.scrollTo(0, saved);
      if (saved > 0 && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    }));
  };

  const goHome = () => {
    /* ★ 2026-10-10 行为验证抓到的真 bug（behavior-check.mjs 的 F1）：
       进入转场的守卫期内，二级页的「返回」按钮**仍然点得动** —— 实测点下去 900ms 后
       二级页已被卸载。原因是此前只给"点卡 / 切分类 / 详情返回"加了锁，漏了 goHome
       本身。这里补上：正在演形变时，返回按钮不接受操作（回程结束由 onLeavingDone
       清零，之后恢复正常）。 */
    if (morphLocked()) return;
    /* ★ 2026-10-10 业主实测：**PC 上"预览手机端"时，从二级返回一级会闪 hero 单帧**。
       机理（与下方"改路由 → 再恢复滚动"的顺序一致）：
         改路由(setRoute)让一级层变可见；而滚动恢复 restoreScroll 写在它**之后**，
         执行时一级层仍是 display:none、文档只有二级页那么高 ⇒ 这个"回到原位"的
         写入被浏览器**当场钳成 0** ⇒ 提交完成后一级层可见，画面停在页首 = hero。
       手机分支不受影响（那里有"先把文档撑高"的保位，逐帧探针实测 0 帧）；
       出问题的是"布局是手机版、但 isMobileDevice() 为非手机"这条分支 —— 正是
       PC 浏览器预览手机端的场景。
       修法：**在改路由之前**先把文档撑到"原位置 + 一屏"，让那次写入不被钳；
       两帧后（揭示已画完）撤掉这段临时高度。
       仅作用于 !isMobileDevice()，不触碰任何已验证的手机路径。 */
    (() => {
      const y0 = Number(window.sessionStorage.getItem('portfolioHomeScrollY') ?? homeScrollY) || 0;
      if (isMobileDevice() || y0 <= 0) return;
      document.body.style.minHeight = Math.ceil(y0 + (window.innerHeight || 1) + 1) + 'px';
      window.scrollTo(0, y0);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.body.style.minHeight = '';
      }));
    })();
    // 回程也要挂一个 motion 类:`works-to-home` 在 mobile.css 里被用来把
    // **回程的配色节奏**翻过来(线先转白、白圆慢半拍再淡出,见「回程的配色
    // 节奏必须与去程相反」)。此前这里一律置 '',回程就会沿去程的配色时序跑,
    // 中途出现"灰线落在深色背景上"的隐形帧。
    // 形变本身不靠这个类(三条线的 d 是纯 transition,状态类一翻就补间)。
    setNavMotion(route.page === 'home' ? '' : 'works-to-home');
    setSharedPill(null);
    setWorksActiveLocked(false);

    /* 2026-10-07 移动端回程:二级页保持挂载,由二级轨道自己收拢回首页那张卡。
       先把首页卡组的焦点瞬移到「用户正在看的这张卡」—— 用户可能在二级页滑了
       好几张,而首页卡组还停在离开时那张,不先对齐就会收拢到另一个作品上,
       那正是业主说的「二级页面的卡片像是回到一级页面后就消失了」。
       焦点瞬移发生在二级页整层仍盖着首页的时候,位移过程看不见。 */
    if (isMobileDevice() && route.page === 'works') {
      holdStreetIdleFrames();
      setDeckFocusId(activeWork?.id ?? '');
      setWorksEntry(null);
      setExitWorks(true);
      /* ★ 2026-10-10 第 16 轮(返回一级随机闪 hero 的另一半机理):
         一级层此刻是 display:none,文档只有二级页那么高 ⇒ 任何"回到原位置"的
         写入都会被浏览器钳成 0,揭示那一帧就停在页首(= hero)。
         所以**在改路由之前**先把文档撑到「原位置 + 一屏」,让位置根本不会被抹;
         揭示时它本来就是对的,不需要任何事后补写(旧代码的补写都被钳位打败过)。
         高度由保位 effect 的 cleanup 撤掉;这里只是提前一拍,不改变职责归属。 */
      (() => {
        const y0 = Number(window.sessionStorage.getItem('portfolioHomeScrollY') ?? homeScrollY) || 0;
        if (y0 <= 0) return;
        const need = Math.ceil(y0 + (window.innerHeight || 0) + 1);
        if (document.documentElement.scrollHeight < need) document.body.style.minHeight = `${need}px`;
      })();
      /* 业主第五轮:回程的「其余元素」入场必须与收拢**同帧开始** —— 等收拢
         演完(560ms)才升回来读作"两段动效",中间是空场。这里立即摘掉
         is-chrome-out 并挂 is-chrome-in(见 chromeIn 注释:动画自带 from,
         不依赖 display:none 之前的历史计算值),五组元素按各自延迟与收拢
         同步起跑;二级层底(mw-leaving::before)的 320ms 淡出让入场全程可见。 */
      setChromeHidden(false);
      setChromeIn(true);
      window.clearTimeout(chromeInTimerRef.current);
      /* 入场最长的一条 = 标题(延迟 160ms + 320ms)= 480ms。演完就摘掉
         is-chrome-in:留着它,下次去程挂 is-chrome-out 时两条规则会打架。 */
      chromeInTimerRef.current = window.setTimeout(() => setChromeIn(false), 600);
      window.location.hash = '';
      setRoute({ page: 'home', category: route.category, workId: '' });
      pendingHomeScrollRef.current =
        Number(window.sessionStorage.getItem('portfolioHomeScrollY') ?? homeScrollY) || 0;
      /* 转场期间禁止操作屏幕（移动端）：收拢 560ms + 落点等待，兜底 1400ms，
         真正的解除由 onLeavingDone 负责。 */
      armMorphGuard(1400);
      restoreScroll('portfolioHomeScrollY', homeScrollY, 'home');
      /* 转场期间锁一级页翻页(见 isLocked);收拢结束由 onLeavingDone 清零。 */
      window.__worksMorphUntil = performance.now() + 1400;
      return;
    }

    /* 2026-10-08 第八轮 PC 回程:二级页不立刻卸下,而是浮到首页之上把坠落
       动画演完(见 .orbit-fall)。路由 / 导航 / 滚动恢复全部照常、同帧发生,
       所以导航的 morph 不会被这 560ms 拖慢;二级层是 fixed,不占文档流,
       一级页的滚动位置也不受影响。 */
    const leavingWorksOnPc = route.page === 'works' && !isMobileDevice();
    if (leavingWorksOnPc) {
      /* 转场期间锁一级页翻页(见 isLocked):PC 二级层要浮在上面把坠落演完。 */
      window.__worksMorphUntil = performance.now() + PC_WORKS_EXIT_MS + 400;
      setPcWorksExit(true);
      window.clearTimeout(pcWorksExitTimerRef.current);
      pcWorksExitTimerRef.current = window.setTimeout(() => setPcWorksExit(false), PC_WORKS_EXIT_MS);
    }

    window.location.hash = '';
    setRoute({ page: 'home', category: route.category, workId: '' });
    // The home layer stayed mounted, so its screen index is still the one the
    // reader left on. Restore the recorded entry offset, which on a paged home
    // is exactly that screen boundary, so the wheel controller and the view
    // stay in step instead of being reset to screen 01.
    restoreScroll('portfolioHomeScrollY', homeScrollY);
  };

  const goWorks = (category = route.category, restore = false, opts = null) => {
    // 移动端每一次进出二级页(含在二级页内换分类的横滑)都先挂起街景保活帧,
    // 免得那 85ms 的空转帧砸进 520ms 的轨道动画里。
    if (isMobileDevice()) holdStreetIdleFrames();
    if (route.page === 'home') {
      /* 转场期间禁止操作屏幕（移动端进出二级都算）：入场 700+40ms，兜底 780ms；
         真正的解除由 onEntryArmed 负责（入场动效一结束立刻放行）。 */
      armMorphGuard(780);
      /* 转场期间锁一级页翻页(见 isLocked):入场 700+40ms 里一级层还在场,
         此时翻页会让形变落点跑到别的屏;onEntryArmed 清零。 */
      window.__worksMorphUntil = performance.now() + 900;
      setNavMotion('home-to-works');
      // 2026-10-06 移动端:首页点卡 → 二级页。移动端把源卡矩形交给二级轨道,
      // 由**同一张卡**自己从源卡姿态张开 —— 覆盖层没有蒙版/标题/阴影,交接
      // 瞬间这些东西凭空出现,就是业主看到的「跳帧换了一张卡」。
      // 2026-10-09 业主:PC 一级→二级不再做卡片放大过渡,SharedImageTransition
      // 已随「二级封面图 → 三级页头图」旧设计一并删除,PC 点卡直接切页。
      if (opts?.rect && opts?.src && isMobileDevice()) {
        setWorksEntry({
          rect: opts.rect,
          workId: opts.workId ?? '',
          /* 副卡姿态 + 一级卡面布局高:二级轨道的入场初始姿态要用它们,
             让左右两张副卡从它们在一级里的位置接着动(见 WorksPage 入场)。 */
          cardH: opts.cardH ?? null,
          prevPose: opts.prevPose ?? null,
          nextPose: opts.nextPose ?? null
        });
      }
    } else if (route.page !== 'detail') {
      setNavMotion('');
      setWorksActiveLocked(false);
    }
    if (route.page === 'works' && category !== route.category) {
      setSharedPill(null);
    }
    if (route.page === 'home') {
      const entryY = window.scrollY;
      setHomeScrollY(entryY);
      window.sessionStorage.setItem('portfolioHomeScrollY', String(entryY));
      // Record which screen of the home layer was the way in, so a return can
      // land on it even if the entry scroll offset is gone after a reload.
      window.sessionStorage.setItem(
        'portfolioHomeEntryIndex',
        String(Math.max(0, Math.round(entryY / (window.innerHeight || 1))))
      );
    }
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    /* 2026-10-07 业主第五轮「进二级页看到的不是过渡,而是首屏 hero」:
       移动端点卡进二级时,一级层要留在场上演 620ms 的元素退场(homeHandoff),
       而首页是**窗口滚动**分页 —— 此刻把窗口滚回 0,仍在场的一级层当帧就跳回
       首屏 hero,退场动效全部被盖掉。二级层是 position:fixed(见
       .works-index-page),不依赖窗口滚动,所以交接路径把复位推迟到一级层
       隐藏(homeHandoff 撤)之后;非交接路径(导航直跳/查看全部/PC)照旧立即复位。 */
    const mobileHandoff = isMobileDevice() && Boolean(opts?.rect && opts?.src);
    /* ★ 2026-10-10 业主：「一级进入二级时闪一下 hero」。这里原先**同步**写了一次
       window.scrollTo(0, 0)：它在渲染提交**之前**执行，而一级层此刻还在画面上
       （它的隐藏发生在紧接着的那次提交里）—— 于是那一帧很可能就是"滚动已归 0 的
       一级层"，也就是首屏 hero。二级层是 position:fixed、不依赖窗口滚动，这次
       同步复位没有任何必要；下面那次 rAF 复位已经足够，而 rAF 在下一帧绘制之前
       执行，那时一级层已经隐藏。 */
    const workId = opts?.workId ?? '';
    window.location.hash = `/works?category=${category}${workId ? `&work=${workId}` : ''}`;
    setRoute({ page: 'works', category, workId });
    if (restore) {
      restoreScroll('portfolioWorksScrollY', worksScrollY);
    } else if (!mobileHandoff) {
      window.requestAnimationFrame(() => window.scrollTo(0, 0));
    }
    /* 2026-10-07 第四轮:一级页「其余元素」的**离场动效**。
       只在"点卡进入"(有 opts.rect,即卡在飞)这条路径上启用 —— 此时才需要
       「其余元素淡出上移 + 二级底渐显」的交接;导航直跳/查看全部没有飞行过程,
       一级层当帧就该撤走,不需要、也不该拖 400ms。
       时序:
         t=0     chrome 进入退场姿态(240ms,逐条延迟 0/40/80/120/160)、
                 homeHandoff 保持一级层在场、二级层底从透明淡入(360ms)、
                 一级卡组被遮住(避免"静止卡 + 飞行卡"两份);
         t≈620   撤 homeHandoff → 一级层隐藏(此时二级底已完全不透明)、
                 chromeHidden 保持 true(它们要等回程才入场)。 */
    if (mobileHandoff) {
      setChromeHidden(true);
      setChromeIn(false);
      window.clearTimeout(chromeInTimerRef.current);
      setHomeHandoff(true);
      window.clearTimeout(chromeTimerRef.current);
      /* 2026-10-10 试过在这里"每帧按住 window.scrollY":**无效** —— 文档高度塌掉后，
         浏览器的钳位发生在 rAF 之后的布局阶段，逐帧 scrollTo 每次都被覆盖（逐帧探针
         实测仍是 2 帧 hero 帧）。真正要治的是"高度为什么塌"，见下面 timeout 的时序；
         这里不再做无用的逐帧重写。 */
      chromeTimerRef.current = window.setTimeout(() => {
        setHomeHandoff(false);
        /* ★ 2026-10-10 第 16 轮(业主重点 BUG:进出二级随机闪一帧 hero):
           这里原先要把窗口滚动复位到 0。但**交接期的一级层是画在屏幕上的**
           (它要留场演完 620ms 的元素退场),把滚动清零 = 当帧把仍在场的一级层
           拽回首屏 ⇒ 用户看到的「闪一下 hero」就是这一下。
           放进 rAF 也不稳:setHomeHandoff 是异步宏任务,提交可能在 rAF 之后,
           竞态仍会漏出 1 帧(探针实测过)。
           正解:**交接期根本不复位**。二级层是 position:fixed、不需要窗口滚动;
           保位 effect 已把文档垫到「原位置 + 一屏」并按住该位置,所以整个二级
           期间滚动本来就等于用户离开时的值,零复位、零钳位、零闪帧。
           回程由 pendingHomeScrollRef / 保位 cleanup 落定,位置还是原位置。 */
      }, 620);
    }
  };

  const goDetail = (category, workId) => {
    // 2026-10-08: 三级页头图已删,顶部恒为纯黑 ⇒ 导航玻璃固定深色起步;
    // hero morph 没有落点,二级进三级不再建飞行层(移动端本就是整页翻屏)。
    document.body.classList.remove('nav-on-light');
    const fromRect = readNavRect(`[data-category-pill="${category}"]`);
    if (fromRect) {
      setSharedPill({ rect: fromRect, title: categories.find((item) => item.id === category)?.title ?? activeCategory.title, mode: 'works' });
    }
    setWorksActiveLocked(false);
    setNavMotion('to-detail');
    // 2026-10-06 移动端:进入详情改为「下滑翻页」——详情层从顶部滑入盖住二级页,
    // 导航 morph(works→detail)照旧由路由驱动,这里只负责层的入场。
    if (isMobileDevice()) {
      holdStreetIdleFrames();
      window.clearTimeout(mobileFlipTimerRef.current);
      setMobileFlip('enter');
      scheduleMobileFlipClear();
    }
    setWorksScrollY(window.scrollY);
    window.sessionStorage.setItem('portfolioWorksScrollY', String(window.scrollY));
    window.sessionStorage.setItem('portfolioDetailEntryCategory', category);
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    window.location.hash = `/detail?category=${category}&work=${workId}`;
    setRoute({ page: 'detail', category, workId });
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  const goDetailByIndex = (nextIndex) => {
    const target = works[nextIndex];
    if (!target) return;
    // 头图已删,三级页顶部恒为纯黑,导航玻璃固定深色(见 goDetail 注释)。
    document.body.classList.remove('nav-on-light');
    window.location.hash = `/detail?category=${activeCategory.id}&work=${target.id}`;
    setRoute({ page: 'detail', category: activeCategory.id, workId: target.id });
    window.scrollTo(0, 0);
  };

  const goDetailCategory = (category) => {
    const target = worksByCategory[category]?.[0];
    if (!target) return;
    // 头图已删,三级页顶部恒为纯黑,导航玻璃固定深色(见 goDetail 注释)。
    document.body.classList.remove('nav-on-light');

    // Keep the current detail pill mounted at its old rect while the new
    // category target is rendered. The tracking effect then updates the rect
    // and the pill's existing CSS transition carries it to the new position.
    // Without this hand-off React can mount the new target and the overlay in
    // the same frame, which reads as a direct jump on fast taps.
    const currentRect = readNavRect('[data-detail-category-pill="true"]');
    if (currentRect) {
      setSharedPill({ rect: currentRect, title: activeCategory.title, mode: 'detail' });
    }

    window.location.hash = `/detail?category=${category}&work=${target.id}`;
    setRoute({ page: 'detail', category, workId: target.id });
    window.scrollTo(0, 0);
  };

  const goDetailBack = () => {
    /* 转场期间禁止操作（业主第 2 条）：正在演形变时不再接受新的转场入口。 */
    if (morphLocked()) return;
    const entryCategory = window.sessionStorage.getItem('portfolioDetailEntryCategory');
    const shouldRestore = entryCategory === route.category;
    setWorksActiveLocked(true);
    window.setTimeout(() => setWorksActiveLocked(false), 860);
    setNavMotion('to-works');
    if (isMobileDevice()) {
      // 2026-10-06 移动端返回 = 上滑翻页:详情层(内滚停在原处,不回卷到 0)
      // 整体向上滑出,露出底下的二级页。route 先切 works 让导航同时开始
      // detail→works 的 morph;WorkDetailPage 借 exitDetail 保持挂载 720ms。
      window.clearTimeout(mobileFlipTimerRef.current);
      holdStreetIdleFrames();
      setExitDetail({ category: activeCategory, work: activeWork, workId: activeWork?.id ?? '' });
      setMobileFlip('exit');
      scheduleMobileFlipClear();
      goWorks(route.category, false, { workId: activeWork?.id ?? '' });
      return;
    }
    goWorks(route.category, shouldRestore);
  };

  /* 2026-10-07 二级轨道 → 导航:主卡滑到某张卡时把它的分类回写上来。
     只更新 state 与地址栏的**当前条目**(replaceState),不写 hash:
     每滑一张就 push 一条历史,会把浏览器后退变成「逐张倒卡」。
     地址栏仍保持深链可用(#/works?category=..&work=..)。 */
  const syncWorksActive = useCallback((work) => {
    if (!work) return;
    setRoute((r) => {
      if (r.page !== 'works') return r;
      if (r.category === work.category && r.workId === work.id) return r;
      return { ...r, category: work.category, workId: work.id };
    });
    const url = `/works?category=${work.category}&work=${work.id}`;
    if (window.location.hash !== `#${url}`) window.history.replaceState(null, '', `#${url}`);
  }, []);

  // Keep works mounted beneath mobile detail, but remount after returning home.
  // Entry geometry assumes fresh slides, without the previous exit pose.
  const worksLayerVisible = route.page === 'works' || exitWorks || pcWorksExit;
  const worksLayerUnder = !worksLayerVisible && route.page === 'detail' && isMobileDevice();
  const worksLayerMounted = worksLayerVisible || worksLayerUnder;
  const worksWrapClass = worksLayerVisible
    ? 'works-layer'
    : `mw-under${worksLayerUnder && mobileFlip === 'enter' ? ' mw-under-exit-down' : ' is-covered'}`;
  return (
    <>
      {/* 环境光单例层(2026-10-07):一级与二级共用这**一个**实例。
          位置/层级/视觉一律沿用一级原样(fixed inset:0、z-index 20、mask 78%、
          mix-blend:screen、移动端 opacity .8),所以二级换用它等于"二级改用一级那道光"。
          首次点亮后常驻,跨级来回不重建。 */}
      <div className={`home-rays-layer${raysLit ? ' is-on' : ''}${pcWorksExit ? ' is-over-works-exit' : ''}`} ref={appRaysLayerRef} aria-hidden="true">
        {raysMounted && (
          <SideRays
            className="home-rays"
            active={raysLit}
            /* 遮罩期预热(2026-10-13):挂载时若还没点亮,就让 SideRays 立刻把 WebGL
               上下文与 program 建好(它的 isVisible 此刻必然为 false —— syncRays
               在首屏把整层停在视口下方),点亮当帧即续,不再有编译卡顿。 */
            prewarm={!raysLit}
            speed={2.5}
            rayColor1="#EAB308"
            rayColor2="#96c8ff"
            /* 2026-10-13 业主诉求：移动端这道右上角环境光**调弱**（手机屏幕小、
               像素密度高，同样的强度看起来更刺眼，而它是全屏片元着色 —— 弱一点
               既顺眼又省 GPU）。PC 维持原值不动。dpr 上限与转场降频见 SideRays.jsx。 */
            intensity={isMobileDevice() ? 1.35 : 2}
            spread={2}
            origin="top-right"
            tilt={0}
            saturation={isMobileDevice() ? 1.3 : 1.5}
            blend={0.75}
            falloff={1.6}
            opacity={isMobileDevice() ? 0.82 : 1}
          />
        )}
      </div>
      <main>
        <MorphNav
          page={route.page}
          navMotion={navMotion}
          homeActiveSection={homeActiveSection}
          hasSharedWorksPill={Boolean((sharedPill || worksActiveLocked) && route.page === 'works')}
          activeCategory={activeCategory}
          activeIndex={activeIndex}
          total={works.length}
          goHome={goHome}
          goWorks={goWorks}
          goWorksBack={goDetailBack}
          goDetailByIndex={goDetailByIndex}
          goDetailCategory={goDetailCategory}
        />
        {sharedPill && <SharedCategoryPill pill={sharedPill} />}
        <>
            {/* The home layer is never unmounted, only hidden. Its images,
                video and scroll position survive a trip into works or detail,
                so coming back needs no reload and lands on the same screen.
                2026-10-07 第四轮:去程交接(homeHandoff)期间**暂缓隐藏** ——
                一级页「其余元素」的退场动效要有地方演;底层二级页此刻正从透明
                淡入(mw-handoff),所以看到的是"标题/计数器/圆点淡出 + 二级渐显"。 */}
            <div
              className={`page-keep${route.page === 'home' || homeHandoff ? '' : ' is-hidden'}`}
              aria-hidden={route.page !== 'home'}
            >
              <HomePage
                openWorks={(c, restore, opts) => { if (morphLocked()) return; goWorks(c, restore, opts); }}
                paging={paging && route.page === 'home'}
                active={route.page === 'home'}
                deckFocusId={deckFocusId}
                revealProjects={exitWorks}
                chromeHidden={chromeHidden || homeHandoff}
                chromeIn={chromeIn}
                deckVeiled={exitWorks || homeHandoff}
              />
            </div>
            {/* 2026-10-06 移动端:详情页在底下时二级页保持挂载(翻页动效的底层),
                enter 期间可见(详情层还没盖满)、落定后 visibility 隐藏但不卸载,
                返回翻页时立刻可见。PC 端维持原样(只有 works 才挂载)。
                2026-10-07 exitWorks:二级 → 一级的回程期间同样**保持挂载** ——
                收拢动画由轨道在原地执行,动画结束(onLeavingDone)才卸下,
                所以返回一级时看到的是同一张卡缩回去,而不是它先消失。 */}
            {worksLayerMounted ? (
              <div className={worksWrapClass} aria-hidden={worksLayerVisible ? undefined : 'true'}>
                {/* workId 跟随路由:详情翻入的 640ms 里,底下露出的必须是
                    用户刚点进来的那张卡,而不是回落到第 0 张。
                    under 期间保留详情返回所需的二级状态。 */}
                <WorksPage
                activeCategory={activeCategory}
                goDetail={goDetail}
                workId={route.workId}
                returning={mobileFlip === 'exit'}
                entry={worksEntry}
                leaving={exitWorks || pcWorksExit}
                handingOff={homeHandoff}
                onEntryArmed={() => { window.__worksMorphUntil = 0; disarmMorphGuard(); setWorksEntry(null); }}
                onLeavingDone={() => {
                  /* 转场结束 → 立刻解除一级页翻页锁与屏幕遮罩（见 isLocked）。 */
                  window.__worksMorphUntil = 0;
                  disarmMorphGuard();
                  /* 收拢结束的**同一提交**里:撤二级层 + 解除一级卡组遮挡。
                     (「其余元素」的入场已提前到回程开始时与收拢同步起跑,
                     这里只剩兜底:万一 chromeHidden 仍为 true 再补一刀。)
                     一级卡组现身的几何与轨道落点逐像素相同,交接不可见。 */
                  setExitWorks(false);
                  setWorksEntry(null);
                  setChromeHidden(false);
                }}
                onActiveWorkChange={worksLayerVisible ? syncWorksActive : null}
                onHome={goHome}
                />
              </div>
            ) : null}
            {route.page === 'detail' || exitDetail ? (
              <WorkDetailPage
                activeCategory={exitDetail ? exitDetail.category : activeCategory}
                work={exitDetail ? exitDetail.work : activeWork}
                flip={mobileFlip}
                onSwipeProject={
                  !exitDetail && isMobileDevice() && works.length > 1
                    ? (dir) => goDetailByIndex(activeIndex + dir)
                    : null
                }
                onBack={!exitDetail && isMobileDevice() ? goDetailBack : null}
                /* 左右滑动切项目的落点就是 works 里的 ±1（goDetailByIndex 越界即返回，
                   所以不做环绕），把这两件作品交给详情页做首图预取。 */
                neighborWorks={!exitDetail && works.length > 1
                  ? [works[activeIndex - 1], works[activeIndex + 1]]
                  : null}
              />
            ) : null}
        </>
      </main>
    </>
  );
}

function SharedCategoryPill({ pill }) {
  const style = {
    '--pill-x': `${pill.rect.x}px`,
    '--pill-y': `${pill.rect.y}px`,
    '--pill-w': `${pill.rect.width}px`,
    '--pill-h': `${pill.rect.height}px`
  };

  return (
    <span className={`shared-active-pill shared-active-pill-${pill.mode}`} style={style} aria-hidden="true">
      <span>{pill.title}</span>
      <span className="shared-active-chevron" />
    </span>
  );
}

function readNavRect(selector) {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  // 2026-10-06: 二级分类栏在三级页用 translateY(-8px) 退场,回程时它带着
  // 240ms 过渡从 -8px 回到 0。浮层的锚点每帧读 getBoundingClientRect(),
  // 那个 rect 是**含父级 transform 的**——采样若落在退场位移的过渡中途,
  // 目标 y 会被读成"抬高 8px"的坐标,浮层于是先向上冲、再随栏归位回落。
  // 实测:移动端回程出现 2.3~4.0px 的垂直上冲(幅度随主线程负载/帧率变化,
  // PC 也会偶发),业主看到的就是"胶囊像是从右上角一点的地方横移过来"。
  // 剥掉这层退场位移后,浮层目标恒等于分类栏**静止时**的坐标 → 回程是纯水平滑动,
  // 起点依旧精确接在三级胶囊上。栏本身的退场/归位动效不受影响。
  let shiftX = 0;
  let shiftY = 0;
  const row = element.closest('.works-nav-items');
  if (row && typeof DOMMatrixReadOnly === 'function') {
    const transform = getComputedStyle(row).transform;
    if (transform && transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(transform);
      shiftX = matrix.m41;
      shiftY = matrix.m42;
    }
  }
  return {
    x: rect.left - shiftX,
    y: rect.top - shiftY,
    width: rect.width,
    height: rect.height
  };
}

// 2026-10-08: readClippedRadius 只被「二级→三级 hero morph」使用,头图删除后无调用方,一并移除。
// 2026-10-09: SharedImageTransition(一级→二级卡片放大覆盖层)随之删除 —— 三级头图
// 移除后它只剩 PC 一级→二级一条路径,业主决定不再要这个过渡,相关 state/追踪
// effect/渲染点/CSS 全部清掉。移动端一级/二级的卡片自执行转场(worksEntry)不受影响。

/* 跨级转场期间挂起「测量类 hook」的 hashchange 重测(见 useMeasuredWidths /
   MEASURE_HOLD_MS):改 hash 会触发 hashchange → 那些 hook 在 100/450/1000ms
   各重测一次,而每次重测都要逐级 getComputedStyle 查可见性、读
   getBoundingClientRect、以及往 body 插探针读 clamp() 解析值 —— 全是强制同步
   布局。探针实测(手机 4× 降速)交互期间 30 次布局里 6 次、177 次样式重算里
   18 次由这条链触发,且正好落在动画帧之间。挂起到转场结束后再测,量到的值
   不变(只取决于字体与文案)。

   ⚠ 2026-10-10:这里原本还会写 window.__streetHoldUntil(尾屏街景在转场期间
   "一帧都不喂")。业主反馈尾屏开播要等好一会 —— 因为 demo 冷启动要靠喂帧才能跑完,
   转场不喂 + 保活间隔被我拉到 5s 之后,遮罩期基本喂不到帧,冷启动只能等业主滑到
   尾屏时现场补(实测 2500ms 才画出第一帧)。已连同保活间隔一起回撤到原值 1s。
   函数名保留(四处调用点不动),现在只负责"把测量推到转场之后"。 */
const MEASURE_HOLD_MS = 980;
function holdStreetIdleFrames(ms = 1800) {
  void ms;   // 尾屏挂起已回撤,参数不再使用
  try {
    window.__measureHoldUntil = Math.max(window.__measureHoldUntil || 0, performance.now() + MEASURE_HOLD_MS);
  } catch (_) { /* 极旧环境/被禁用时静默 */ }
}

function navigateToHomeSection(event, id) {
  event.preventDefault();
  const pager = homePagerRef.current;
  if (pager && pager.jumpTo(id)) return;
  const target = document.getElementById(id);
  if (!target) return;
  window.history.replaceState(null, '', `#${id}`);
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* HIDDEN_HERO_FOUR_LOGO_INTERACTION_START
   Original live HERO Logo component. It is retained for later reuse and is not
   mounted by HeroSection while the current three-layer HERO is active.
*/
function SharedHeroLogo({ page, homeHeroProgress, goHome }) {
  const wrapRef = useRef(null);
  const letterRefs = useRef([]);
  const subtitleRefs = useRef([]);
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const hoverTargetRef = useRef(0);
  const transformRef = useRef({
    x: 0,
    y: 0,
    width: 701,
    height: 200,
    opacity: 1,
    subtitle: 1,
    navMode: 0
  });
  const letters = Object.entries(fourLetterPaths);
  const subtitleText = 'Personal works exhibition';
  const subtitleChars = subtitleText.split('');

  useLayoutEffect(() => {
    let frame = 0;
    let lockedViewport = null;
    const updatePosition = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const host = wrap.parentElement;
      const hostRect = host?.getBoundingClientRect();
      const hostWidth = Math.max(1, Math.round(hostRect?.width ?? window.innerWidth));
      const hostHeight = Math.max(1, Math.round(hostRect?.height ?? window.innerHeight));

      if (!lockedViewport) {
        lockedViewport = {
          width: hostWidth,
          height: hostHeight
        };
      }

      const viewportWidth = lockedViewport.width;
      const viewportHeight = lockedViewport.height;
      const heroWidth = Math.min(viewportWidth * 0.44, 701);
      const heroHeight = heroWidth * (200 / 701);
      const heroRect = {
        x: (viewportWidth - heroWidth) / 2,
        y: (viewportHeight - heroHeight) / 2 - viewportHeight * 0.03,
        width: heroWidth,
        height: heroHeight
      };
      const rect = heroRect;

      transformRef.current = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity: 1,
        subtitle: 1,
        navMode: 0
      };

      wrap.style.transform = `translate3d(${rect.x.toFixed(2)}px, ${rect.y.toFixed(2)}px, 0)`;
      wrap.style.width = `${rect.width.toFixed(2)}px`;
      wrap.style.height = `${rect.height.toFixed(2)}px`;
      wrap.style.opacity = String(transformRef.current.opacity);
      wrap.classList.toggle('is-hero-active', page === 'home');
      wrap.classList.remove('is-nav-active');
      wrap.style.setProperty('--shared-subtitle-opacity', String(transformRef.current.subtitle));
      wrap.classList.add('is-positioned');
    };
    const requestUpdate = () => {
      window.cancelAnimationFrame(frame);
      lockedViewport = {
        width: Math.max(1, Math.round(wrapRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth)),
        height: Math.max(1, Math.round(wrapRef.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight))
      };
      frame = window.requestAnimationFrame(updatePosition);
    };

    updatePosition();
    window.addEventListener('resize', requestUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', requestUpdate);
    };
  }, [page]);

  const handlePointerMove = (event) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };
  };

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const canInteract = page === 'home' && transformRef.current.navMode < 0.08 && transformRef.current.opacity > 0.5;
      if (!rect || !canInteract) {
        hoverTargetRef.current = 0;
        return;
      }

      const isInside =
        event.clientX >= rect.left - rect.width * 0.08 &&
        event.clientX <= rect.right + rect.width * 0.08 &&
        event.clientY >= rect.top - rect.height * 0.18 &&
        event.clientY <= rect.bottom + rect.height * 0.92;

      if (isInside) {
        hoverTargetRef.current = 1;
        handlePointerMove(event);
      } else {
        hoverTargetRef.current = 0;
        pointerRef.current = { x: 0.5, y: 0.5 };
      }
    };

    const handleWindowPointerLeave = () => {
      hoverTargetRef.current = 0;
      pointerRef.current = { x: 0.5, y: 0.5 };
    };

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
    window.addEventListener('pointerleave', handleWindowPointerLeave);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerleave', handleWindowPointerLeave);
    };
  }, [page]);

  useEffect(() => {
    let frame = 0;
    let hoverMix = 0;
    let lastTime = performance.now();
    const start = performance.now();
    const centers = [
      { x: 0.08, y: 0.5 },
      { x: 0.36, y: 0.5 },
      { x: 0.63, y: 0.5 },
      { x: 0.86, y: 0.5 }
    ];
    const zones = [
      { x1: -0.02, x2: 0.22, y1: -0.08, y2: 1.08 },
      { x1: 0.2, x2: 0.52, y1: -0.08, y2: 1.08 },
      { x1: 0.52, x2: 0.78, y1: -0.08, y2: 1.08 },
      { x1: 0.78, x2: 1.04, y1: -0.08, y2: 1.08 }
    ];
    const rectProximity = (point, zone, falloff = 0.24) => {
      const nearestX = Math.min(Math.max(point.x, zone.x1), zone.x2);
      const nearestY = Math.min(Math.max(point.y, zone.y1), zone.y2);
      const dx = point.x - nearestX;
      const dy = point.y - nearestY;
      const distance = Math.sqrt(dx * dx * 1.2 + dy * dy * 2.4);
      return Math.max(0, 1 - distance / falloff);
    };
    const smooth = (value) => {
      const t = Math.min(Math.max(value, 0), 1);
      return t * t * t * (t * (t * 6 - 15) + 10);
    };

    const render = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const navMode = transformRef.current.navMode;
      const motionEnabled = navMode < 0.08 && transformRef.current.opacity > 0.5;
      hoverMix += ((motionEnabled ? hoverTargetRef.current : 0) - hoverMix) * (1 - Math.exp(-dt * 9));
      const p = pointerRef.current;

      letterRefs.current.forEach((node, index) => {
        if (!node) return;
        const introDelay = index * 260;
        const introDuration = 1800;
        const intro = page === 'home' && navMode < 0.08 ? smooth((now - start - introDelay) / introDuration) : 1;
        const center = centers[index] ?? centers[0];
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const proximity = Math.max(
          rectProximity(p, zones[index] ?? zones[0], 0.28),
          Math.max(0, 1 - Math.sqrt(dx * dx * 0.8 + dy * dy * 1.8) / 0.72) * 0.55
        );
        const pull = proximity * proximity * hoverMix;
        const wave = Math.sin(now * 0.0028 + index * 1.1) * pull;
        const x = dx * 64 * pull;
        const y = dy * 44 * pull + wave * 3;
        const scaleX = 1 + pull * 0.09;
        const scaleY = 1 + pull * 0.18;
        const blur = (1 - intro) * 72;

        node.style.opacity = String(intro);
        node.style.filter = `blur(${blur.toFixed(3)}px)`;
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
      });

      subtitleRefs.current.forEach((node, index) => {
        if (!node) return;
        const subtitleIntro = page === 'home' && navMode < 0.08 ? smooth((now - start - 1900) / 900) : 1;
        const count = Math.max(subtitleChars.length - 1, 1);
        const centerX = 0.08 + (index / count) * 0.84;
        const centerY = 1.22;
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        const charHalfWidth = subtitleChars[index] === ' ' ? 0.018 : 0.026;
        const proximity = Math.max(
          rectProximity(p, { x1: centerX - charHalfWidth, x2: centerX + charHalfWidth, y1: 1.06, y2: 1.38 }, 0.12),
          Math.max(0, 1 - Math.sqrt(dx * dx * 1.8 + dy * dy * 4.2) / 0.24) * 0.6
        );
        const pull = proximity * proximity * hoverMix;
        const x = dx * 150 * pull;
        const y = dy * 78 * pull + Math.sin(now * 0.0031 + index * 0.32) * pull * 5;
        const scaleX = 1 + pull * 0.05;
        const scaleY = 1 + pull * 0.16;
        const blur = (1 - subtitleIntro) * 10;
        const opacity = subtitleIntro * transformRef.current.subtitle;

        node.style.opacity = String(opacity);
        node.style.filter = `blur(${blur.toFixed(3)}px)`;
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
      });

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, [page]);

  return (
    <button
      type="button"
      className="shared-hero-logo"
      ref={wrapRef}
      onClick={goHome}
      aria-label="FOUR Home"
    >
      <svg className="shared-hero-logo-svg" width="701" height="200" viewBox="0 0 701 200" aria-hidden="true">
        <g className="shared-hero-logo-core">
          {letters.map(([key, paths], index) => (
            <g
              className="shared-hero-letter"
              ref={(node) => {
                letterRefs.current[index] = node;
              }}
              key={key}
            >
              {paths.map((path) => <path d={path} key={path} />)}
            </g>
          ))}
        </g>
      </svg>
      <span className="shared-hero-subtitle" aria-label={subtitleText}>
        {subtitleChars.map((char, index) => (
          <span
            className="shared-hero-subtitle-char"
            aria-hidden="true"
            ref={(node) => {
              subtitleRefs.current[index] = node;
            }}
            key={`${char}-${index}`}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </span>
    </button>
  );
}

function useRevealOnView({ threshold = 0.18, rootMargin = '0px 0px -10% 0px' } = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const lastScrollYRef = useRef(typeof window === 'undefined' ? 0 : window.scrollY);
  const visibleRef = useRef(false);
  const syncRef = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    let frame = 0;
    /* ⚠ 隐藏节点上绝不做判定。首页整层离开时是 display:none(.page-keep.is-hidden),
       此时 rect 全是 0 → 「不在视口内、也不在折叠线以下」;可一旦是**半隐藏**
       (层刚恢复显示、而 window 还没滚回离开时的位置),rect 就落回折叠线以下,
       → 判成「不可见」把 is-visible 摘掉。等滚动恢复完成再判回来要等好几帧,
       那几帧正好压在「二级页收拢回一级」上:业主看到的就是卡片缩回一个**空的**
       一级页,然后一级页的设计才「啪」地出现 —— 「接不回一级页面的设计」。
       所以先过 isRendered():祖先 display:none 或盒子塌成 0 时直接跳过,保留上一次
       的判定结果(首页离开时本来就停在「可见」)。 */
    const isRendered = () => {
      if (element.offsetParent === null && getComputedStyle(element).position !== 'fixed') return false;
      const b = element.getBoundingClientRect();
      return b.width > 0 || b.height > 0;
    };
    const syncVisibility = () => {
      if (!isRendered()) return;
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const currentScrollY = window.scrollY;
      const isScrollingDown = currentScrollY >= lastScrollYRef.current;
      const isInView = rect.top < viewportHeight * 0.92 && rect.bottom > viewportHeight * 0.08;
      const isWaitingBelow = rect.top >= viewportHeight * 0.92;

      lastScrollYRef.current = currentScrollY;

      if (isInView) {
        if (isScrollingDown || !visibleRef.current) {
          visibleRef.current = true;
          setVisible(true);
        }
        return;
      }

      if (isWaitingBelow) {
        visibleRef.current = false;
        setVisible(false);
      }
    };
    /* ⚠ 2026-10-10 性能 + 正确性:跨级转场期间(一级↔二级)一律不做可见性复查。
       性能:这段复查每次要读 offsetParent + getBoundingClientRect(各一次强制布局),
       而它有 5 处调用者(240ms 定时器、scroll、resize、IntersectionObserver、
       挂载后的双 rAF)。转场那 1 秒里页面**正处于不断被写样式的状态**,任何一次读
       都会把浏览器拽去做一趟同步布局 —— 归因里能看到它的布局栈就落在转场窗口内。
       正确性:更要紧的是,转场期间首页整层可能正处于"半隐藏"(层已离开、window 还没
       滚回原位),此时 rect 会落回折叠线以下,复查会把 is-visible 误摘掉 ——
       这正是上面 2134-2141 注释里那个「接不回一级页面的设计」的老 bug。
       跳过的那一次不会丢:转场结束会**主动补做一次**(见 scheduleCatchUp),
       而且 resync()/滚动/resize/IO 各自照旧,判定语义与原来完全一致。 */
    let catchUpTimer = 0;
    const holdUntil = () => Number(window.__measureHoldUntil || 0);
    const heldNow = () => holdUntil() > performance.now();
    const scheduleCatchUp = () => {
      if (catchUpTimer) return;
      const wait = Math.max(0, holdUntil() - performance.now()) + 40;
      catchUpTimer = window.setTimeout(() => { catchUpTimer = 0; syncVisibility(); }, wait);
    };
    /* 被转场挡下来的调用统一走这里:挡了就登记一次补偿复查。 */
    const syncOrDefer = () => {
      if (heldNow()) { scheduleCatchUp(); return; }
      syncVisibility();
    };
    /* 暴露给外部主动重算(首页重新可见时用):不必等滚动事件。 */
    syncRef.current = syncVisibility;

    const observer = new IntersectionObserver(
      ([entry]) => {
        /* 转场期间直接跳过并登记补偿:IO 回调同样要读 rect + offsetParent,
           而它在转场里会被反复唤起(每次布局变化都会重算相交)。 */
        if (heldNow()) { scheduleCatchUp(); return; }
        if (!isRendered()) return;
        const currentScrollY = window.scrollY;
        const isScrollingDown = currentScrollY >= lastScrollYRef.current;
        lastScrollYRef.current = currentScrollY;

        if (entry.isIntersecting) {
          if (isScrollingDown || !visibleRef.current) {
            visibleRef.current = true;
            setVisible(true);
          }
          return;
        }

        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        if (rect.top >= viewportHeight * 0.92) {
          visibleRef.current = false;
          setVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(syncVisibility);
    });
    /* 240ms 定时器 / scroll / resize 三条路径统一走 syncOrDefer:
       转场期间挡下并登记一次补偿复查,其余时候与原来逐字一致。
       (挂载后的双 rAF 不挡 —— 那是初次判定,不在转场里。) */
    const visibilityTimer = window.setInterval(syncOrDefer, 240);
    window.addEventListener('scroll', syncOrDefer, { passive: true });
    window.addEventListener('resize', syncOrDefer);

    return () => {
      syncRef.current = null;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearInterval(visibilityTimer);
      window.clearTimeout(catchUpTimer);
      window.removeEventListener('scroll', syncOrDefer);
      window.removeEventListener('resize', syncOrDefer);
    };
  }, [threshold, rootMargin]);

  /* 第三个返回值:主动重算(稳定引用)。首页从二级页回来时用它,见 HomePage。 */
  const resync = useCallback(() => { if (syncRef.current) syncRef.current(); }, []);
  return [ref, visible, resync];
}

function MorphNav({ page, navMotion, homeActiveSection, hasSharedWorksPill, activeCategory, activeIndex, total, goHome, goWorks, goWorksBack, goDetailByIndex, goDetailCategory }) {
  const isHome = page === 'home';
  const isDetail = page === 'detail';
  useDetailNavOnLight(isDetail);
  const activeCategoryIndex = Math.max(0, categories.findIndex((category) => category.id === activeCategory.id));
  const isFirst = activeIndex <= 0;
  const isLast = activeIndex >= total - 1;
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hideSharedWorksLabel = !isHome && !isDetail && hasSharedWorksPill;

  // Leaving the home page (works/detail) must never keep the mobile menu open.
  useEffect(() => {
    if (!isHome) setMobileMenuOpen(false);
  }, [isHome]);

  // One sliding underline for the home primary nav. The indicator is a single
  // independent element whose position is driven by the active item's box, so
  // swapping its inner content for an SVG later does not touch the motion.
  const homeNavRef = useRef(null);
  const indicatorRef = useRef(null);
  const navBoxesRef = useRef([]);
  const currentRef = useRef({ x: 0, w: 0 });
  const targetIndexRef = useRef(0);
  const lockIndexRef = useRef(-1);
  const lockTimerRef = useRef(0);
  const animRef = useRef(null);
  const rafRef = useRef(0);

  // Speed is the only constant: every transition of the four buttons moves at
  // the same px/ms in both directions, so Home -> Contact, Contact -> Home and
  // Contact -> About all feel identical. Only the duration scales with distance.
  const NAV_SPEED_PX_PER_MS = 0.5;
  const NAV_MIN_MS = 110;
  const NAV_MAX_MS = 520;
  // The first painted frame lands one frame after the click and the last one a
  // frame after the duration, so a raw distance/speed would run ~2 frames long
  // and short hops would look slower than long ones. The budget spends those
  // frames up front, which keeps every move at the same measured px/ms.
  const NAV_FRAME_BUDGET_MS = 32;

  // Four home screens map onto four nav items, one per screen.
  const itemIndexFromScroll = () => {
    const pageH = window.innerHeight || 1;
    const section = Math.min(3, Math.max(0, Math.round(window.scrollY / pageH)));
    return section;
  };

  // Written straight to the node instead of through state: no React re-render
  // per frame, so the slide keeps its timing and never drops a frame mid-move.
  const paint = (x, w) => {
    currentRef.current = { x, w };
    const el = indicatorRef.current;
    if (!el) return;
    el.style.transform = `translateX(${x}px)`;
    el.style.width = `${w}px`;
    el.style.opacity = w > 0 ? '1' : '0';
  };

  const step = (now) => {
    rafRef.current = 0;
    const anim = animRef.current;
    if (!anim) return;
    // Linear in time at a fixed px/ms: no easing, so speed never varies mid-slide.
    const q = Math.min(1, (now - anim.start) / anim.duration);
    paint(anim.fromX + (anim.toX - anim.fromX) * q, anim.fromW + (anim.toW - anim.fromW) * q);
    if (q < 1) rafRef.current = window.requestAnimationFrame(step);
    else animRef.current = null;
  };

  const moveTo = (index, immediate) => {
    const boxes = navBoxesRef.current;
    if (boxes.length < 4) return;
    const clamped = Math.min(Math.max(index, 0), boxes.length - 1);
    const dest = boxes[clamped];
    if (immediate) {
      if (rafRef.current) { window.cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
      animRef.current = null;
      targetIndexRef.current = clamped;
      paint(dest.x, dest.w);
      return;
    }
    // Already travelling to (or resting on) this item: let the current slide
    // finish. Restarting each frame would re-scale the remaining distance and
    // drag a slow tail behind every move.
    if (animRef.current && animRef.current.index === clamped) return;
    if (!animRef.current && targetIndexRef.current === clamped) return;
    targetIndexRef.current = clamped;
    const from = currentRef.current;
    if (Math.abs(dest.x - from.x) < 0.5 && Math.abs(dest.w - from.w) < 0.5) {
      animRef.current = null;
      paint(dest.x, dest.w);
      return;
    }
    animRef.current = {
      fromX: from.x,
      fromW: from.w,
      toX: dest.x,
      toW: dest.w,
      index: clamped,
      start: performance.now(),
      duration: Math.min(
        Math.max(Math.abs(dest.x - from.x) / NAV_SPEED_PX_PER_MS - NAV_FRAME_BUDGET_MS, NAV_MIN_MS),
        NAV_MAX_MS,
      ),
    };
    if (!rafRef.current) rafRef.current = window.requestAnimationFrame(step);
  };

  // A click owns the next transition: the bar glides straight to the clicked item
  // at the shared speed, ignoring intermediate sections until it arrives. That
  // is what removes the stop-over at About on the way to Contact.
  const lockTo = (index) => {
    lockIndexRef.current = index;
    if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = window.setTimeout(() => {
      lockIndexRef.current = -1;
    }, 1600);
    moveTo(index, false);
  };

  useLayoutEffect(() => {
    if (!isHome || !homeNavRef.current) return undefined;
    const links = Array.from(homeNavRef.current.querySelectorAll('a[data-home-nav-item]'));
    const measureBoxes = () => {
      navBoxesRef.current = links.map((el) => ({ x: el.offsetLeft, w: el.offsetWidth }));
    };
    measureBoxes();
    // Land on the correct item immediately on mount; do not animate into place.
    moveTo(itemIndexFromScroll(), true);
    const remeasure = window.requestAnimationFrame(() => {
      measureBoxes();
      moveTo(targetIndexRef.current, true);
    });
    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        const idx = itemIndexFromScroll();
        if (lockIndexRef.current >= 0 && idx !== lockIndexRef.current) return;
        lockIndexRef.current = -1;
        moveTo(idx, false);
      });
    };
    const onResize = () => { measureBoxes(); moveTo(targetIndexRef.current, true); };
    /* ★ 2026-10-10 业主：PC 右上角导航横线切换时有停顿感。
       根因（逐帧探针 .workbuddy/tools/probe-nav-underline-frames.mjs）：
       首页翻页是**自己画的逐帧 `window.scrollTo(0, y)`**（见 goToPage 注释），
       而内核把每一次滚动都当成一次独立的滚动序列，于是飞行途中 scrollend 被
       反复触发（实测点一次 About 触发 47 次、点 Contact 触发 8 次）。每一次都跑
       到这里：① 把点击锁清成 -1，② 按**当前还没跨过的那一屏**校正下划线。
       结果点击 Contact 时 y 还在第一屏 ⇒ 刚起步的线被拽回 Home，来回拉锯，
       最后落在 Portfolio 上而不是 Contact，观感就是「滑一下、停一下、跳一下」。
       ⇒ 翻页飞行中（html.is-flipping 由 goToPage 全程持有）收到的 scrollend
       一律当作内核误报，直接忽略。飞行结束那一帧才摘掉这个 class，之后的
       scrollend 才是真滚动结束，照常校正。 */
    const onScrollEnd = () => {
      if (document.documentElement.classList.contains('is-flipping')) return;
      lockIndexRef.current = -1;
      moveTo(itemIndexFromScroll(), false);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
      window.cancelAnimationFrame(remeasure);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
    };
  }, [isHome]);

  // Going back to the hero has to animate the same way going forward does, so
  // hand the jump to the pager (smooth). goHome()'s instant scrollTo(0, 0) is
  // only correct when arriving at home from another page.
  const goHomeWithScroll = (event) => {
    if (event && event.preventDefault) event.preventDefault();
    // Only the home page owns the pager and the hero section. Anywhere else
    // this is a real route change and must fall through to goHome().
    if (isHome) {
      lockTo(0);
      const pager = homePagerRef.current;
      if (pager && pager.jumpTo('hero')) return;
      const hero = document.getElementById('hero');
      if (hero) {
        hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    goHome();
  };

  // 修6（2026-10-09）：尾屏处于交互状态（demo 面板打开）时，点 FOUR 不回 hero，
  // 而是退出面板返回街角 —— 转发一次 click 给 iframe 内 demo 自己的 #back
  // （它的监听就是 demo 的 xf()：退出面板 + 相机平滑回程，转场动画原样保留）。
  // 同源 iframe，body[data-mode] 直读；iframe 未挂载/异常时照常回 hero。
  const goHomeFromLogo = (event) => {
    try {
      const frame = document.querySelector('iframe.street-contact-frame');
      const mode = frame && frame.contentDocument && frame.contentDocument.body.getAttribute('data-mode');
      if (mode && mode !== 'overview') {
        event.preventDefault();
        const back = frame.contentDocument.getElementById('back');
        if (back) back.click();
        return;
      }
    } catch (_) { /* iframe 未就绪，走常规回 hero */ }
    goHomeWithScroll(event);
  };

  const scrollToHomeSection = (event, id) => {
    event.preventDefault();
    // On a paged home the pager owns the scroll, and a raw scrollIntoView would
    // fight it and leave the wheel out of step. The pager is registered on a
    // module-level ref because the nav renders above HomePage.
    const pager = homePagerRef.current;
    if (pager && pager.jumpTo(id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    window.history.replaceState(null, '', `#${id}`);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <header
      className={`morph-nav nav-${page} motion-${navMotion}${isHome ? ' nav-home-shared' : ''}${hasSharedWorksPill ? ' has-shared-works-pill' : ''}${categoryOpen ? ' category-menu-open' : ''}`}
      style={{ '--active-index': activeCategoryIndex }}
    >
      {!isDetail && <button type="button" className="morph-logo" data-shared-logo-anchor="true" onClick={goHomeFromLogo} aria-label="FOUR Home"><LogoMark /></button>}
      {isHome && (
        <>
          <nav className="home-primary-items" aria-label="Primary navigation" ref={homeNavRef}>
            <a data-home-nav-item="0" className={homeActiveSection === 'hero' ? 'is-active' : ''} aria-current={homeActiveSection === 'hero' ? 'location' : undefined} href="#hero" onClick={goHomeWithScroll}>Home</a>
            <a data-home-nav-item="1" className={homeActiveSection === 'profile' ? 'is-active' : ''} aria-current={homeActiveSection === 'profile' ? 'location' : undefined} href="#profile" onClick={(event) => {
              lockTo(1);
              scrollToHomeSection(event, 'profile');
            }}>About</a>
            <a data-home-nav-item="2" className={homeActiveSection === 'projects' ? 'is-active' : ''} aria-current={homeActiveSection === 'projects' ? 'location' : undefined} href="#projects" onClick={(event) => {
              lockTo(2);
              scrollToHomeSection(event, 'projects');
            }}>Portfolio</a>
            <a data-home-nav-item="3" className={homeActiveSection === 'contact' ? 'is-active' : ''} aria-current={homeActiveSection === 'contact' ? 'location' : undefined} href="#contact" onClick={(event) => {
              lockTo(3);
              scrollToHomeSection(event, 'contact');
            }}>Contact</a>
            <span className="home-nav-indicator" aria-hidden="true" ref={indicatorRef} />
          </nav>
        </>
      )}
      {/* 汉堡常驻在所有层级(详见下方按钮注释):只有放在 isHome 之外,
          home→works 时它才能**带着退场动画**淡出,而不是被 React 直接卸载。 */}
      {/* Mobile: the four text links are folded away entirely; this burger
              is the only nav affordance. The lines morph into an X while the
              fullscreen panel fades in underneath the bar.
              2026-10-04: 常驻挂载(不再随 isHome 卸载)。汉堡 ⇄ 房子 icon 的
              交叉淡入淡出需要**两个元素都在场**——卸载式渲染没有 exit 动画,
              home→works 时汉堡会瞬间消失、房子瞬间出现(业主反馈"没有过渡")。
              非首页态由 CSS 置 opacity:0 + pointer-events:none,不可点不可见。 */}
          <button
            type="button"
            className={`mobile-menu-toggle${mobileMenuOpen ? ' is-open' : ''}`}
            aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu-panel"
            aria-hidden={!isHome}
            tabIndex={isHome ? 0 : -1}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
              {/* 2026-10-04 v6:四条线全部是 <path> —— 只有 path 的 d 能被 CSS
                  形变(<line> 的 x1/y1/x2/y2 是离散属性,没有补间)。
                  汉堡态的 d 写成"多条共线折线"(顶点个数 = 房子那笔的顶点数),
                  渲染出来仍是原来那三条横线,像素零变化。
                  配色即业主的示意图:绿=屋顶(3 个顶点)、蓝=门(拱形 ∩)、红=底边;
                  黄=左右两道墙,是**唯一被舍弃的一笔**(只淡出,不形变)。
                  三条线顶点一一对应、同一时长同一曲线 → 三条线一同复位。

                  ⚠ 两条硬性约束,改坐标前必读:
                  ① 两侧的**顶点个数必须完全相等**(否则 CSS 无法逐段补间,
                     整条 d 退化成硬切)。所以屋顶每侧 7 个点、门每侧 10 个点。
                  ② **不许出现弧命令**:弧在插值中途半径不足时会被浏览器按 SVG
                     规范"放大到连接两端点",凭空冒出一个大拱(见 mobile.css 硬规矩 ②)。
                     圆角一律用"多顶点折线逼近圆弧"来画 —— 静止态这些点全在
                     同一条横线上(共线),渲染与旧版逐像素相同。 */}

              {/* 绿:屋顶。房子态 = 左屋檐弧(r2) + 圆角屋脊(r2) + 右屋檐弧(r2),
                  三条弧都是 lucide v1.47 House 的原始弧采样成折线(屋脊顶点
                  正好落在 (16,6),与 PC 端 <House size={15}> 逐点一致)。
                  汉堡态把这 13 个顶点按**弧长比例**摊到 y=10.5 的横线上 ——
                  两端的屋檐弧簇留在两端、屋脊 5 点挤在中段(14.87~17.13),
                  所以展开时两端屋檐大幅摆动、屋脊近乎原地沉下去,也就是业主说的
                  "拉直左右顶点并控制左右顶点长度"。 */}
              <path className="hm-line hm-top" d="M 6 10.5 L 6.468 10.5 L 6.935 10.5 L 7.403 10.5 L 14.869 10.5 L 15.435 10.5 L 16 10.5 L 16.565 10.5 L 17.131 10.5 L 24.597 10.5 L 25.065 10.5 L 25.532 10.5 L 26 10.5" />

              {/* 蓝:门。房子态 = 两条腿 + 圆角门梁(每角 r1,同 lucide)。
                  汉堡态门像被向外掀开一样摊平:两条腿的底端走向横线两端,
                  门梁那一簇留在中段。 */}
              <path className="hm-line hm-mid" d="M 6 16 L 12.925 16 L 13.373 16 L 13.821 16 L 14.269 16 L 17.731 16 L 18.179 16 L 18.627 16 L 19.075 16 L 26 16" />

              {/* 红:底边。房子态两端各带一个 r2 的底角弧(把墙的底端与底边接圆),
                  所以它的"端点"其实在 y=23 的墙上,不是 y=25 的底边。 */}
              <path className="hm-line hm-bot" d="M 6 21.5 L 7.024 21.5 L 8.049 21.5 L 9.073 21.5 L 22.927 21.5 L 23.951 21.5 L 24.976 21.5 L 26 21.5" />

              {/* 黄:左右两道墙。lucide 的墙是 (7,14)→(7,23) —— 上下两端正好是
                  屋檐弧与底角弧的切点。不参与 d 形变,只淡出。 */}
              <path className="hm-line hm-wall" d="M 7 14 L 7 23 M 25 14 L 25 23" />
            </svg>
          </button>
          {/* The panel portals to <body>: .morph-nav has transform + contain:paint,
              which would trap a fixed-position child inside the 78px bar.
              面板仍只在首页挂载:离开首页时菜单必然已关闭(点链接会关),
              不存在「面板在别的层级残留」的情况。 */}
          {isHome && createPortal(
            <nav
              id="mobile-menu-panel"
              className={`mobile-menu${mobileMenuOpen ? ' is-open' : ''}`}
              aria-label="Mobile primary navigation"
              aria-hidden={!mobileMenuOpen}
              onClick={(event) => { if (event.target === event.currentTarget) setMobileMenuOpen(false); }}
              onWheel={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
            >
              <a className={homeActiveSection === 'hero' ? 'is-active' : ''} href="#hero" onClick={(event) => { setMobileMenuOpen(false); goHomeWithScroll(event); }}>Home</a>
              <a className={homeActiveSection === 'profile' ? 'is-active' : ''} href="#profile" onClick={(event) => { setMobileMenuOpen(false); lockTo(1); scrollToHomeSection(event, 'profile'); }}>About</a>
              <a className={homeActiveSection === 'projects' ? 'is-active' : ''} href="#projects" onClick={(event) => { setMobileMenuOpen(false); lockTo(2); scrollToHomeSection(event, 'projects'); }}>Portfolio</a>
              <a className={homeActiveSection === 'contact' ? 'is-active' : ''} href="#contact" onClick={(event) => { setMobileMenuOpen(false); lockTo(3); scrollToHomeSection(event, 'contact'); }}>Contact</a>
            </nav>,
            document.body
          )}
      {isDetail && (
        <button type="button" className="detail-nav-back" onClick={goWorksBack}>
          <svg className="detail-nav-back-icon" viewBox="0 0 10 18" aria-hidden="true">
            <path d="M8.5 1.5L1.5 9l7 7.5" />
          </svg>
          Back
        </button>
      )}
      <nav className="works-nav-items" aria-hidden={isHome || isDetail}>
        <span className="works-nav-indicator" aria-hidden="true" />
        {categories.map((category) => (
          <button
            type="button"
            key={category.id}
            data-category-pill={category.id}
            className={category.id === activeCategory.id ? 'active' : ''}
            aria-label={category.title}
            onClick={() => {
              /* ⚠ 这里**不能**用 App 内那个 morphLocked()：本组件在 App 外面，
                 拿不到它的闭包 → 点击会抛 ReferenceError，表现就是点了没反应
                 （2026-10-10 业主实测：移动端与 PC 端导航选项全部点不动）。
                 所以直接用同一个全局标志做判定。 */
              if (performance.now() < (window.__worksMorphUntil || 0)) return;
              goWorks(category.id);
            }}
          >
            {hideSharedWorksLabel && category.id === activeCategory.id ? null : category.title}
          </button>
        ))}
      </nav>
      {isDetail && (
        <div className="detail-pager">
          <button type="button" disabled={isFirst} onClick={() => goDetailByIndex(activeIndex - 1)}>
            <span className="pager-triangle pager-triangle-left" aria-hidden="true" />
            Last
          </button>
          <span>{String(activeIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
          <button type="button" disabled={isLast} onClick={() => goDetailByIndex(activeIndex + 1)}>
            Next
            <span className="pager-triangle pager-triangle-right" aria-hidden="true" />
          </button>
        </div>
      )}
      {isDetail ? (
        <div className={`detail-category-select${categoryOpen ? ' is-open' : ''}`} onMouseLeave={() => setCategoryOpen(false)}>
          <button
            type="button"
            className="detail-category-trigger"
            data-detail-category-pill="true"
            aria-label={activeCategory.title}
            onClick={() => setCategoryOpen((open) => !open)}
          >
            <span className="detail-category-chevron" />
          </button>
          <div className="detail-category-menu">
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                className={category.id === activeCategory.id ? 'active' : ''}
                onClick={() => {
                  setCategoryOpen(false);
                  goDetailCategory(category.id);
                }}
              >
                {category.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        // 2026-10-04: 房子 icon 在首页也常驻挂载(此前 isHome → null)。
        // 汉堡 ⇄ 房子的交叉过渡需要两端都在场;首页态由 CSS 置透明+缩小。
        <button type="button" className="morph-home-pill" onClick={goHome} aria-label="Home" aria-hidden={isHome} tabIndex={isHome ? -1 : 0}><House size={15} strokeWidth={2} />Home</button>
      )}
    </header>
  );
}

function ShowcaseDeck({ items, openWorks }) {
  const [stageRef, visible] = useRevealOnView({ threshold: 0.16, rootMargin: '0px 0px -6% 0px' });
  const [hovered, setHovered] = useState(-1);

  // Hovering a card lifts it to the front and pushes the others sideways: the
  // cards to its left travel further left, the ones to its right travel further
  // right. That is what makes the row open up, and it is why moving from
  // card 1 to card 2 makes card 1 drop back and slide left again.
  // 2026-10-08:11 张卡比原先 7 张紧(步长 7.0%)，推挤量收小到 22px，避免邻卡
  // 被推到整排之外；抬起量按卡放大的比例回补到 -44px。
  const PUSH = 24;      // px a neighbour shifts away from the hovered card
  const PUSH_CAP = 3;   // neighbours further than this many steps move no more
  const LIFT = -48;     // px the hovered card rises off the floor

  // 2026-10-09:倒影与卡片拆成两层渲染。渐隐 mask 挂在 .showcase-deck-mirrors
  // 容器上统一做（见 styles.css），倒影本身不透明 —— 否则相邻倒影的重叠区会
  // 互相透底（业主指出：11 卡压着 10 卡，倒影里却能看到 10 的像，逻辑错误）。
  const mirrorOf = (index) => {
    const active = index === hovered;
    const distance = index - hovered;
    const push = hovered < 0 || active
      ? 0
      : Math.sign(distance) * Math.min(Math.abs(distance), PUSH_CAP) * PUSH;
    return { active, push };
  };

  return (
    <div
      ref={stageRef}
      className={`showcase-deck${visible ? ' is-visible' : ''}`}
      onPointerLeave={() => setHovered(-1)}
    >
      <div className="showcase-deck-mirrors" aria-hidden="true">
        {items.map(({ project, cover }, index) => {
          const { active, push } = mirrorOf(index);
          return (
            <span
              key={project.id}
              className={`showcase-deck-reflection${active ? ' is-active' : ''}`}
              style={{
                '--x': `${project.deck.left}%`,
                '--rot': active ? 0 : project.deck.rot,
                '--y': active ? LIFT : project.deck.restY,
                '--mirror-push': `${push}px`,
                '--z': active ? 60 : project.deck.z
              }}
            >
              <LazyImage src={cover} alt="" aria-hidden="true" />
            </span>
          );
        })}
      </div>
      {items.map(({ project, cover }, index) => {
        const { active, push } = mirrorOf(index);

        const deckVars = {
          '--x': `${project.deck.left}%`,
          '--rot': active ? 0 : project.deck.rot,
          '--y': active ? LIFT : project.deck.restY,
          '--push': push,
          '--scale': active ? 1.06 : 1,
          '--z': active ? 60 : project.deck.z,
          '--i': index
        };

        return (
          <div
            key={project.id}
            className={`showcase-deck-card${active ? ' is-active' : ''}`}
            style={deckVars}
            onPointerEnter={() => setHovered(index)}
            onFocus={() => setHovered(index)}
            onBlur={(event) => {
              // Only drop the card when focus truly leaves it, not on the
              // card -> button hand-off inside the same card.
              if (!event.currentTarget.contains(event.relatedTarget)) setHovered(-1);
            }}
          >
            <button
              type="button"
              className="showcase-deck-button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openWorks(project.category, false, {
                  workId: project.id,
                  rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                  src: cover
                });
              }}
            >
              <LazyImage src={cover} alt="" aria-hidden="true" />
              <span className="showcase-deck-scrim" aria-hidden="true" />
              <span className="showcase-deck-copy">
                <em>{project.index}</em>
                <strong>{project.title}</strong>
                <b>{project.meta}</b>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* Mobile-only works showcase: a three-card poker stack.
   - Only the left / centre / right cards are ever visible (|eff| > 1.3 hidden).
   - Flipping left: the right card stacks up to cover the centre, the former
     centre card stacks down to the left, and the old left card is tucked back
     into the deck (slides right + sinks + fades) while the next card is drawn
     out from the deck to the right.
   - The centre card follows the finger 1:1 in any direction with a 3D tilt;
     the other two cards parallax along.
   - Tapping a side card switches to it; tapping the front card opens works.
   - Auto-plays every 2.4s; pauses while dragging.
   The PC ShowcaseDeck (hover fan) is untouched. */
function MobileShowcaseDeck({ items, openWorks, active = true, focusId = '', chromeHidden = false, chromeIn = false, deckVeiled = false }) {
  const deckRef = useRef(null);
  const cardRefs = useRef([]);
  const dimRefs = useRef([]);
  const thumbRefs = useRef([]);
  const dotRefs = useRef([]);
  const counterRef = useRef(null);
  const stripRef = useRef(null);
  const ctxRef = useRef({ items, openWorks });
  ctxRef.current = { items, openWorks };
  // 自动轮播只在首页可见时推进:此前它在隐藏层里照样每 3.4s 翻一张,
  // 用户从二级页返回时看到的已经不是离开时那张卡 —— 回程的「卡片缩回首页
  // 卡组」覆盖层会因为落点卡被换掉而错位(业主 2026-10-07 反馈的跳帧)。
  const activeRef = useRef(active);
  activeRef.current = active;

  const RANGE = 150, COMMIT = 62, FLICK = 0.45;
  const CL = (v, a, b) => Math.max(a, Math.min(b, v));
  // Auto-rotation cadence. Starts a fresh cooldown after every manual flip
  // (drag / thumbnail tap) so the carousel never fires the instant a user
  // finishes turning a card.
  const CAROUSEL_INTERVAL = 3400;
  const carouselTimerRef = useRef(0);
  const scheduleCarouselRef = useRef(null);

  const rel = (i, active) => {
    const N = ctxRef.current.items.length;
    let r = i - active;
    while (r > N / 2) r -= N;
    while (r < -N / 2) r += N;
    return r;
  };

  /* Poker-deck pose: segment-wise asymmetric, like the reference screenshot.
     SIDE_OFFSET scales with the card: the deck is sized from the stage height
     (see .mob-stage) and the side cards keep a constant fraction of the card
     width, so enlarging the whole component means raising both together. */
  const SIDE_OFFSET = 81;
  const poseAt = (eff) => {
    if (eff >= 0) {
      if (eff <= 1) {                                  // right slot -> centre (covers up)
        const f = eff;
        return { x: SIDE_OFFSET * f, s: 1 - 0.14 * f, r: 8 * f, dim: 0.62 * f, o: 1 };
      }
      const f = CL(eff - 1, 0, 1);                     // 0 (right slot) -> 1 (inside deck)
      return {
        x: SIDE_OFFSET * (1 - f), s: 0.86 + 0.09 * f, r: 8 * (1 - f),
        dim: 0.62 + 0.18 * f,
        o: 1 - CL((f - 0.5) / 0.5, 0, 1),
      };
    }
    if (eff >= -1) {                                   // centre -> left slot
      const f = -eff;
      return { x: -SIDE_OFFSET * f, s: 1 - 0.14 * f, r: -8 * f, dim: 0.62 * f, o: 1 };
    }
    const f = CL(-eff - 1, 0, 1);                      // left slot -> back into deck (slides right)
    return {
      x: -SIDE_OFFSET * (1 - f), s: 0.86 + 0.09 * f, r: -8 * (1 - f),
      dim: 0.62 + 0.18 * f,
      o: 1 - CL((f - 0.5) / 0.5, 0, 1),
    };
  };
  const zFor = (eff) => {
    if (eff > 0.5) return eff < 1.5 ? 2 : 1;
    if (eff < -0.5) return eff > -1.5 ? 2 : 0;
    return 3;
  };

  /* 读一张卡的**实测视觉姿态**(不受 transform 影响的布局高 + 受 transform 影响的
     中心/缩放/旋转)。跨级转场要把一级卡组里主卡与副卡的姿态原样交给二级轨道,
     二级轨道据此让「同一张卡」从原位接着动。旋转/缩放从 computed matrix 里解:
     a = s·cosθ、b = s·sinθ → s = hypot(a,b)、θ = atan2(b,a)。 */
  const poseOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    let scale = 1;
    let rot = 0;
    try {
      const m = new DOMMatrix(getComputedStyle(el).transform);
      scale = Math.hypot(m.a, m.b) || 1;
      rot = Math.atan2(m.b, m.a) * 180 / Math.PI;
    } catch (_) { /* 老浏览器没有 DOMMatrix:退化成纯位移/缩放,视觉差异可忽略 */ }
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, scale, rot, h: el.offsetHeight };
  };

  const stateRef = useRef({
    active: 0, p: 0, isDrag: false, moved: false,
    startX: 0, startY: 0, curDX: 0, curDY: 0, lastDX: 0, vel: 0, downIdx: 0,
  });


  const render = () => {
    const N = ctxRef.current.items.length;
    const s = stateRef.current;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = rel(i, s.active);
      // ⚠ 抬手「抬卡」(scale .985)必须等真的拖动了(s.moved)才生效:
      //   只按不拖时若立刻缩到 .985,卡片会在按下那一帧**瞬缩 1.5%**
      //   (render 把 transition 设成 none,是硬跳)。首页点卡放大接入二级页
      //   的覆盖层起点就是按这个矩形量的 —— 于是「无缝放大」的第一帧先要
      //   补一个缩小,业主看到的就是一次跳帧。改为意图驱动后,点按(不拖)
      //   全程停在静止态,覆盖层 rect 与用户看到的那一帧完全一致。
      const isMain = s.isDrag && s.moved && Math.abs(r) < 0.5;
      let transform, z, dim, op, front = false;
      if (isMain) {
        transform =
          `translate(-50%, -50%) translateX(${s.curDX}px) translateY(${s.curDY}px)` +
          ` rotateX(${CL(-s.curDY * 0.05, -9, 9)}deg) rotateY(${CL(s.curDX * 0.05, -9, 9)}deg)` +
          ` rotate(${CL(s.curDX * 0.04, -8, 8)}deg) scale(.985)`;
        z = 3; dim = 0; op = 1;
      } else {
        const eff = CL(r + s.p, -2.05, 2.05);
        const pose = poseAt(eff);
        const par = s.isDrag ? 0.16 : 0;
        transform =
          `translate(-50%, -50%) translateX(${pose.x + s.curDX * par}px) translateY(${s.curDY * par}px)` +
          ` rotate(${pose.r}deg) scale(${pose.s})`;
        z = zFor(eff); dim = pose.dim; op = pose.o;
        front = !s.isDrag && z === 3;
      }
      // 内联 transition 覆盖卡面 CSS；保留位移、透明度与投影声明，
      // 两级卡片圆角统一为 20px，不再列入动画属性。
      el.style.transition = s.isDrag ? 'none' :
        'transform .58s cubic-bezier(.26,1.24,.44,1), opacity .38s ease,' +
        ' box-shadow .52s cubic-bezier(.22,1,.36,1)';
      el.style.transform = transform;
      /* ⚠ opacity === 1 时必须**摘掉**内联值、不能写死 1(2026-10-08 第14轮):
         元素一旦带 opacity 属性(哪怕值就是 1),加上 CSS 的 will-change,
         这一层会被标记成「可能带透明」,合成时走非不透明路径;而二级卡的
         transform 挂在父级 .mw-slide(只有 will-change:transform,层是不透明的)。
         两级的合成路径不同 → 落定帧上整张卡的颜色/亮度有极细微差异,
         正是业主第14轮反馈的「副卡不是位置变了,而是明亮变了一点」。
         值为 1 时摘属性,让一级卡与二级卡走同一条不透明合成路径;
         真正要淡出(eff > 1,卡片绕到卡组背后)时再写回。 */
      if (op >= 1) el.style.removeProperty('opacity');
      else el.style.opacity = op;
      el.style.zIndex = z;
      const dimEl = dimRefs.current[i];
      if (dimEl) dimEl.style.opacity = dim;
      el.classList.toggle('front', front);
      el.classList.toggle('lift', isMain);
    });

    const show = ((s.active % N) + N) % N;
    if (counterRef.current) {
      counterRef.current.textContent =
        `${String(show + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
    }
    thumbRefs.current.forEach((th, i) => {
      if (!th) return;
      const on = i === show;
      th.classList.toggle('on', on);
      // Centre the active thumbnail inside the strip's OWN horizontal scroller.
      // The strip is overflow-x:auto, so scrollLeft never moves the page. A
      // bare scrollIntoView({block:'nearest'}) would instead scroll the window
      // vertically and, because the deck lives on the projects screen, fling
      // the whole home page down to it on first paint ("opens on works").
      if (on) {
        const strip = th.parentElement;
        if (strip && strip.scrollWidth > strip.clientWidth) {
          const target = th.offsetLeft - (strip.clientWidth - th.clientWidth) / 2;
          strip.scrollTo({ left: target, behavior: 'smooth' });
        }
      }
    });
    dotRefs.current.forEach((d, i) => { if (d) d.classList.toggle('on', i === show); });
  };

  const goTo = (idx) => {
    const N = ctxRef.current.items.length;
    const s = stateRef.current;
    s.active = ((idx % N) + N) % N;
    s.p = 0; s.curDX = 0; s.curDY = 0; s.isDrag = false;
    if (deckRef.current) deckRef.current.classList.remove('grabbing');
    render();
  };

  // Keep latest closures reachable from the long-lived listeners.
  const renderRef = useRef(render);
  const goToRef = useRef(goTo);
  renderRef.current = render;
  goToRef.current = goTo;

  const ptOf = (e) => (e.touches && e.touches[0] ? e.touches[0] : e);

  const onDown = (e) => {
    const s = stateRef.current;
    const q = ptOf(e);
    const cardEl = e.target.closest('.mob-card');
    s.downIdx = cardEl ? Number(cardEl.dataset.idx) : s.active;
    s.isDrag = true; s.moved = false;
    s.startX = q.clientX; s.startY = q.clientY;
    s.curDX = 0; s.curDY = 0; s.lastDX = 0; s.vel = 0;
    if (e.pointerId !== undefined && deckRef.current && deckRef.current.setPointerCapture) {
      try { deckRef.current.setPointerCapture(e.pointerId); } catch (_) {}
    }
    if (e.cancelable) e.preventDefault();
    if (deckRef.current) deckRef.current.classList.add('grabbing');
    // Pause auto-rotation while the user is interacting with the deck.
    if (carouselTimerRef.current) {
      window.clearTimeout(carouselTimerRef.current);
      carouselTimerRef.current = 0;
    }
    renderRef.current();
  };
  const onMove = (e) => {
    const s = stateRef.current;
    if (!s.isDrag) return;
    const q = ptOf(e);
    s.curDX = q.clientX - s.startX;
    s.curDY = q.clientY - s.startY;
    s.vel = s.curDX - s.lastDX; s.lastDX = s.curDX;
    if (Math.abs(s.curDX) > 8 || Math.abs(s.curDY) > 8) s.moved = true;
    s.p = Math.max(-1.25, Math.min(1.25, s.curDX / RANGE));
    if (e.cancelable) e.preventDefault();
    renderRef.current();
  };
  const onUp = (e) => {
    const s = stateRef.current;
    if (!s.isDrag) return;
    s.isDrag = false;
    if (e.pointerId !== undefined && deckRef.current && deckRef.current.releasePointerCapture) {
      try { deckRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    if (deckRef.current) deckRef.current.classList.remove('grabbing');
    if (!s.moved) {
      if (s.downIdx === s.active) {
        const item = ctxRef.current.items[s.active];
        if (item) {
          // 2026-10-07 移动端:进二级页用「轨道自己执行跨级转场」。
          // ⚠ 连**副卡**的姿态一起交出去(业主第三轮反馈第 1 条):一级卡组里
          //   左右两张卡此刻已经摆在主卡两侧(±81px、0.86 倍、±8° 倾斜),
          //   如果二级轨道让副卡从主卡身后「凭空抽出来」,那两张卡就是换了一张。
          //   把它们的实测姿态(相对主卡中心的偏移 / 缩放 / 旋转)交给轨道,副卡
          //   就能从「一级里它原来的位置」接着动 —— 两级之间是同一张卡。
          const N = ctxRef.current.items.length;
          const frontEl = cardRefs.current[s.active];
          const self = poseOf(frontEl);
          const prev = poseOf(cardRefs.current[(s.active - 1 + N) % N]);
          const next = poseOf(cardRefs.current[(s.active + 1) % N]);
          const relPose = (p) => (p && self
            ? { dx: p.cx - self.cx, dy: p.cy - self.cy, scale: p.scale, rot: p.rot }
            : null);
          const rect = frontEl ? frontEl.getBoundingClientRect() : null;
          ctxRef.current.openWorks(item.project.category, false, {
            workId: item.project.id,
            rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
            src: item.cover,
            cardH: self ? self.h : null,
            prevPose: relPose(prev),
            nextPose: relPose(next)
          });
        }
      } else {
        goToRef.current(s.downIdx);
      }
      // ⚠ 必须重渲染:按下那一刻的 render(isDrag=true)已经把 .front 摘掉了。
      //   若在这里直接 return,类名就永远缺失 —— 表现为「点卡进二级页再返回后,
      //   首页主卡的阴影比两侧副卡还浅」(.mob-card.front 的 24px/56px 阴影丢了)。
      //   goTo 分支内部自己会 render,这里统一再走一次是幂等的(静止态重写同样的
      //   静止 transform),不会引入过渡或跳变。
      renderRef.current();
      if (scheduleCarouselRef.current) scheduleCarouselRef.current();
      return;
    }
    if (Math.abs(s.curDX) > COMMIT || Math.abs(s.vel) > FLICK) {
      const N = ctxRef.current.items.length;
      s.active = (s.active + (s.curDX < 0 ? 1 : -1) + N * 2) % N;
    }
    s.p = 0;
    renderRef.current();
    // The user just finished a flip (or a tap): restart the cooldown so the
    // carousel waits a full interval before its next automatic turn.
    if (scheduleCarouselRef.current) scheduleCarouselRef.current();
  };

  useLayoutEffect(() => {
    const deck = deckRef.current;
    if (!deck) return undefined;
    const onD = (e) => onDown(e);
    const onM = (e) => onMove(e);
    const onU = (e) => onUp(e);
    if (window.PointerEvent) {
      deck.addEventListener('pointerdown', onD);
      deck.addEventListener('pointermove', onM);
      deck.addEventListener('pointerup', onU);
      deck.addEventListener('pointercancel', onU);
    } else {
      deck.addEventListener('touchstart', onD, { passive: false });
      deck.addEventListener('touchmove', onM, { passive: false });
      deck.addEventListener('touchend', onU);
      deck.addEventListener('touchcancel', onU);
      deck.addEventListener('mousedown', onD);
      window.addEventListener('mousemove', onM);
      window.addEventListener('mouseup', onU);
    }
    renderRef.current();

    // Auto-rotation: a self-rescheduling timeout (not a fixed interval). Each
    // manual flip taps scheduleCarousel() to restart the full cooldown, so the
    // next automatic turn is always CAROUSEL_INTERVAL after the user lets go —
    // never an instant flip right after they finished turning a card.
    function scheduleCarousel() {
      if (carouselTimerRef.current) window.clearTimeout(carouselTimerRef.current);
      carouselTimerRef.current = window.setTimeout(tickCarousel, CAROUSEL_INTERVAL);
    }
    function tickCarousel() {
      // 首页不可见(在二级/三级页)时不推进:见 activeRef 注释。
      if (activeRef.current && !stateRef.current.isDrag) goToRef.current(stateRef.current.active + 1);
      scheduleCarousel();
    }
    scheduleCarouselRef.current = scheduleCarousel;
    scheduleCarousel();

    return () => {
      if (carouselTimerRef.current) window.clearTimeout(carouselTimerRef.current);
      if (window.PointerEvent) {
        deck.removeEventListener('pointerdown', onD);
        deck.removeEventListener('pointermove', onM);
        deck.removeEventListener('pointerup', onU);
        deck.removeEventListener('pointercancel', onU);
      } else {
        deck.removeEventListener('touchstart', onD);
        deck.removeEventListener('touchmove', onM);
        deck.removeEventListener('touchend', onU);
        deck.removeEventListener('touchcancel', onU);
        deck.removeEventListener('mousedown', onD);
        window.removeEventListener('mousemove', onM);
        window.removeEventListener('mouseup', onU);
      }
    };
  }, []);

  /* 首页可见性变化:回到首页时**重置冷却**。
     只有一个 tickCarousel 的 if 守卫不够 —— 计时器在离开首页期间照样到点,
     只是那次被跳过了,下一次到点(≤3.4s 后)完全可能正好落在「刚回到首页」
     的那一帧:卡组当场翻一张,回程的落点卡被挪走(探针实测交接帧的
     .mob-card.front 是旋转 8° 的侧位卡,偏差 -75.6px)。这里在 active 翻真
     的同一提交里重排冷却,回程后 3.4s 内卡组不会自己动。 */
  useLayoutEffect(() => {
    if (active && scheduleCarouselRef.current) scheduleCarouselRef.current();
    return undefined;
  }, [active]);

  /* 外部指定焦点(2026-10-07,二级页返回一级)。
     回程时二级轨道要把主卡收回「首页卡组里的那张卡」,落点必须真的是用户
     正在看的那张 —— 而首页卡组停留在离开时的那张,用户可能在二级页滑了好几
     张。于是 goHome 把当前作品 id 传下来,这里**无过渡**瞬移到位:
     瞬移发生在回程期间,此刻二级页整层盖在首页之上,位移过程用户看不见。
     做法复用 render 的 isDrag 分支(它把 transition 写成 none),写完强制回流
     再交回静止态,避免从旧位置补间过去。 */
  useLayoutEffect(() => {
    if (!focusId) return undefined;
    const idx = ctxRef.current.items.findIndex((it) => it.project.id === focusId);
    if (idx < 0) return undefined;
    const s = stateRef.current;
    if (s.active === idx && !s.p && !s.curDX && !s.curDY) return undefined;
    s.active = idx; s.p = 0; s.curDX = 0; s.curDY = 0; s.moved = false;
    const wasDrag = s.isDrag;
    s.isDrag = true;                       // → render 会把 transition 置 none
    renderRef.current();
    void (deckRef.current ? deckRef.current.offsetWidth : 0);   // 强制回流吞掉位移
    s.isDrag = wasDrag;
    renderRef.current();
    return undefined;
  }, [focusId]);

  /* Thumbnail strip: horizontal drag-to-scroll for mouse/pen pointers (real
     touch devices pan natively via touch-action:pan-x, and the home pager's
     touchmove handler exempts touches that start on the strip). A drag that
     actually scrolled suppresses the following click, so a drag never also
     selects a thumbnail. */
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    let active = false, moved = false, startX = 0, startLeft = 0;
    const onDown = (e) => {
      if (e.pointerType === 'touch') return;
      active = true; moved = false;
      startX = e.clientX; startLeft = strip.scrollLeft;
    };
    const onMove = (e) => {
      if (!active || e.pointerType === 'touch') return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        strip.classList.add('dragging');
        try { strip.setPointerCapture(e.pointerId); } catch (_) {}
      }
      if (moved) {
        strip.scrollLeft = startLeft - dx;
        if (e.cancelable) e.preventDefault();
      }
    };
    const onUp = () => {
      active = false;
      strip.classList.remove('dragging');
    };
    const onClick = (e) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    };
    strip.addEventListener('pointerdown', onDown);
    strip.addEventListener('pointermove', onMove);
    strip.addEventListener('pointerup', onUp);
    strip.addEventListener('pointercancel', onUp);
    strip.addEventListener('click', onClick, true);
    return () => {
      strip.removeEventListener('pointerdown', onDown);
      strip.removeEventListener('pointermove', onMove);
      strip.removeEventListener('pointerup', onUp);
      strip.removeEventListener('pointercancel', onUp);
      strip.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <div className={`mob-showcase${chromeHidden ? ' is-chrome-out' : ''}${chromeIn ? ' is-chrome-in' : ''}${deckVeiled ? ' is-deck-veiled' : ''}`}>
      <h2 className="mob-heading rany-display-heading">Project Display</h2>
      <div className="mob-counter" ref={counterRef}>01 / 11</div>

      <div className="mob-stage">
        <div className="mob-deck" ref={deckRef}>
          {items.map(({ project, cover }, i) => (
            <div
              className="mob-card"
              key={project.id}
              data-idx={i}
              data-deck-work={project.id}
              ref={(el) => { cardRefs.current[i] = el; }}
            >
              <LazyImage className="mob-card-img" src={cover} alt="" />
              <div className="mob-veil" />
              <div className="mob-dim" ref={(el) => { dimRefs.current[i] = el; }} />
              <div className="mob-copy">
                <strong className="mob-title">{project.title}</strong>
                <b className="mob-meta">{project.meta}</b>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mob-dots">
        {items.map((it, i) => (
          <i key={i} ref={(el) => { dotRefs.current[i] = el; }} />
        ))}
      </div>
      {/* 2026-10-09 业主反馈:移除「查看全部」按钮(一级页元素过多、缩览图条被顶到贴底)。
          onClick 原走 ctxRef.current.openWorks('ui'),二级页入口仍由主卡上滑/点卡承担。 */}
      <div className="mob-thumbs" ref={stripRef}>
        {items.map(({ project, cover43 }, i) => (
          <div
            className="mob-thumb"
            key={project.id}
            ref={(el) => { thumbRefs.current[i] = el; }}
            onClick={() => { goToRef.current(i); if (scheduleCarouselRef.current) scheduleCarouselRef.current(); }}
          >
            {/* 缩览图是 4:3(.mob-thumb aspect-ratio: 4/3),与主卡的 3:5 不同,
                所以单独取 cover43 —— 原先与主卡共用一张 16:9,每侧被裁掉 12.5%。 */}
            <LazyImage src={cover43} alt="" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Reveal({ as: Tag = 'div', className = '', children, threshold = 0.18, rootMargin = '0px 0px -10% 0px' }) {
  const [ref, visible] = useRevealOnView({ threshold, rootMargin });
  return (
    <Tag ref={ref} className={`${className}${visible ? ' is-visible' : ''}`}>
      {children}
    </Tag>
  );
}

/* 已被 loading 期预载成功的图：**直接上 src，不走 IntersectionObserver**。
   ⚠ 2026-10-13 微信移动端实测（业主反馈"滑到作品页 3:5 封面还是没加载出来"）：
   `LazyImage` 的判据是"元素进入视口"，而首页卡组(.mob-card)是 3D 变换的卡堆、
   副卡常年半出屏，`rootMargin` 用的还是百分比（100% 0px 100% 0px）——
   iOS 版 WebKit / 微信 X5 对百分比 rootMargin 与变换容器里的 IO 回调时机都不可靠，
   出现过"卡已经滑到眼前、src 还没被赋上"的空卡。
   这些图**本来就已经在内存里**（loading 期付过费了），早挂 src 不会多下一个字节，
   却能把上面那类内核差异整条绕过去 —— 等于把"懒"降级成"预载 + 立即上屏"。
   预载完成是异步的，所以用订阅：预载到哪张，已经在 DOM 里的卡片就立刻挂哪张。 */
const preloadedImageSrcs = new Set();
const preloadSubscribers = new Set();
function markImagePreloaded(src) {
  if (!src || preloadedImageSrcs.has(src)) return;
  preloadedImageSrcs.add(src);
  preloadSubscribers.forEach((fn) => { try { fn(src); } catch (_) { /* noop */ } });
}

/* Lazy-loads an image: the real src is only assigned once the element is within
   one viewport of the screen, so flipping to the next paged screen already has
   its images ready. No placeholder is used; the surrounding layout reserves the
   space via CSS aspect-ratio or fixed dimensions. */
function LazyImage({ src, alt = '', className, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return undefined;
    /* 预载过的（以及没有 IO 的环境）：立即上 src —— 见 preloadedImageSrcs 的注释 */
    if (preloadedImageSrcs.has(src)) {
      el.src = src;
      return undefined;
    }
    let io = null;
    const arm = (hit) => {
      if (hit === src && !el.src) {
        el.src = src;
        if (io) io.disconnect();
      }
    };
    preloadSubscribers.add(arm);
    if (typeof IntersectionObserver === 'undefined') {
      el.src = src;
      preloadSubscribers.delete(arm);
      return undefined;
    }
    io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.src = src;
          io.disconnect();
        }
      },
      { root: null, rootMargin: '100% 0px 100% 0px', threshold: 0 }
    );
    io.observe(el);
    return () => { preloadSubscribers.delete(arm); io.disconnect(); };
  }, [src]);
  return <img ref={ref} className={className} alt={alt} decoding="async" {...rest} />;
}

/* ---------------------------------------------------------------------------
   HERO - page 01 of a paged home.

   PC uses an HEVC color source plus a grayscale matte where supported. Their
   decoded frames are paired by frame index, then the matte is converted to
   alpha by WebGL. H.264/VP9 remains the complete compatibility fallback. The
   interactive SVG stays between the background and foreground planes.

   There is no cinematic hand-off to the personal-info page.
--------------------------------------------------------------------------- */
const HERO_FRAME_WIDTH = 2560;
const HERO_FRAME_HEIGHT = 1440;
const HERO_FRAME_FPS = 24;
const HERO_FRAME_COUNT = 353;

/* Desktop HERO uses a three-plane composition: background canvas, SVG
   typography, and transparent foreground canvas. Mobile uses one portrait MP4. */
/* Hidden FOUR Logo archive for future reuse. Keep this marker stable so the
   original logo artwork and interaction remain easy to find. */
const HIDDEN_HERO_FOUR_LOGO_ARCHIVE = {
  marker: 'HIDDEN_HERO_FOUR_LOGO_INTERACTION_START',
  component: 'SharedHeroLogo',
  motion: 'pointer proximity + requestAnimationFrame letter deformation',
  source: 'fourLetterPaths',
  selector: '.shared-hero-logo'
};

/* Mobile personal-info body, matching the iPhone 17 mock: full-bleed
   portrait background with the title/contact/stats/skills stack docked to
   the lower half. Mirrors the PC data (PC_STATS / PC_SKILLS) with tap-to-
   expand cards; tapping an already-active card closes it and switching
   between stat and skill closes the other panel. */
/* Mobile title ripple. Same maths as the PC WaveHeading (gaussian falloff
   around the pointer), but driven by pointer events instead of mousemove so a
   finger drag across the title works on touch devices — mobile has no hover,
   and without this the one piece of motion on the screen was missing.
   Pointer-driven on purpose: `mousemove` never fires for touch, and a
   click/tap has no coordinates to ripple around. rAF-throttled like PC so a
   fast drag doesn't run one layout read per event. */
function MobileWaveHeading() {
  const titleRef = useRef(null);
  const rafRef = useRef(0);

  const applyWave = (x, y) => {
    const root = titleRef.current;
    if (!root) return;
    // 窄屏标题更小,半径按视口收一点,免得整行都被抬起、失去指向性。
    const R = Math.max(96, Math.min(180, window.innerWidth * 0.42));
    const MAX = 18;
    root.querySelectorAll('.mob-wave-char').forEach((el) => {
      const r = el.getBoundingClientRect();
      const dist = Math.hypot(x - (r.left + r.width * 0.5), y - (r.top + r.height * 0.5));
      const lift = MAX * Math.exp(-(dist * dist) / (R * R));
      el.style.transform = lift > 0.15 ? `translateY(${-lift.toFixed(2)}px)` : '';
    });
  };

  const handleMove = (e) => {
    const { clientX, clientY } = e;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      applyWave(clientX, clientY);
    });
  };

  const handleLeave = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    titleRef.current?.querySelectorAll('.mob-wave-char').forEach((el) => { el.style.transform = ''; });
  };

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <h2
      className="mob-profile-title"
      ref={titleRef}
      onPointerMove={handleMove}
      onPointerUp={handleLeave}
      onPointerCancel={handleLeave}
      onPointerLeave={handleLeave}
    >
      <span className="mob-profile-title-en rany-display-heading">
        {'Hi， I Am Four'.split('').map((ch, i) => (
          <span key={i} className="mob-wave-char">{ch}</span>
        ))}
      </span>
      <span className="mob-profile-title-cn">
        {'邱锋江'.split('').map((ch, i) => (
          <span key={i} className="mob-wave-char">{ch}</span>
        ))}
      </span>
    </h2>
  );
}

/* 测量一组卡片在静止态的实际像素宽度，写成 --mob-w-N。
   为什么必须用 JS 测量而不能靠 `width: auto`：CSS 里从 `auto` 过渡到
   `44px` 在 Chrome 里**不产生补间**（实测 rAF 采样 uniqW=2，只有起点和终点，
   图标一路跳）。给出一个确定的起始像素宽度后，width 才有可插值的两端。
   静止态宽度依赖字体与文字长度（"Figma" / "Photoshop" / "Comfyui" 宽窄不同），
   所以只能在运行时量，不能写死常量。

   变化时（字号 clamp 随 vw 变、字体加载完、窗口 resize）重新测量，
   但**跳过过渡进行中**的时段，避免把动画中途的值又写回 CSS 造成抖动。 */
/* HomePage is kept mounted but hidden with display:none when works/detail is open.
   ResizeObserver pauses while hidden, but our own hashchange retry fires at fixed
   delays and can catch the layer mid-hide (or before it re-appears), measuring 0
   and permanently pinning --mob-w to 0px. Skip measurement when any target is
   inside a display:none ancestor; the next visible retry will recover. */
const isRendered = (el) => {
  while (el) {
    if (getComputedStyle(el).display === 'none') return false;
    el = el.parentElement;
  }
  return true;
};

function useMeasuredWidths(selector, count, deps, measureWidth) {
  const [widths, setWidths] = useState(null);

  useEffect(() => {
    let ro = null;
    let roTimer = 0; /* RO 回调防抖句柄(此前未声明,RO 一触发就抛 ReferenceError) */
    let settleTimer = 0; /* 复位形变未落定时的重试句柄 */
    let deferTimer = 0; /* 跨级转场挂起期间的重测句柄(见下面的 run) */
    const measure = () => {
      const nodes = [...document.querySelectorAll(selector)];
      if (nodes.length !== count) return;
      if (nodes.some((n) => !isRendered(n))) return;
      /* 正在 dock 形变中就别量：此刻的宽度是动画中间值，写回 CSS 会自激。 */
      const row = nodes[0].parentElement;
      if (row && row.classList.contains('is-docked')) return;
      /* ⚠ 2026-10-07 修 BUG(业主截图:芯片只剩「图标+首字母」,Comfyui 反而完整):
         is-docked 摘掉后的**复位形变**(width 36px→自然宽, 620ms)不设防 ——
         手机地址栏伸缩触发 resize / fonts.ready / 挂载 400ms 定时器若恰好落进
         这个窗口,量到的全是中间值。之前选中的那枚采样时还宽(名字完整),
         其余采样在 ~40px(名字被裁得只剩首字母),写回 --mob-w 后芯片就停在
         错误宽度,直到下次重测。修法:渲染宽 ≠ 目标 --mob-w 即形变未落定,
         改为 150ms 后重试,绝不把中间值写回。
         ⚠ 只对技能卡(无自定义 measureWidth)生效:经验卡的 measureStatDockWidth
         按字号量文字自然宽,与形变无关,且其目标宽度本来就不等于静止渲染宽。 */
      const unsettled = !measureWidth && nodes.some((n) => {
        const target = parseFloat(n.style.getPropertyValue('--mob-w'));
        return target > 0 && Math.abs(n.getBoundingClientRect().width - target) > 0.5;
      });
      if (unsettled) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(run, 150);
        return;
      }
      const next = nodes.map((n) => {
        const prev = parseFloat(n.style.getPropertyValue('--mob-w'));
        const cur = measureWidth ? measureWidth(n) : n.getBoundingClientRect().width;
        /* 已经一致就别 setState，避免无限重渲染。 */
        return Math.abs((prev || 0) - cur) < 0.5 ? prev : Math.round(cur * 100) / 100;
      });
      setWidths((old) => {
        if (old && old.length === next.length && old.every((v, i) => Math.abs(v - next[i]) < 0.5)) return old;
        return next;
      });
      /* 首测成功但 RO 还没挂上时兜底补挂(正常路径已在 effect 里挂好)。 */
      attachRO(nodes);
    };
    /* ⚠ 2026-10-10 性能:上面所有触发源(RO 防抖 / resize / fonts.ready /
       400ms 首测 / hashchange 分档重试)都改走 run() —— 它在跨级转场期间只登记
       一次延迟重测,不真的去量。原因:改 hash 触发的 100/450/1000ms 重测正好落在
       转场的动画帧之间,而每次 measure 都要逐级 getComputedStyle 查 isRendered、
       读 getBoundingClientRect、并让 measureStatDockWidth 往 body 插探针读 clamp()
       解析值 —— 全是强制同步布局。探针实测(手机 4× 降速):交互期间 30 次布局里
       6 次、177 次样式重算里 18 次由这条链触发。挂起到转场结束后补测一次,量到的
       值不变(只取决于字体与文案),只是不再插进动画里抢布局。 */
    const run = () => {
      const wait = (window.__measureHoldUntil || 0) - performance.now();
      if (wait > 0) {
        if (!deferTimer) deferTimer = setTimeout(() => { deferTimer = 0; run(); }, wait + 30);
        return;
      }
      measure();
    };
    /* ⚠⚠ 2026-10-07 修跳帧 BUG(业主复现路径:二级页刷新→返回一级→点技能卡,
       直接跳帧成选项状态):旧版把 RO 创建放在 measure() **成功路径内部** ——
       二级页刷新启动时首页是 .page-keep.is-hidden(display:none),首次 measure()
       在 isRendered 守卫处 return,RO 根本没挂上;fonts.ready 在隐藏期间消耗、
       400ms 定时器同样被拦,返回一级后没有任何触发源(无 resize),widths 永远
       为 null → 芯片宽度回落 width:var(--mob-w, auto) —— 而 Chrome 从 auto 到
       36px 不产生补间,点击展开就是整行瞬移。修复:RO 创建与测量解耦,effect
       里无条件挂上(与 useMeasuredMaxCardHeight 同构 —— 那个 hook 正因如此能
       自愈)。display:none→显示本身就是一次 box 尺寸变化,RO 必触发,防抖
       120ms 后量到的必是显示后的落定静止宽度。 */
    const attachRO = (els) => {
      if (ro || els.length !== count) return;
      ro = new ResizeObserver(() => {
        clearTimeout(roTimer);
        roTimer = setTimeout(run, 120);
      });
      els.forEach((n) => ro.observe(n));
    };
    attachRO([...document.querySelectorAll(selector)]);
    run();
    /* 字体加载完 / 容器宽度变化都会改静止态宽度，各等一次。 */
    if (document.fonts?.ready) document.fonts.ready.then(run).catch(() => {});
    window.addEventListener('resize', run);
    const t = setTimeout(run, 400);
    /* ⚠ 2026-10-07 修跳帧 BUG:探针实测 Chrome 的 ResizeObserver 对
       display:none↔显示 的切换**完全不触发回调**(fired:0),上面"RO 自愈"
       的假设不成立 —— 隐藏态挂载时首测被 isRendered 拦下,RO 又永远不响,
       返回一级页后 widths 永远为 null → 芯片宽度回落 auto → 点击展开时
       auto→36px 无补间,整行瞬移(业主:二级页刷新→返回一级→点技能卡必现)。
       补 hashchange 后的分档重试(100/450/1000ms)覆盖路由过渡各落定点:
       isRendered 拦隐藏态、unsettled 拦形变中间值,不会写垃圾值;
       路由过渡用的是 transform,不影响布局宽度,中途量到也是正确值。
       (2026-10-10:这三个落定点现在只会"登记重测",转场期间不真量,见上面 run。) */
    const routeTimers = [];
    const onRouteChange = () => {
      [100, 450, 1000].forEach((d) => routeTimers.push(setTimeout(run, d)));
    };
    window.addEventListener('hashchange', onRouteChange);
    return () => {
      window.removeEventListener('resize', run);
      window.removeEventListener('hashchange', onRouteChange);
      clearTimeout(t);
      clearTimeout(deferTimer);
      routeTimers.forEach(clearTimeout);
      clearTimeout(roTimer);
      clearTimeout(settleTimer);
      if (ro) ro.disconnect();
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [selector, count, ...(deps || [])]);

  return widths;
}

/* 经验 dock 选中卡的目标宽度 = 内容自然宽 + dock 水平 padding + 描边。
   旧版沿用静止三等分宽，内容右侧空出一截（2026-10-03 用户要求收掉的边距）。
   内容用静止字号 scrollWidth 量出（静止态即使被 max-width 裁过也能量到全宽）；
   dock 态英文字号/水平 padding 比静止态小一档，常量在 .mob-profile-stats 的
   --mob-dock-name-font / --mob-dock-pad-x（与 CSS 单一来源），这里用探针元素
   把 clamp 解析成 px 后按字号比例折算文本宽。技能卡不传本函数，维持静止宽。 */
/* clamp()/em 只能靠探针元素解析成 px,而解析结果只取决于这两个 CSS 变量 ——
   同一版变量下每枚芯片都一样。旧版每量一枚芯片就插一次探针、读三次计算样式再
   拔出:一次重测(4 枚芯片)就是 8 次 DOM 变更 + 十几次强制样式重算,而改 hash
   后会连做三遍重测(见 useMeasuredWidths 的 run)。现在按变量字符串缓存,同一批
   重测里最多解析一次;变量组合极少,只加一个上限防无限增长。 */
const dockPxCache = new Map();
function resolveDockPx(dockNameFont, dockPadX) {
  const key = `${dockNameFont}|${dockPadX}`;
  const hit = dockPxCache.get(key);
  if (hit) return hit;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
  document.body.append(probe);
  probe.style.fontSize = dockNameFont;
  const fontPx = parseFloat(getComputedStyle(probe).fontSize);
  probe.style.fontSize = '';
  probe.style.paddingLeft = dockPadX;
  const padPx = parseFloat(getComputedStyle(probe).paddingLeft);
  probe.remove();
  const out = { fontPx, padPx };
  if (dockPxCache.size > 32) dockPxCache.clear();
  dockPxCache.set(key, out);
  return out;
}

function measureStatDockWidth(node) {
  const label = node.querySelector('.mob-profile-stat-label');
  const strong = node.querySelector('strong');
  const name = node.querySelector('.mob-profile-stat-name');
  if (!label || !strong || !name) return node.getBoundingClientRect().width;
  const cs = getComputedStyle(node);
  let chrome = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  const row = node.parentElement;
  const rowStyle = row ? getComputedStyle(row) : null;
  const dockNameFont = rowStyle ? rowStyle.getPropertyValue('--mob-dock-name-font').trim() : '';
  const dockPadX = rowStyle ? rowStyle.getPropertyValue('--mob-dock-pad-x').trim() : '';
  let inner = Math.max(strong.scrollWidth, label.scrollWidth);
  if (dockNameFont && dockPadX) {
    const { fontPx: dockFontPx, padPx: dockPadPx } = resolveDockPx(dockNameFont, dockPadX);
    if (dockFontPx > 0 && dockPadPx > 0) {
      const restLabelFont = parseFloat(getComputedStyle(label).fontSize);
      const ratio = dockFontPx / restLabelFont;
      const iconPart = label.scrollWidth - name.scrollWidth; /* 图标 + 列间距（静止值，与 dock 值差 ~2px） */
      inner = Math.max(strong.scrollWidth, iconPart + name.scrollWidth * ratio);
      chrome += dockPadPx * 2;
      /* +2px 圆整余量：字体的子像素度量在量测与渲染之间存在 ~1px 漂移，
         不留余量末字符会被 overflow:hidden 裁掉一条边。 */
      return inner + chrome + 2;
    }
  }
  chrome += parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  return inner + chrome;
}

/* 描述卡高度必须「可过渡」。原来用 grid-template-rows 0fr↔1fr 做展开/收回，
   但**切换不同项**时轨道值始终是 1fr(没变)、变的是内容 —— 轨道不产生补间，
   实测切换瞬间卡高一帧跳 19.6px，整组底对齐布局里上方的 dock 行跟着瞬移。
   改为 JS 实测内容高度写进 --mob-card-h，CSS 用 height: 0 ↔ var() 过渡，
   展开 / 收回 / 切换三种高度变化全部走同一条 height 过渡。
   contentId(=当前项 id)变化时重测；box 的 offsetHeight 是布局高度，
   不受卡片 scaleY/位移 keyframes 影响。

   2026-10-03 两处升级(配合 CSS 的 --mob-exp-max/--mob-skill-max 预留):
   ① box 高度本身也被 --mob-card-h 约束了(切换时盒高要过渡),直接量
      offsetHeight 会读到**旧约束值**而不是新内容的自然高 —— 先瞬时放回
      auto 量完再还原(useLayoutEffect 在绘制前跑,无闪烁)。
   ② 变量写在**组容器**上(技能组=shell,经验组=卡片自身):技能行贴合与
      盒高过渡要读同一个值,必须同源。
   ③ ⚠ 盒高过渡成立的前提是 **body/box 跨切换持久存在**(JSX 里不能加
      key 重挂载):实测 Chrome 对「本次 commit 新插入的元素」不启动任何
      过渡,连「设旧值→强制回流→翻转变量」的 FLIP 都救不回来(埋点证实
      startH/h 全对、过渡就是不跑);而持久元素上变量翻转是正常补间的。
      切换时的文字淡入由 useRestartCardAnimation 重启 @keyframes 补上。 */
function useMeasuredCardHeight(cardRef, contentId) {
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const host = card.closest('.mob-profile-shell') || card;
    const measure = () => {
      const box = card.querySelector('.mob-profile-card-box');
      if (!box) {
        host.style.setProperty('--mob-card-h', '0px');
        return;
      }
      /* 量自然高:height 被变量约束,先放回 auto 再读。
         ⚠⚠ auto 回流会把「上一帧计算值」毒化成离散的 auto —— 之后再翻转
         变量就是 auto↔px 离散变化,过渡直接失效(实测盒高一帧瞬跳)。
         所以量完必须把旧 px 值重新钉回去,重建连续的 before-change,
         变量翻转才能从旧值平滑补间到新值。 */
      const prevH = parseFloat(getComputedStyle(box).height) || 0;
      box.style.height = 'auto';
      const h = box.offsetHeight;
      box.style.height = `${prevH}px`;
      box.offsetHeight; /* 让「钉回旧值」落成上一帧计算值 */
      box.style.height = '';
      host.style.setProperty('--mob-card-h', `${h}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    return () => window.removeEventListener('resize', measure);
  }, [contentId]);
}

/* 切换选中项时重启盒上的进场动画(@keyframes mob-profile-card-in)。
   body 不再带 key 重挂载(见 useMeasuredCardHeight ③),CSS 动画不会因
   选择器重新匹配而自动重放 —— 用「先摘后还」的经典手法手动重启。 */
function useRestartCardAnimation(cardRef, contentId) {
  useLayoutEffect(() => {
    if (!contentId) return;
    const box = cardRef.current?.querySelector('.mob-profile-card-box');
    if (!box) return;
    box.style.animation = 'none';
    box.offsetHeight;
    box.style.animation = '';
  }, [contentId]);
}

/* 量出每组描述卡的**最大**内容高度,写 --mob-exp-max / --mob-skill-max。
   为什么要 max:描述卡容器(展开层)高度若挂「当前内容高」,切换选中项时
   容器高度跟着变,底对齐布局就会拖着上方标题/联系方式一起移 —— 正是用户
   否掉的行为。挂 max 后容器高度在切换全程**恒定**,上方零位移;内容盒自身
   高度(=当前内容)另由 --mob-card-h 驱动并过渡,视觉上就是「以 dock 行为锚,
   向下(经验)/向上(技能)伸缩」。
   文案必须按真实盒模型渲染(.mob-card-measure 里复刻 body/box 结构),
   否则 <p> 拿不到字号/行高样式,量出来偏大;字体加载完与 resize 各重量一次。 */
function useMeasuredMaxCardHeight(infoRef) {
  useLayoutEffect(() => {
    const root = infoRef.current;
    if (!root) return;
    const measure = () => {
      if (!isRendered(root)) return;
      ['stat', 'skill'].forEach((group) => {
        const nodes = root.querySelectorAll(
          `.mob-card-measure[data-group="${group}"] .mob-profile-card-box`
        );
        if (!nodes.length) return;
        let max = 0;
        nodes.forEach((n) => { if (n.offsetHeight > max) max = n.offsetHeight; });
        root.style.setProperty(group === 'stat' ? '--mob-exp-max' : '--mob-skill-max', `${max}px`);
      });
    };
    measure();
    /* 2026-10-04 修 BUG:以二级页 URL 刷新启动时首页处于隐藏态,本组件挂载时
       测量条高度全为 0,量出 --mob-exp-max: 0px 且无人重测 —— 返回一级后
       经验/技能卡展开后高度为 0、无法正常显示。ResizeObserver 在测量条
       获得真实高度(首页变为可见)时自动重测,自愈。
       ⚠ 2026-10-07 修正:探针实测 Chrome 的 ResizeObserver 对
       display:none↔显示 的切换**不触发回调**(与 useMeasuredWidths 同一坑),
       "RO 自愈"并不成立 —— 这次只是 resize/fonts 时机恰好凑巧救了高度。
       同样补 hashchange 分档重试(100/450/1000ms);isRendered 拦隐藏态,
       路由过渡的 transform 不影响 offsetHeight,中途量到也是正确值。 */
    const ro = new ResizeObserver(() => measure());
    root.querySelectorAll('.mob-card-measure').forEach((m) => ro.observe(m));
    window.addEventListener('resize', measure);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    const routeTimers = [];
    const onRouteChange = () => {
      [100, 450, 1000].forEach((d) => routeTimers.push(setTimeout(measure, d)));
    };
    window.addEventListener('hashchange', onRouteChange);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('hashchange', onRouteChange);
      routeTimers.forEach(clearTimeout);
    };
  }, []);
}

// 折叠图标(按业主提供的 折叠.svg 重绘的描边版,形状一致;原填充版笔画固定,
// 无法调粗细)。stroke-width 66 ≈ 原版 82 的 80%,视觉上"微微细一档"——
// 要再调粗细只改这一个数字(82 = 与原版完全等粗)。移动端专用:描述卡展开时
// 出现在所在行右端,点它或点页面空白都把卡片组恢复初始静止态。内联 SVG 走
// currentColor,灰度由 mobile.css 的 .mob-fold 一处定义,与经验卡图标同灰。
const MOB_FOLD_ICON = (
  <svg
    viewBox="0 0 1024 1024"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeWidth="66"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M636 82 H921 A41 41 0 0 1 962 123 V411" />
    <path d="M409 942 H124 A41 41 0 0 1 83 901 V613" />
    <path d="M230 230 L429 429 M470 270 V429 A41 41 0 0 1 429 470 H270" />
    <path d="M794 794 L595 595 M554 754 V595 A41 41 0 0 1 595 554 H754" />
  </svg>
);

function ProfileContent() {
  const [activeStat, setActiveStat] = useState(null);
  const [activeSkill, setActiveSkill] = useState(null);
  const statWidths = useMeasuredWidths('.mob-profile-stat', PC_STATS.length, undefined, measureStatDockWidth);
  const skillWidths = useMeasuredWidths('.mob-profile-skill', PC_SKILLS.length);

  /* 「已在 dock 内换选中项」标记(2026-10-03 修 BUG):
     用户报「5+ 那枚跳帧、10+/50+ 没有」—— 逐帧实测发现被点的那枚宽度只用
     ~270ms 就到位(9 帧),其余收起项走满 620ms(20 帧)。根因:dock 态
     .is-active 上那档 --mob-w-dur: --mob-switch-dur(340ms) 在**首次展开**时也
     生效,于是被点的卡提前到位、其余仍在动 → 视觉上就是「这一枚跳了一下」。
     修法:这档快时长只在**组内切换**时生效(activeXxx 原先非空且换了另一枚),
     首次展开/整组复位一律走 --mob-dock-dur。 */
  const [switching, setSwitching] = useState(null);

  const toggleStat = (id) => {
    setSwitching(activeStat && activeStat !== id ? 'stat' : null);
    setActiveStat((prev) => (prev === id ? null : id));
    setActiveSkill(null);
  };

  const toggleSkill = (id) => {
    setSwitching(activeSkill && activeSkill !== id ? 'skill' : null);
    setActiveSkill((prev) => (prev === id ? null : id));
    setActiveStat(null);
  };

  const activeStatData = activeStat ? PC_STATS.find((s) => s.id === activeStat) : null;
  const activeSkillData = activeSkill ? PC_SKILLS.find((s) => s.id === activeSkill) : null;
  /* 收回时内容必须**继续挂载**，否则收起动画的第一帧就没了：
     - grid 的 0fr 轨道高度 = 内容的 min 贡献，内容一卸载自由空间直接变 0，
       1fr→0fr 的过渡瞬间跳到终值（实测收回第一帧高度就是 0）；
     - 文字节点被移除，opacity 再怎么过渡也没有载体。
     所以把最近一次的数据留在 ref 里，收起过程中继续渲染它，等高度归零后
     它只是不可见（body 自身 opacity 过渡到 0）。 */
  const lastStatRef = useRef(null);
  if (activeStatData) lastStatRef.current = activeStatData;
  const shownStatData = activeStatData ?? lastStatRef.current;
  const lastSkillRef = useRef(null);
  if (activeSkillData) lastSkillRef.current = activeSkillData;
  const shownSkillData = activeSkillData ?? lastSkillRef.current;

  /* 描述卡高度实测(见 hook 注释)：展开/收回/切换都走 height 过渡。 */
  const expCardRef = useRef(null);
  const skillCardRef = useRef(null);
  useMeasuredCardHeight(expCardRef, shownStatData?.id);
  useMeasuredCardHeight(skillCardRef, shownSkillData?.id);
  /* body 不带 key(持久元素才有盒高过渡,见 useMeasuredCardHeight ③),
     切换时的文字淡入靠手动重启盒上的 @keyframes。 */
  useRestartCardAnimation(expCardRef, shownStatData?.id);
  useRestartCardAnimation(skillCardRef, shownSkillData?.id);

  /* 每组最长文案的高度(写 --mob-exp-max / --mob-skill-max):
     描述卡容器高度挂 max,切换选中项时容器恒定,上方标题/联系方式零位移。 */
  const profileInfoRef = useRef(null);
  useMeasuredMaxCardHeight(profileInfoRef);

  /* 主次关系同 PC:一次只有一个「展开中」的组。点经验卡 → 技能组整体退隐
     (PC 是 .pf-statrow.is-hidden);点技能卡 → 经验组退隐。未选中项不是消失,
     而是降到低透明度 —— 保留可点性,用户才知道还能换。 */
  const statActive = !!activeStat;
  const skillActive = !!activeSkill;

  // 折叠:点折叠图标或点展开卡片组之外的任何空白都恢复初始静止态。
  // 描述卡本身豁免(正文可选中阅读),标签按钮有自己的 toggle 不走这条路。
  // 只在展开期间挂监听,静止态零开销。
  useEffect(() => {
    if (!statActive && !skillActive) return undefined;
    const onDocClick = (e) => {
      const t = e.target;
      if (t && t.closest && (t.closest('.mob-profile-stat') || t.closest('.mob-profile-skill')
        || t.closest('.mob-profile-exp-card') || t.closest('.mob-profile-skill-card')
        || t.closest('.mob-fold'))) return;
      setActiveStat(null);
      setActiveSkill(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [statActive, skillActive]);

  return (
    <div className="profile-shot-inner">
      <LazyImage className="mob-profile-bg" src={mobPortraitBg} alt="" />
      <div className="mob-profile-info" ref={profileInfoRef}>
        <MobileWaveHeading />

        <div className="mob-profile-contact">
          <CopyContactLine icon={Phone} label="手机号" value="18219315597" />
          <CopyContactLine icon={Mail} label="邮箱" value="Four4444.Design@gmail.com" />
        </div>

        {/* 经验 dock(2026-10-02 重构)。
            两层结构,职责必须分开:
            ① 外层 `.mob-profile-shell` 用 grid-template-rows 1fr↔0fr 把**整组
               高度真正归零** —— 只给行加 opacity:0 会留下等高空白,视觉上仍是
               「两组都在,只是暗了」,这正是设计稿否掉的形态。
            ② 内层 `.mob-profile-stats` 静止态与 dock 态**共用同一套盒模型**
               (始终 display:flex,宽度靠 width 连续变化)。上一版靠
               `display:grid → flex` 切换实现 dock,那是**离散的 layout 跳变**,
               图标根本没有移动过程;再往后试 `flex-grow` 也一样不可靠补间。*/}
        <div className={`mob-profile-shell mob-profile-shell-stats${skillActive ? ' is-collapsed' : ''}`}>
        {/* shell 只允许**一个** grid 子项（.mob-shell-inner），所有内容都装进它。
            直接把多个子项塞进 shell 会各占一行，行高得用 auto auto 描述，
            而 auto↔0fr 不可插值 → 互斥收起瞬间跳变；单子项 1fr↔0fr 才有平滑过渡。 */}
        <div className="mob-shell-inner">
        <div className={`mob-profile-stats${statActive ? ' is-docked' : ''}${switching === 'stat' ? ' is-switching' : ''}`}>
          {PC_STATS.map((s, i) => (
            <button
              type="button"
              key={s.id}
              data-id={s.id}
              className={`mob-profile-stat${activeStat === s.id ? ' is-active' : ''}`}
              style={statWidths ? { '--mob-w': statWidths[i] + 'px' } : undefined}
              onClick={() => toggleStat(s.id)}
              aria-pressed={activeStat === s.id}
            >
              <strong>{s.value}</strong>
              <span className="mob-profile-stat-label">
                <LazyImage className="mob-profile-stat-icon" src={s.icon} alt="" />
                <span className="mob-profile-stat-name">{s.label}</span>
              </span>
            </button>
          ))}
          {/* 折叠图标(图1):经验卡展开时停在经验标签行右端、描述卡右缘上。
              绝对定位不参与 flex,不影响三卡宽度形变与 useMeasuredWidths。 */}
          <button
            type="button"
            className={`mob-fold mob-fold-stat${activeStat ? ' is-visible' : ''}`}
            aria-label="折叠经验卡片"
            aria-hidden={!activeStat}
            onClick={() => { setActiveStat(null); setActiveSkill(null); }}
          >
            {MOB_FOLD_ICON}
          </button>
        </div>
        </div>
        </div>

        {/* ⚠ body 故意不带 key:重挂载的新元素在 Chrome 里不启动任何过渡,
               盒高切换会瞬跳(见 useMeasuredCardHeight ③)。文字淡入由
               useRestartCardAnimation 重启 @keyframes 补偿。 */}
        <div className={`mob-profile-exp-card${activeStat ? ' is-visible' : ''}`} aria-live="polite" ref={expCardRef}>
          {shownStatData && (
            <div className="mob-profile-card-body">
              <div className="mob-profile-card-box">
                <p>{shownStatData.text}</p>
              </div>
            </div>
          )}
        </div>

        {/* 技能 dock:设计稿里描述卡在 dock **上方**、dock 贴着描述卡底边,
           所以技能组的展开卡排在技能行之前。两组互斥——点经验卡技能组整组收起,
           点技能卡经验组整组收起(外层 .mob-profile-shell 高度归零,不是变暗)。*/}
        <div className={`mob-profile-shell mob-profile-shell-skills${statActive ? ' is-collapsed' : ''}`}>
        <div className="mob-shell-inner">
        <div className={`mob-profile-skill-card${skillActive ? ' is-visible' : ''}`} aria-live="polite" ref={skillCardRef}>
          {shownSkillData && (
            <div className="mob-profile-card-body">
              <div className="mob-profile-card-box">
                <p className="mob-profile-card-title">{shownSkillData.title}</p>
                <p>{shownSkillData.text}</p>
              </div>
            </div>
          )}
        </div>

        <div className={`mob-profile-skills${skillActive ? ' is-docked' : ''}${switching === 'skill' ? ' is-switching' : ''}`}>
          {/* DOM 顺序 == 数据顺序:用 sort / order 把选中项顶到行首会让节点被移动,
              移动即 re-layout,宽度形变变成跳变而非滑动,正是慢曲线要消除的两段感。
              PC端同样让选中标签原地 morph。技能 dock 的收起项靠 width 收窄,
              选中项保持原位,DOM 顺序无需变动。*/}
          {PC_SKILLS.map((s, i) => (
            <button
              type="button"
              key={s.id}
              data-id={s.id}
              className={`mob-profile-skill${activeSkill === s.id ? ' is-active' : ''}`}
              style={skillWidths ? { '--mob-w': skillWidths[i] + 'px' } : undefined}
              onClick={() => toggleSkill(s.id)}
              aria-pressed={activeSkill === s.id}
            >
              <LazyImage className="mob-profile-skill-icon" src={s.icon} alt={s.name} />
              <span className="mob-profile-skill-name">{s.name}</span>
            </button>
          ))}
          {/* 折叠图标(图2):技能卡展开时停在技能行右端、描述卡右缘下。 */}
          <button
            type="button"
            className={`mob-fold mob-fold-skill${activeSkill ? ' is-visible' : ''}`}
            aria-label="折叠技能卡片"
            aria-hidden={!activeSkill}
            onClick={() => { setActiveStat(null); setActiveSkill(null); }}
          >
            {MOB_FOLD_ICON}
          </button>
        </div>
        </div>
        </div>

        {/* 隐形测量条(见 useMeasuredMaxCardHeight):每组全部描述文案按真实
            盒模型渲染一遍(不可见、零占位),量出最大 offsetHeight 写进
            --mob-exp-max / --mob-skill-max。必须复刻 body/box 结构,
            否则 <p> 拿不到字号/行高,量出来偏大。 */}
        <div className="mob-card-measure" data-group="stat" aria-hidden="true">
          {PC_STATS.map((s) => (
            <div className="mob-profile-card-body" key={s.id}>
              <div className="mob-profile-card-box"><p>{s.text}</p></div>
            </div>
          ))}
        </div>
        <div className="mob-card-measure" data-group="skill" aria-hidden="true">
          {PC_SKILLS.map((s) => (
            <div className="mob-profile-card-body" key={s.id}>
              <div className="mob-profile-card-box">
                <p className="mob-profile-card-title">{s.title}</p>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Click-to-copy contact line (PC profile). Hover swaps the leading icon for
   a copy glyph, grows a rule under the value's text and shows the 点击复制
   tag; click rolls the value up and the confirmation line in, then reverts
   so the interaction can be replayed. Monochrome on purpose. */
function CopyContactLine({ icon: Icon, label, value }) {
  const rollerRef = useRef(null);
  const mainRef = useRef(null);
  const doneRef = useRef(null);
  const textRef = useRef(null);
  const timerRef = useRef(0);
  const widthsRef = useRef({ main: 0, done: 0 });
  const copiedRef = useRef(false);
  const [copied, setCopied] = useState(false);

  // 字形推进宽度（不含盒内多余空间）。用 Range 量文字节点，得到真实字形宽。
  // 2026-10-07 修 BUG(移动端下划线超宽)：移动端 CSS 把 .pf-copy-line 从 PC 的
  // width:max-content 覆盖成 width:auto，两条 line 被 roller 盒宽（按邮箱量出的
  // 196.9px）拉齐；而「已复制邮箱，欢迎联系」字形仅 143px，下划线若仍取 100%
  // 盒宽就会右端空出一截。把当前「显示行」的字形宽度写成 --pf-rule-w，移动端
  // 的 .pf-copy-rule 跟随它，切行即换宽（PC 端不受影响，仍用盒宽）。
  const glyphW = (el) => {
    if (!el || !el.firstChild) return 0;
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().width;
  };
  const syncRuleW = (isCopied) => {
    const el = isCopied ? doneRef.current : mainRef.current;
    const w = glyphW(el);
    if (w > 0 && textRef.current) textRef.current.style.setProperty('--pf-rule-w', w + 'px');
  };

  // The roller is pinned to the value's natural width so the hover rule and
  // the rolled-in confirmation line always align with the text. Fonts finish
  // loading after mount, so re-measure once they are ready.
  useLayoutEffect(() => {
    const measure = () => {
      widthsRef.current = {
        main: mainRef.current.getBoundingClientRect().width,
        done: doneRef.current.getBoundingClientRect().width
      };
      if (!copiedRef.current) rollerRef.current.style.width = widthsRef.current.main + 'px';
      syncRuleW(copiedRef.current);
    };
    measure();
    /* 2026-10-04 修 BUG:以二级页 URL 刷新启动时首页隐藏,首次量出 roller
       宽度为 0 并钉死 —— 返回一级后联系方式只剩图标、文字被裁没。
       RO 在文字行获得真实宽度时自动重测并重新钉宽,自愈。 */
    const ro = new ResizeObserver(() => measure());
    if (mainRef.current) ro.observe(mainRef.current);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    return () => { ro.disconnect(); clearTimeout(timerRef.current); };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    clearTimeout(timerRef.current);
    copiedRef.current = true;
    rollerRef.current.style.width = widthsRef.current.done + 'px';
    syncRuleW(true);                                // 下划线切到「已复制」行的字形宽度
    setCopied(true);
    timerRef.current = setTimeout(() => {
      copiedRef.current = false;
      rollerRef.current.style.width = widthsRef.current.main + 'px';
      syncRuleW(false);                             // 复位时切回原值行的字形宽度
      setCopied(false);
      /* 2026-10-05: 提示停留 2600→1300ms(用户要求减半) —— 「已复制」看完即收,
         复位动画本身(roller 宽度/stack 位移的 CSS 过渡)不受影响。 */
    }, 1300);
  };

  return (
    <button
      type="button"
      className={`pf-copy${copied ? ' is-copied' : ''}`}
      onClick={copy}
      aria-label={`复制${label}`}
    >
      <span className="pf-copy-icon" aria-hidden="true">
        <Icon size={15} strokeWidth={1.8} className="pf-copy-ic-main" />
        <Copy size={15} strokeWidth={1.8} className="pf-copy-ic-copy" />
      </span>
      <span className="pf-copy-text" ref={textRef}>
        <span className="pf-copy-roller" ref={rollerRef}>
          <span className="pf-copy-stack">
            <span className="pf-copy-line" ref={mainRef}>{value}</span>
            <span className="pf-copy-line pf-copy-done" ref={doneRef}>{`已复制${label}，欢迎联系`}</span>
          </span>
        </span>
        <i className="pf-copy-rule" aria-hidden="true" />
      </span>
      <span className="pf-copy-hint" aria-hidden="true">点击复制</span>
    </button>
  );
}

function WaveHeading() {
  const titleRef = useRef(null);
  const rafRef = useRef(0);

  const applyWave = (e) => {
    const root = titleRef.current;
    if (!root) return;
    const chars = root.querySelectorAll('.wave-char');
    const { clientX, clientY } = e;
    const R = 180;
    const MAX = 22;
    chars.forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width * 0.5;
      const cy = r.top + r.height * 0.5;
      const dist = Math.hypot(clientX - cx, clientY - cy);
      const lift = MAX * Math.exp(-(dist * dist) / (R * R));
      el.style.transform = `translateY(${-lift.toFixed(2)}px)`;
    });
  };

  const handleMove = (e) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => applyWave(e));
  };

  const handleLeave = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const chars = titleRef.current?.querySelectorAll('.wave-char');
    chars?.forEach((el) => { el.style.transform = ''; });
  };

  return (
    <h2 className="pf-title" ref={titleRef} onMouseMove={handleMove} onMouseLeave={handleLeave}>
      <span className="pf-title-en rany-display-heading">
        {'Hi , I Am Four'.split('').map((ch, i) => (
          <span key={i} className="wave-char">{ch}</span>
        ))}
      </span>
      <span className="pf-title-cn">
        {'邱锋江'.split('').map((ch, i) => (
          <span key={i} className="wave-char">{ch}</span>
        ))}
      </span>
    </h2>
  );
}

/* PC-only personal-info screen. Full-bleed portrait background + all-code
   layout per the 2026-09-30 mock (个人信息.jpg / 技能展示.jpg). Mobile keeps
   the legacy ProfileContent above. */
function ProfileContentPC() {
  // One slot of hover intent at a time: whichever row was entered last wins,
  // so dragging from a stat card down to the skill strip hands over cleanly
  // instead of leaving two description cards mounted at once.
  const [hover, setHover] = useState(null);
  const activeSkill = hover?.type === 'skill' ? PC_SKILLS.find((s) => s.id === hover.id) || null : null;
  const activeStat = hover?.type === 'stat' ? PC_STATS.find((s) => s.id === hover.id) || null : null;

  // 意图只由真实指针移动驱动(移植自 demo 的 mousemove 意图逻辑):
  // - 停泊光标不移动就不会派发 mousemove,布局变动(技能卡展开把按钮顶走)也
  //   不派发 mousemove,因此 parked 光标永远偷不到选择(解决「悬停 Blender 时
  //   Codex/Photoshop 滑过来被切走」)。这条是防偷选的根本保证,不靠任何阈值。
  // - 切换不同卡片:命中即生效,**无任何阈值/延迟**。
  // - 防偷选不靠阈值,靠**坐标比对**:技能卡展开把 Codex/Photoshop 顶到停泊光标下时,
  //   浏览器会以「与上次完全相同」的 clientX/clientY 补发 mousemove(光标其实没动)。
  //   坐标完全未变 → 判定为布局位移补发,既不改意图(不偷选)也不判移出(不抖动);
  //   坐标有变 → 真实指针移动,立即生效。零阈值、零延迟,两个问题一起解决。
  // - 移出判定:**不用 zone 的 mouseleave**,改成「指针真的移动到 zone 框外」。布局
  //   变动会让光标瞬间落到框外并触发 mouseleave → 收起 → 又回框内 → 再展开的抖动闭环,
  //   而布局变动不派发真实移动,故从根上消除。**移出立即复位,不加任何锁定延迟。**
  const zoneRef = useRef(null);
  const hoverRef = useRef(null);
  useEffect(() => {
    const zone = zoneRef.current;
    let lastX = null;
    let lastY = null;
    const buttonIntent = (target) => {
      if (!target || !target.closest) return null;
      const skillBtn = target.closest('.pf-skill');
      if (skillBtn) return { type: 'skill', id: skillBtn.dataset.id };
      const statBtn = target.closest('.pf-stat');
      if (statBtn) return { type: 'stat', id: statBtn.dataset.id };
      return null;
    };
    const applyIntent = (intent) => {
      if (hoverRef.current && hoverRef.current.type === intent.type && hoverRef.current.id === intent.id) return;
      hoverRef.current = intent;
      setHover(intent);
    };
    const onMove = (e) => {
      const intent = buttonIntent(e.target);
      // 死区只作用于**意图切换**(防偷选),**不作用移出判定**。
      // 此前死区写在开头直接 return,把移出判定一起短路了:慢速移动时浏览器
      // 每帧只派发几像素,每个事件都落在 6px 内→ 被吞 → 卡片永远不放手。
      // 移出必须无条件按当前真实坐标判定,否则"慢慢移开"会粘住。
      if (intent) {
        // 亚阈值位移免疫:经验卡 dock 时兄弟卡横向滑动数十像素,光标有 1~5px
        // 真实抖动时坐标不再「精确相等」,会被误判为真实移动、把滑到光标下的卡
        // 偷选走(技能卡 dock 兄弟卡几乎不横移所以没这问题)。已有意图时,距上一
        // 次真实移动点 ≤6px 视作没动 → 直接返回,既不偷选也不判移出。空间死区
        // 不是时间延迟,跨卡导航要移动数十像素,6px 内判定静止对切换无感。
        if (lastX !== null && hoverRef.current
          && Math.abs(e.clientX - lastX) <= 6 && Math.abs(e.clientY - lastY) <= 6) return;
        lastX = e.clientX;
        lastY = e.clientY;
        // 命中即生效:零阈值,切换不同卡片无延迟。
        applyIntent(intent);
        return;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      if (!hoverRef.current || !zone) return;
      // 移出边界必须贴合**实际可见内容**,而不是外层 zone 矩形。zone 含 28px
      // padding 且 min-height 同时覆盖静止/展开两态(实测 y=423~745),而经验卡
      // 只有 y=577~717;若拿 zone 当边界再叠 72px 缓冲,指针要移动近 100px 才能
      // 判定移出,卡片像"粘住"了。改为取当前可见交互元素(选中态=经验卡条+经验
      // 描述卡,技能态=技能条+技能描述卡)的矩形并集,只留 8px 容差。
      const PAD = 8;
      const sel = hoverRef.current.type === 'stat'
        ? ['.pf-statrow', '.pf-exp-card.is-visible']
        : ['.pf-skills', '.pf-skill-card.is-visible'];
      let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
      for (const s of sel) {
        const el = zone.querySelector(s);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) continue;
        left = Math.min(left, b.left); right = Math.max(right, b.right);
        top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom);
      }
      if (left === Infinity) return;
      // 移出立即复位,不加任何锁定/延迟。
      if (e.clientX < left - PAD || e.clientX > right + PAD
        || e.clientY < top - PAD || e.clientY > bottom + PAD) {
        hoverRef.current = null;
        setHover(null);
      }
    };
    // 指针快速甩出整个窗口时补一次强制收起(此时可能已无后续 mousemove)。
    const onDocLeave = () => {
      if (!hoverRef.current) return;
      hoverRef.current = null;
      setHover(null);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onDocLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onDocLeave);
    };
  }, []);

  return (
    <div className="pf-inner">
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dbg') && (
        <div
          style={{ position: 'fixed', top: 8, left: 8, zIndex: 9999, color: '#5dff8f', font: '12px/1.4 monospace', background: 'rgba(0,0,0,.72)', padding: '6px 8px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'pre' }}
        >
          {`[pf-dbg] hover=${JSON.stringify(hover)}\n`}
        </div>
      )}
      <div className="pf-bg" aria-hidden="true">
        <LazyImage className="pf-bg-img" src={pcPortraitBg} alt="" />
      </div>
      <div className="pf-content">
        <WaveHeading />

        {/* 调换后:联系方式上移到经验卡上方,带完整点击复制交互,始终可见不随 hover 隐藏。 */}
        <div className="pf-contact">
          <CopyContactLine icon={Phone} label="手机号" value="18219315597" />
          <CopyContactLine icon={Mail} label="邮箱" value="Four4444.Design@gmail.com" />
        </div>

        {/* 持久 stat row 兼作静止经验卡与 dock 后的 tab 条; hover 时卡片并入并
           dock 到描述卡上。zone 包裹 card+技能条并接管 mousemove 意图(见 effect)。 */}
        <div className="pf-hover-zone" ref={zoneRef}>
          <div className={`pf-swap${activeSkill ? ' has-skill' : ''}`}>
            <div className={`pf-statrow${activeStat ? ' is-docked' : ''}${activeSkill ? ' is-hidden' : ''}`}>
              {PC_STATS.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  data-id={s.id}
                  className={`pf-stat${activeStat?.id === s.id ? ' is-active' : ''}`}
                  onFocus={() => setHover({ type: 'stat', id: s.id })}
                >
                  <strong>{s.value}</strong>
                  <span className="pf-stat-label">
                    <LazyImage className="pf-stat-icon" src={s.icon} alt="" />
                    <span className="pf-stat-name">{s.label}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className={`pf-exp-card${activeStat ? ' is-visible' : ''}`} aria-live="polite">
              {activeStat && (
                <div className="pf-exp-card-body" key={activeStat.id}>
                  <p className="pf-exp-text">{activeStat.text}</p>
                </div>
              )}
            </div>
            <div className={`pf-skill-card${activeSkill ? ' is-visible' : ''}`} aria-live="polite">
              {activeSkill && (
                <div className="pf-skill-card-body" key={activeSkill.id}>
                  <p className="pf-skill-title">{activeSkill.title}</p>
                  <p className="pf-skill-text">{activeSkill.text}</p>
                </div>
              )}
            </div>
          </div>

          <div className={`pf-skills-entrance${activeSkill ? ' is-flush' : ''}`}>
            <div
              className={`pf-skills${activeSkill ? ' has-active' : ''}${activeStat ? ' is-hidden' : ''}`}
            >
              {PC_SKILLS.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  data-id={s.id}
                  className={`pf-skill${activeSkill?.id === s.id ? ' is-active' : ''}`}
                  onFocus={() => setHover({ type: 'skill', id: s.id })}
                >
                  <LazyImage className="pf-skill-icon" src={s.icon} alt={s.name} />
                  <span className="pf-skill-name">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// onVideoReady：首屏视频真正开始播放后回调一次（外部用它给尾屏预挂载当闸门）。
// 首屏视频优先级绝对最高 —— 尾屏的 WebGL 编译绝不能抢在它前面，所以预挂载
// 必须等这个信号之后才允许发生。判定用 playing 事件（而非 canplay，因为
// canplay 只代表数据够了，实际首帧还没上屏），并要求 readyState >= 3。
// 揭幕判据已升级为「能连续播」而非「能播」：只按 readyState>=3 揭幕会出现进度条刚
// 到 100% 视频却还卡着不动。下面两个常量就是这条判据的阈值，细节见文件内使用处。
// 缓冲余量：短视频取「片长的一半」，长片最多等 2.5s。
// ⚠ 2026-10-13 由 1.5s 提到 2.5s（业主：无缓存时进首页视频仍会卡一会）。
//   1.5s 在冷缓存 + 4G 上只有零点几秒余量，揭幕那一下尾屏/封面刚好收尾，
//   网络稍有抖动就吃光 → 视频当场 rebuffer。2.5s 是"能连续播"而不是"能播"。
const HERO_SMOOTH_AHEAD_SEC = 2.5;
/* 尾屏在进度条里的权重（2026-10-11 由 2 提到 8）。
   只影响读数在总分里占多少，**不影响揭幕时机**（揭幕看值到没到 1，不看权重）。
   ⚠ 改这个值必须同步 Street.jsx 里所有 weight 上报，两处不一致会以先登记的那个为准，
   后到的被忽略（注册表按 id 锁权重），改错一边不会报错、只会静默失效。 */
const TAIL_PROGRESS_WEIGHT = 8;
/* 尾屏在 index.html 进度注册表里的任务 id。
   ⚠ 两个 id 不一样，别混：**上报时**用的是 Street.jsx 里的裸 id 'tail'
   （announce('tail', TAIL_PROGRESS_WEIGHT)，注册表统一加 'ext:' 前缀），
   **核对 pending 时**用的是加过前缀的注册表 id 'ext:tail'（见 6s 兜底的"可跳过清单"）。
   写反了会变成两个任务：一个是能完成的 ext:tail，一个是永远到不了 100% 的
   ext:ext:tail（实测踩过，会把揭幕闸门永久卡住）。 */
const TAIL_EVENT_ID = 'tail';
const TAIL_TASK_ID = 'ext:tail';
// 首查时刻：到点先问一次「还有救吗」（见 HeroSection 里的 armFailSafe）。有救就每
// 1.5s 复查一次继续等 —— 慢网冷缓存上"还在下载"绝不等于"播不了"。
// 兜底的三道时限（全部是防"永久扣住"的安全网，不是正常路径）：
//   · 本文件的 6s：heroVideoReady && coversPreloaded 之后 6s，只在尾屏/封面异常时生效
//     （它已经以 heroVideoReady 为前置，所以**不会**绕过视频质量闸门）；
//   · 本文件的 15s：终极放行（不看任何闸门）；
//   · index.html 的 18s HARD_CAP：连 JS 都没跑起来时的最后一道。
// ⚠ 2026-10-13：后两道由 9s / 12s 放宽到 15s / 18s —— 业主口径是「先确保视频能流畅
//   播放，再结束 loading」；慢网冷缓存的首屏视频实测 6~12s 才攒够余量，旧的 9s/12s
//   会抢在质量闸门之前揭幕，进去就是卡。等待期间进度条是按视频真实缓冲比例爬的
//   （index.html 给 <video> 登记的 read 就是 buffered/duration），所以"等"是看得见的。
const HERO_SMOOTH_FAILSAFE_MS = 4500;
function HeroSection({ active = true, onVideoReady }) {
  const isMobile = document.documentElement.getAttribute('data-device') === 'mobile';
  const [assetMode, setAssetMode] = useState(() => {
    // WeChat's XWeb kernel refuses programmatic <video>.play() without a real
    // gesture. JSMpeg decodes MPEG-TS in JS and paints to a <canvas>, so no
    // media element exists and the autoplay policy simply does not apply.
    // Only WeChat mobile pays for the (larger) TS asset; every other browser
    // keeps the native video path untouched.
    // WeChat's XWeb kernel refuses programmatic <video>.play() without a real
    // gesture, so inside WeChat we paint to a <canvas> instead: no media
    // element exists and the autoplay policy simply does not apply.
    // WebCodecs (hardware decode, H.264) is preferred over JSMpeg (software
    // decode, MPEG-1); without it we still fall back to JSMpeg.
    if (IS_WECHAT_BROWSER) {
      if (!isMobile) return 'fallback';
      const hasWebCodecs = typeof window !== 'undefined'
        && typeof window.VideoDecoder === 'function'
        && typeof window.EncodedVideoChunk === 'function';
      return hasWebCodecs ? 'mobile-webcodecs' : 'mobile-jsmpeg';
    }
    const video = document.createElement('video');
    const canPlayHEVC = HERO_HEVC_CODEC_TYPES.some((type) => /^(probably|maybe)$/.test(video.canPlayType(type)));
    // index.html 已用 MediaCapabilities 把「这台机器真解得动 HEVC 吗」坐实，结论写进
    // window.__heroHevcProbe，且 hero 视频的 preload 也是按同一个结论发出的。
    // 这里必须复用它：只有明确的 false 才否决 HEVC。探测没落地（undefined）或浏览器
    // 没有该 API 时退回 canPlayType —— 与 index.html 的兜底分支一致，才不会 preload
    // 一套、React 播另一套（那会让两对视频都下载一遍）。
    // 这样定下来之后，assetMode 在首帧就固定，播放过程中不再因为「解不出来」而把
    // base/alpha 两个 <video> 整体重建（key 带 assetMode），两条轨也就不会中途
    // 各换一次源 —— 前景与背景始终来自同一对视频、同一时刻的帧。
    const hevcProbe = typeof window !== 'undefined' ? window.__heroHevcProbe : undefined;
    const supportsHEVC = hevcProbe === false ? false : canPlayHEVC;
    if (isMobile) return supportsHEVC ? 'mobile' : 'mobile-fallback';
    return supportsHEVC ? 'hevc' : 'fallback';
  });
  // Desktop only: flips once the first base+alpha pair is drawn to the
  // canvases, fading the still poster out (it is that exact frame, so the
  // crossfade is invisible).
  const [pcPosterGone, setPcPosterGone] = useState(false);
  // Flips once JSMpeg has painted its first decoded frame, which is the cue to
  // fade the still poster out (otherwise the hero would flash empty over canvas).
  const [jsmpegPainted, setJsmpegPainted] = useState(false);
  const useWebglRenderer = !isMobile && assetMode !== 'alpha2d';
  const useJsmpeg = isMobile && assetMode === 'mobile-jsmpeg';
  const useWebCodecs = isMobile && assetMode === 'mobile-webcodecs';
  // Both canvas paths share one "first frame painted" flag so the poster fades
  // out at the same moment regardless of which decoder won.
  const [canvasPainted, setCanvasPainted] = useState(false);
  const heroTitleMarkup = useMemo(() => {
    // 标记 welcome 的七个白色 path。真正的入场次序在 useLayoutEffect 里按 getBBox().x
    // 从左到右动态计算(见 welcomeOrder)，不依赖这里的编号。
    let welcomePart = 0;
    const splitWelcome = group10Markup.replace(
      /<path\b(?=[^>]*\bfill="white")([^>]*?)\s*\/>/g,
      (_match, attributes) => `<path${attributes} data-welcome-part="${welcomePart++}"/>`
    );
    return splitWelcome
      .replace('<svg ', '<svg class="hero-title-svg" ')
      .replace(/\s+width="[^"]*"\s+height="[^"]*"/, '')
      .replace(/viewBox="[^"]*"/, `viewBox="${GROUP10_VIEWBOX}"`);
  }, []);
  const baseRef = useRef(null);
  const alphaRef = useRef(null);
  const baseCanvasRef = useRef(null);
  const alphaCanvasRef = useRef(null);
  const fallbackAlphaCanvasRef = useRef(null);
  const wrapRef = useRef(null);
  // 移动端副标 "Four Design"：由 hero 的入场 rAF 循环统一驱动，复用同一个揭幕计时起点。
  // bylineRef 量测 R 右缘以定位其左缘；bylineCharRefs 为字符节点(整行统一入场，无逐字错峰)。
  const bylineRef = useRef(null);
  const bylineAlignRef = useRef(false);
  const bylineCharRefs = useRef([]);
  const jsmpegCanvasRef = useRef(null);
  const jsmpegPlayerRef = useRef(null);
  const wcCanvasRef = useRef(null);
  const wcPlayerRef = useRef(null);
  // 首屏视频是否已真正开始播放（只报一次）。尾屏预挂载等这个信号，
  // 保证 WebGL 编译不抢在首屏视频前面。
  const videoReadyRef = useRef(false);
  // Preferred WeChat path: hardware-decode a raw H.264 stream with WebCodecs
  // and paint it onto a canvas. Falls back to JSMpeg (and then to the native
  // video) if the decoder is a stub that never emits frames.
  useEffect(() => {
    if (!useWebCodecs) return undefined;
    let cancelled = false;
    let handle = null;
    const canvas = wcCanvasRef.current;
    if (!canvas) return undefined;
    createWebCodecsPlayer({
      canvas,
      src: HERO_MOBILE_WEBCODECS_SRC,
      width: HERO_MOBILE_WEBCODECS_SIZE.width,
      height: HERO_MOBILE_WEBCODECS_SIZE.height,
      fps: HERO_MOBILE_WEBCODECS_SIZE.fps,
      codec: HERO_MOBILE_WEBCODECS_SIZE.codec,
      onFirstFrame: (err) => {
        if (cancelled) return;
        if (err) { setAssetMode('mobile-jsmpeg'); return; }
        setCanvasPainted(true);
      }
    }).then((player) => {
      if (cancelled) { player.destroy(); return; }
      handle = player;
      wcPlayerRef.current = player;
    }).catch(() => {
      if (!cancelled) setAssetMode('mobile-jsmpeg');
    });
    return () => {
      cancelled = true;
      if (handle) handle.destroy();
      wcPlayerRef.current = null;
    };
  }, [useWebCodecs]);
  // WeChat-only path: decode the MPEG-TS stream with JSMpeg and paint it onto a
  // canvas. No <video> element => no autoplay gate => playback starts on its own.
  // If the decoder never reaches a first frame we fall back to the native video.
  useEffect(() => {
    if (!useJsmpeg) return undefined;
    let cancelled = false;
    let player = null;
    let painted = false;
    const canvas = jsmpegCanvasRef.current;
    if (!canvas) return undefined;
    const bail = () => { if (!cancelled) setAssetMode('mobile-fallback'); };
    const failTimer = window.setTimeout(bail, 9000);
    loadJSMpeg().then((JSMpeg) => {
      if (cancelled || !canvas.isConnected) return;
      player = new JSMpeg.Player(HERO_MOBILE_JSMPEG_SRC, {
        canvas,
        autoplay: true,
        loop: true,
        progressive: true,
        chunkSize: 512 * 1024,
        onVideoDecode: () => {
          if (painted || cancelled) return;
          painted = true;
          window.clearTimeout(failTimer);
          setJsmpegPainted(true);
          setCanvasPainted(true);
        }
      });
      jsmpegPlayerRef.current = player;
    }).catch(bail);
    return () => {
      cancelled = true;
      window.clearTimeout(failTimer);
      if (player) {
        try { player.destroy(); } catch (_) { /* decoder already torn down */ }
      }
      if (jsmpegPlayerRef.current === player) jsmpegPlayerRef.current = null;
    };
  }, [useJsmpeg]);
  // 微信移动端走 canvas 解码（WebCodecs / JSMpeg），页面里根本没有 <video> 元素，
  // 下面那个「playing + readyState>=3 + 缓冲余量」的就绪判据对它完全不成立 —— 那条
  // effect 直接 return，onVideoReady 永远不回调。后果是 HomePage 的揭幕闸门
  // （heroVideoReady && …）永久不开 → app:ready 永不到来 → 首屏 SVG 入场始终停在
  // opacity:0（loading 一消失就只剩视频、标题不出现）。
  // canvas 路径的就绪信号就是「首帧画上画布」，这里补上；解码器始终不出帧时
  // （WebCodecs 是空壳、JSMpeg 超时回落）再用同一个兜底时长强放，绝不让闸门卡死。
  // ⚠ 2026-10-13 再改（业主口径「确保视频能流畅播放，再结束 loading 页」）：原来 4.5s
  //   到点**无条件**放行 —— 微信冷缓存下 2.53MB 的 .264 常常还没下完就被放行，进去只有
  //   poster、随后才一帧帧追上来。现在只要**解码器实例已经在跑**（wcPlayer/jsmpegPlayer
  //   存在 ⇒ 资源在下载/解码中）就每 1.5s 复查，最多等到 WECHAT_WAIT_MS；连解码器都没
  //   建起来（WebCodecs 是空壳、JSMpeg 也没起来）才按 4.5s 放行。最坏仍由 app 级 15s
  //   与 index.html 的 18s HARD_CAP 兜住。
  useEffect(() => {
    if (!onVideoReady || !(useJsmpeg || useWebCodecs)) return undefined;
    if (videoReadyRef.current) return undefined;
    const mark = (reason) => {
      if (videoReadyRef.current) return;
      videoReadyRef.current = true;
      try { window.__heroReadyReason = reason || 'wechat-canvas'; } catch (_) { /* noop */ }
      try { onVideoReady(); } catch (_) { /* noop */ }
    };
    if (canvasPainted) { mark('wechat-canvas-painted'); return undefined; }
    const WECHAT_WAIT_MS = 12000;
    const startedAt = performance.now();
    let timer = 0;
    const check = () => {
      if (videoReadyRef.current) return;
      const decoderRunning = !!(wcPlayerRef.current || jsmpegPlayerRef.current);
      if (decoderRunning && performance.now() - startedAt < WECHAT_WAIT_MS) {
        timer = window.setTimeout(check, 1500);
        return;
      }
      mark(decoderRunning ? 'wechat-timeout' : 'wechat-no-decoder');
    };
    timer = window.setTimeout(check, HERO_SMOOTH_FAILSAFE_MS);
    return () => window.clearTimeout(timer);
  }, [onVideoReady, useJsmpeg, useWebCodecs, canvasPainted]);
  // WeChat kernels block programmatic video.play() until either the visitor
  // interacts OR the page answers WeixinJSBridgeReady (WeChat's own unlock
  // event, which grants playback without a gesture). Retry on a short ladder
  // so whichever unlock arrives first wins.
  useEffect(() => {
    // (Canvas paths need no kick: there is no media element to unlock.)
    if (useJsmpeg || useWebCodecs) return undefined;
    // Desktop may need the kick too: desktop WeChat's embedded Chromium can
    // block autoplay just like its mobile counterpart.
    // Explicit ?dbg=1/#dbg switch only (auto-on for WeChat was temporary diagnosis).
    const debugOverlay = /dbg=1|#dbg/.test(window.location.href);
    const diag = { attempts: 0, bridge: false, mutedAttr: null, lastError: null };
    let overlay = null;
    const paint = (video) => {
      if (!overlay || !video) return;
      overlay.textContent = `${JSON.stringify(diag)}
src=${(video.currentSrc || video.src || '').split('/').pop()}
paused=${video.paused} t=${(video.currentTime || 0).toFixed(2)} rs=${video.readyState}
net=${video.networkState} err=${video.error ? video.error.code : 'none'}`;
    };
    if (debugOverlay && document.body) {
      overlay = document.createElement('div');
      overlay.className = 'hero-debug-overlay';
      Object.assign(overlay.style, {
        position: 'fixed', left: '8px', top: '8px', zIndex: '999999',
        background: 'rgba(0,0,0,0.72)', color: '#7CFF7C', font: '11px/1.45 monospace',
        padding: '6px 8px', borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre'
      });
      document.body.appendChild(overlay);
    }
    const pickVideo = () => document.querySelector('video.hero-mobile-video, video.hero-video-base');
    // 视频就绪广播：不只要「能播」（readyState>=3），还要「能连续播」—— 缓冲里
    // 从当前播放点往前仍有余量，且 base + alpha 两条轨都满足。否则会出现进度条
    // 刚满 100% 视频却卡着不动，那正是 Loading 该挡住的情况。
    // 只用原生 <video> 路径（PC + 非微信移动）；微信走 canvas 解码，没有 video
    // 元素，由下面的轮询兜底。
    let stopReadyWatch = null;
    if (onVideoReady && !videoReadyRef.current) {
      const v = document.querySelector('video.hero-video-base') || document.querySelector('video.hero-mobile-video');
      if (v) {
        const bufferedAhead = (node) => {
          if (!node || !isFinite(node.duration) || !node.duration) return 0;
          const at = node.currentTime || 0;
          let ahead = 0;
          try {
            for (let i = 0; i < node.buffered.length; i += 1) {
              const start = node.buffered.start(i);
              const end = node.buffered.end(i);
              if (at + 0.05 >= start && at <= end) ahead = Math.max(ahead, end - at);
            }
          } catch (_) { return 0; }
          return ahead;
        };
        /* 2026-10-13 业主口径：「确保视频能够流畅播放的情况下，再结束 loading 页」。
           只要求"手里有 2.5s"还不够 —— 若此刻的下载速度**慢于**播放速度，2.5s 之后
           必然二次卡顿（这正是"进度条满了、进去先卡几秒"的成因）。所以"能连续播"的
           判据补上"不会断粮"这一条，三者取或（任一成立即视为不会断粮）：
             · ample：余量 ≥ 4s（或已覆盖片子剩余部分）；
             · fullyBuffered：覆盖播放点的那段缓冲已经追到片尾；
             · fillHealthy：实测缓冲填充速率 ≥ 1.1× 播放速度（缓冲在变厚）。
           速率用 WeakMap 按元素分别采样，采样窗口不足 0.9s 时**不给结论**（返回
           false），以免用一次抖动的采样误判成"会断粮"而白等。 */
        const FILL_MIN_RATE = 1.1;
        const FILL_WINDOW_MS = 900;
        const fillSamples = new WeakMap();
        const bufferedEndAt = (node) => {
          if (!node) return 0;
          const at = node.currentTime || 0;
          try {
            for (let i = 0; i < node.buffered.length; i += 1) {
              if (at + 0.05 >= node.buffered.start(i) && at <= node.buffered.end(i)) return node.buffered.end(i);
            }
          } catch (_) { return 0; }
          return 0;
        };
        const fillHealthy = (node) => {
          const end = bufferedEndAt(node);
          const now = performance.now();
          if (!end) return false;
          const prev = fillSamples.get(node);
          if (!prev) { fillSamples.set(node, { t: now, end }); return false; }
          const dt = (now - prev.t) / 1000;
          if (dt * 1000 < FILL_WINDOW_MS) return false;
          const rate = (end - prev.end) / dt;
          fillSamples.set(node, { t: now, end });
          return rate >= FILL_MIN_RATE;
        };
        const smooth = (node) => {
          if (!node) return false;
          if (node.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return false;
          // 真的在动才算：缓冲够了但被自动播放策略摁住的，交给兜底放行。
          if (node.paused && (node.currentTime || 0) <= 0.05) return false;
          const dur = isFinite(node.duration) && node.duration ? node.duration : 0;
          const need = dur ? Math.min(HERO_SMOOTH_AHEAD_SEC, dur * 0.5) : HERO_SMOOTH_AHEAD_SEC;
          const runway = bufferedAhead(node);
          if (runway < need) return false;
          const rest = dur ? Math.max(0, dur - (node.currentTime || 0)) : Infinity;
          const fullyBuffered = rest <= runway + 0.25;
          const ample = runway >= Math.min(Math.max(need * 1.6, 4), rest || Infinity);
          return ample || fullyBuffered || fillHealthy(node);
        };
        const heroSmooth = () => {
          const list = [v];
          document.querySelectorAll('video.hero-video-alpha').forEach((extra) => list.push(extra));
          return list.every(smooth);
        };
        const mark = (force, reason) => {
          if (videoReadyRef.current) return;
          if (!force && !heroSmooth()) return;
          videoReadyRef.current = true;
          // 自查用：揭幕时是"真的攒够了"还是走了某条兜底（控制台 window.__heroReadyReason）
          try { window.__heroReadyReason = reason || (force ? 'forced' : 'smooth'); } catch (_) { /* noop */ }
          if (stopReadyWatch) { stopReadyWatch(); stopReadyWatch = null; }
          try { onVideoReady(); } catch (_) { /* noop */ }
        };
        const onProgress = () => mark(false, 'smooth');
        v.addEventListener('playing', onProgress);
        v.addEventListener('canplay', onProgress);
        v.addEventListener('progress', onProgress);
        v.addEventListener('timeupdate', onProgress);
        const smoothPoll = window.setInterval(onProgress, 200);
        /* 兜底放行的判据（2026-10-13 再改，业主口径「确保能流畅播放再结束 loading」）。
           ⚠ 上一版这里有个洞：判据是 `readyState >= HAVE_CURRENT_DATA(2) && bufferedAhead > 0`，
             冷缓存慢网在 4.5s 时常常**还停在 readyState 1**（只拿到元数据、第一帧没解码），
             于是被判成"死了" → mark(true) 强放行 → heroVideoReady 提前为真 → app 级 6s
             兜底随即揭幕 —— 用户看到的就是"进度条满了、进去视频卡几秒"。**这才是根因。**
           ⚠ 2026-10-13 二改：**「还没开始」不等于「卡死」**。实测（hero-gate-check TAG=hold，
             把 mp4 请求扣住 9s 模拟"视频排在 JS 后面"）发现：视频一个字节都没到时，
             旧判据 5s 就判 `!byteFlow()` → 6.7s 揭幕，那一刻 readyState 还是 0 ——
             遮罩照样在视频前面收掉了。现在把两者分开：
             · 有数据了又停（stalled）   —— STALL_MS(5s) 无新数据 → 认输放行；
             · 一直没数据（never-started）—— 宽限到 NEVER_START_MS(12s) 才认输
               （请求可能只是排在模块/封面后面，不是失败）；
             加上两种立刻认输的情形：
             · error                     —— 请求/解码彻底失败；
             · autoplayBlocked           —— 数据已够（rs>=3）却被自动播放策略摁住，
                                            再等也不会自己播起来（由 poster 顶着，交还用户手势）。
           仍在下载 → 每 1.5s 复查一次；最坏情况由 app 级 15s 与 index.html 的 18s HARD_CAP
           兜住，绝不会把首屏永久扣住。认输原因写在 window.__heroReadyReason 里可自查。 */
        const STALL_MS = 5000;
        const NEVER_START_MS = 12000;
        let lastDataAt = performance.now();
        let lastEnd = 0;
        let lastRs = 0;
        const noteData = () => {
          const end = bufferedEndAt(v);
          if (end > lastEnd + 0.01 || v.readyState > lastRs) {
            lastEnd = Math.max(lastEnd, end);
            lastRs = v.readyState;
            lastDataAt = performance.now();
          }
        };
        const dataEvents = ['progress', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'timeupdate'];
        dataEvents.forEach((ev) => v.addEventListener(ev, noteData));
        const hadData = () => lastEnd > 0 || v.readyState >= HTMLMediaElement.HAVE_METADATA;
        const quietFor = () => performance.now() - lastDataAt;
        const autoplayBlocked = () => v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
          && v.paused && (v.currentTime || 0) <= 0.05;
        const giveUpReason = () => {
          if (v.error) return 'error';
          if (autoplayBlocked()) return 'autoplay-blocked';
          if (hadData() && quietFor() >= STALL_MS) return 'stalled';
          if (!hadData() && quietFor() >= NEVER_START_MS) return 'never-started';
          return null;
        };
        let smoothFailSafe = 0;
        const armFailSafe = (delay) => {
          smoothFailSafe = window.setTimeout(() => {
            if (videoReadyRef.current) return;
            const reason = giveUpReason();
            if (!reason) { armFailSafe(1500); return; }
            mark(true, reason);
          }, delay);
        };
        armFailSafe(HERO_SMOOTH_FAILSAFE_MS);
        stopReadyWatch = () => {
          window.clearInterval(smoothPoll);
          window.clearTimeout(smoothFailSafe);
          v.removeEventListener('playing', onProgress);
          v.removeEventListener('canplay', onProgress);
          v.removeEventListener('progress', onProgress);
          v.removeEventListener('timeupdate', onProgress);
          dataEvents.forEach((ev) => v.removeEventListener(ev, noteData));
        };
      }
    }
    /* ⚠ 出屏之后不许再"救活"hero（2026-10-10 实测定位到的那次 reintroduce）：
       本看门狗的重试（400/1200/2600/5000/8000ms，见下方 timers）与手势监听都挂在
       window 上，而它只认 `paused`、不认「在不在屏」。用户翻到尾屏时首屏视频已被
       出屏暂停，若此刻那次 8s 重试（或任意一次 wheel/scroll 手势）落下，就会把
       已经在视口外 2700px 的视频重新拉起 —— 解码 + 逐帧合成继续烧（每帧 2 次
       drawImage + 1 次 getError 同步往返），而且**没有任何东西会再把它按下去**：
       出屏暂停只由 IntersectionObserver 的边界事件触发，元素一直不在视口里就
       不会再报第二次。判据直接用 DOM 实测，不依赖别处的状态，保证两套逻辑解耦。 */
    const heroStageOnScreen = (video) => {
      const stage = video && video.closest ? video.closest('.hero-video-stage') : null;
      if (!stage) return true;                        // 找不到舞台 → 按"在屏"处理，不误伤
      const rect = stage.getBoundingClientRect();
      // 尺寸为 0 = 还没排好版（或不可测）→ 同样按"在屏"处理，绝不用它挡掉正常起播。
      if (!rect.width && !rect.height) return true;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      return rect.bottom > 0 && rect.top < vh;
    };
    const kick = () => {
      const video = pickVideo();
      if (!video) return;
      diag.attempts += 1;
      diag.mutedAttr = video.hasAttribute('muted');
      // 已出屏（用户翻到二级/尾屏）→ 不救援、不绘制，本次直接放行。
      if (!heroStageOnScreen(video)) return;
      if (!video.paused || video.ended) { paint(video); return; }
      // The desktop hero pairs a base clip with a matte clip; both must run.
      document.querySelectorAll('video.hero-video-alpha').forEach((extra) => {
        if (extra.paused) { const p = extra.play(); if (p && p.catch) p.catch(() => {}); }
      });
      const attempt = video.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.then(() => {
          disarm();
        }).catch((error) => {
          diag.lastError = `${error && error.name}: ${error && error.message}`;
          paint(video);
        });
      }
      paint(video);
    };
    kick();
    const timers = [400, 1200, 2600, 5000, 8000].map((delay) => window.setTimeout(kick, delay));
    const onBridgeReady = () => {
      diag.bridge = true;
      window.setTimeout(() => {
        kick();
      // Stubborn XWeb builds refuse every programmatic play() except one issued
      // from inside a WeixinJSBridge invoke callback (WeChat treats it as a
      // user-initiated context). Try that as the strongest available unlock.
      try {
        const bridge = window.WeixinJSBridge;
        if (bridge && typeof bridge.invoke === 'function') {
          bridge.invoke('getNetworkType', {}, () => window.setTimeout(kick, 30));
        }
      } catch (_) { /* bridge unavailable; ignore */ }
      }, 60);
    };
    if (typeof window !== 'undefined' && window.WeixinJSBridge) onBridgeReady();
    document.addEventListener('WeixinJSBridgeReady', onBridgeReady, false);
    // Any of these count as a user gesture (WeChat lets swipes through too), so
    // keep them armed until playback actually starts — a `{ once: true }` listener
    // can be burned by an attempt that fails while the video is still buffering.
    const GESTURE_EVENTS = ['touchstart', 'touchmove', 'click', 'pointerdown', 'wheel', 'scroll', 'keydown'];
    const gestureOptions = { passive: true, capture: true };
    function disarm() {
      GESTURE_EVENTS.forEach((event) => window.removeEventListener(event, kick, gestureOptions));
    }
    GESTURE_EVENTS.forEach((event) => window.addEventListener(event, kick, gestureOptions));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener('WeixinJSBridgeReady', onBridgeReady);
      disarm();
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (stopReadyWatch) { stopReadyWatch(); stopReadyWatch = null; }
    };
  }, [assetMode, isMobile, useJsmpeg]);
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const hoverTargetRef = useRef(0);

  useEffect(() => {
    if (isMobile) return undefined;
    const base = baseRef.current;
    const alpha = alphaRef.current;
    const baseCanvas = baseCanvasRef.current;
    const alphaCanvas = useWebglRenderer ? alphaCanvasRef.current : fallbackAlphaCanvasRef.current;
    if (!base || !alpha || !baseCanvas || !alphaCanvas) return undefined;

    const baseContext = baseCanvas.getContext('2d', { alpha: false });
    const alphaGl = useWebglRenderer && typeof WebGLRenderingContext !== 'undefined'
      ? alphaCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true })
      : null;
    const alphaContext = alphaGl ? null : (!useWebglRenderer ? alphaCanvas.getContext('2d', { alpha: true }) : null);
    if (!baseContext || (useWebglRenderer && !alphaGl)) {
      if (assetMode === 'hevc') setAssetMode('fallback');
      else if (assetMode === 'fallback') setAssetMode('alpha2d');
      return undefined;
    }
    if (!useWebglRenderer && !alphaContext) return undefined;
    let matteProgram = null;
    let matteTextures = null;
    if (alphaGl) {
      const compileShader = (type, source) => {
        const shader = alphaGl.createShader(type);
        alphaGl.shaderSource(shader, source);
        alphaGl.compileShader(shader);
        if (!alphaGl.getShaderParameter(shader, alphaGl.COMPILE_STATUS)) throw new Error(alphaGl.getShaderInfoLog(shader));
        return shader;
      };
      try {
        const vertex = compileShader(alphaGl.VERTEX_SHADER, 'attribute vec2 p; attribute vec2 uv; varying vec2 vUv; void main(){gl_Position=vec4(p,0.0,1.0);vUv=uv;}');
        const fragment = compileShader(alphaGl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 vUv; uniform sampler2D colorTex; uniform sampler2D matteTex; void main(){vec4 c=texture2D(colorTex,vUv);vec3 m=texture2D(matteTex,vUv).rgb;float a=dot(m,vec3(0.2126,0.7152,0.0722));gl_FragColor=vec4(c.rgb,a);}');
        matteProgram = alphaGl.createProgram();
        alphaGl.attachShader(matteProgram, vertex);
        alphaGl.attachShader(matteProgram, fragment);
        alphaGl.linkProgram(matteProgram);
        if (!alphaGl.getProgramParameter(matteProgram, alphaGl.LINK_STATUS)) throw new Error(alphaGl.getProgramInfoLog(matteProgram));
        alphaGl.useProgram(matteProgram);
        const vertices = new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]);
        const buffer = alphaGl.createBuffer();
        alphaGl.bindBuffer(alphaGl.ARRAY_BUFFER, buffer);
        alphaGl.bufferData(alphaGl.ARRAY_BUFFER, vertices, alphaGl.STATIC_DRAW);
        const position = alphaGl.getAttribLocation(matteProgram, 'p');
        const uv = alphaGl.getAttribLocation(matteProgram, 'uv');
        alphaGl.enableVertexAttribArray(position);
        alphaGl.vertexAttribPointer(position, 2, alphaGl.FLOAT, false, 16, 0);
        alphaGl.enableVertexAttribArray(uv);
        alphaGl.vertexAttribPointer(uv, 2, alphaGl.FLOAT, false, 16, 8);
        matteTextures = [0, 1].map((unit, index) => {
          const texture = alphaGl.createTexture();
          alphaGl.activeTexture(alphaGl.TEXTURE0 + unit);
          alphaGl.bindTexture(alphaGl.TEXTURE_2D, texture);
          alphaGl.texParameteri(alphaGl.TEXTURE_2D, alphaGl.TEXTURE_MIN_FILTER, alphaGl.LINEAR);
          alphaGl.texParameteri(alphaGl.TEXTURE_2D, alphaGl.TEXTURE_MAG_FILTER, alphaGl.LINEAR);
          alphaGl.texParameteri(alphaGl.TEXTURE_2D, alphaGl.TEXTURE_WRAP_S, alphaGl.CLAMP_TO_EDGE);
          alphaGl.texParameteri(alphaGl.TEXTURE_2D, alphaGl.TEXTURE_WRAP_T, alphaGl.CLAMP_TO_EDGE);
          alphaGl.uniform1i(alphaGl.getUniformLocation(matteProgram, index ? 'matteTex' : 'colorTex'), unit);
          return texture;
        });
        // The quad's uv layout already puts v=1 at clip-space bottom, which is
        // exactly what an unflipped texImage2D upload needs (v=0 -> image top
        // row). Adding UNPACK_FLIP_Y_WEBGL on top of that flipped the whole
        // foreground: the cat-shaped mask landed at the top of the screen and
        // cropped the sky pixels into a mirror-image cat above the real one.
      } catch {
        setAssetMode('fallback');
        return undefined;
      }
    }
    /* getError() 是同步往返：它把命令缓冲刷给驱动并等回执。合成循环**每帧**都调一次，
       而它只是在"确认上一次绘制没出错"（见下方 throw → 降级 fallback 那条路）。
       实测首页静置 4s 窗口吃掉约 50ms 主线程（占比 ~1.2%），纯粹是白付。
       改为抽样：前 24 帧逐帧查（初始化/首帧纹理上传最容易出问题），之后每 24 帧查一次。
       真错误仍走同一条 fallback，最多晚 24 帧上报（满帧约 0.4s）—— 那点时间里画面
       本来就是坏的，早报晚报对观感没有差别。 */
    const MATTE_ERROR_DENSE_FRAMES = 24;
    const MATTE_ERROR_INTERVAL = 24;
    let matteErrorCountdown = MATTE_ERROR_DENSE_FRAMES;
    const renderMatte = (colorSnapshot, matteSnapshot) => {
      alphaGl.viewport(0, 0, alphaCanvas.width, alphaCanvas.height);
      [colorSnapshot, matteSnapshot].forEach((snapshot, index) => {
        alphaGl.activeTexture(alphaGl.TEXTURE0 + index);
        alphaGl.bindTexture(alphaGl.TEXTURE_2D, matteTextures[index]);
        alphaGl.texImage2D(alphaGl.TEXTURE_2D, 0, alphaGl.RGBA, alphaGl.RGBA, alphaGl.UNSIGNED_BYTE, snapshot);
      });
      alphaGl.drawArrays(alphaGl.TRIANGLE_STRIP, 0, 4);
      if (--matteErrorCountdown <= 0) {
        matteErrorCountdown = MATTE_ERROR_INTERVAL;
        if (alphaGl.getError() !== alphaGl.NO_ERROR) throw new Error('WebGL matte render failed');
      }
    };

    const pending = { base: new Map(), alpha: new Map() };
    const frameState = {
      base: { last: -1, cycle: 0 },
      alpha: { last: -1, cycle: 0 }
    };
    const callbackIds = { base: 0, alpha: 0 };
    const latestKey = { base: -1, alpha: -1 };
    const FRAME_WRAP_THRESHOLD = Math.floor(HERO_FRAME_COUNT / 2);
    const MAX_PENDING_PER_VIDEO = 3;
    const STALL_CHECK_MS = 900;
    const STALL_GRACE_MS = 1800;
    const RECOVERY_COOLDOWN_MS = 1400;
    const playbackStartAt = performance.now();
    let disposed = false;
    let fallbackRaf = 0;
    let stallTimer = 0;
    let lastProgressTime = { base: -1, alpha: -1 };
    let lastProgressFrame = { base: -1, alpha: -1 };
    let lastDecoderProgressAt = { base: playbackStartAt, alpha: playbackStartAt };
    let lastPresentedAt = 0;
    let hasPresentedFrame = false;
    let mediaWarningAt = 0;
    let lastRecoveryAt = -Infinity;
    let recoveryIgnoreUntil = 0;
    let recoveryCount = 0;
    let resizeObserver;
    let visiblePair = null;
    let lastPresentedKey = -1;
    let showImmediatePair = false;

    // Keep at most one spare per alpha mode; pending/visible ownership stays unchanged.
    const snapshotSpare = [[], []];
    const snapshotInfo = new WeakMap();
    const discardSnapshot = (snapshot) => {
      snapshot.width = 1;
      snapshot.height = 1;
    };
    const clearSnapshotSpare = () => {
      snapshotSpare.forEach((pool) => {
        pool.forEach(discardSnapshot);
        pool.length = 0;
      });
    };
    const releaseSnapshot = (snapshot) => {
      if (!snapshot) return;
      const info = snapshotInfo.get(snapshot);
      if (info && info.pooled) return;
      const owner = info && info.keepAlpha ? alphaCanvas : baseCanvas;
      const pool = info && snapshotSpare[info.keepAlpha ? 1 : 0];
      if (!disposed && info && snapshot.width === owner.width && snapshot.height === owner.height && pool.length < 1) {
        info.pooled = true;
        pool.push(snapshot);
      } else {
        discardSnapshot(snapshot);
      }
    };
    const clearPending = (role, queues = pending, states = frameState) => {
      queues[role].forEach(releaseSnapshot);
      queues[role].clear();
      states[role].last = -1;
      states[role].cycle = 0;
      if (queues === pending) latestKey[role] = -1;
    };
    const resizeCanvases = () => {
      [baseCanvas, alphaCanvas].forEach((canvas) => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const scale = Math.min(dpr, HERO_FRAME_WIDTH / rect.width, HERO_FRAME_HEIGHT / rect.height);
        const width = Math.max(1, Math.round(rect.width * scale));
        const height = Math.max(1, Math.round(rect.height * scale));
        if (canvas.width !== width || canvas.height !== height) {
          clearSnapshotSpare();
          canvas.width = width;
          canvas.height = height;
        }
      });
    };
    const makeSnapshot = (video, canvas, keepAlpha) => {
      const width = canvas.width || HERO_FRAME_WIDTH;
      const height = canvas.height || HERO_FRAME_HEIGHT;
      const pool = snapshotSpare[keepAlpha ? 1 : 0];
      let snapshot = pool.pop();
      if (snapshot && (snapshot.width !== width || snapshot.height !== height)) {
        discardSnapshot(snapshot);
        snapshot = null;
      }
      if (!snapshot) {
        snapshot = typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, height)
          : document.createElement('canvas');
        snapshot.width = width;
        snapshot.height = height;
        const context = snapshot.getContext('2d', { alpha: keepAlpha });
        if (!context) { discardSnapshot(snapshot); return null; }
        snapshotInfo.set(snapshot, { keepAlpha, context, pooled: false });
      }
      const info = snapshotInfo.get(snapshot);
      info.pooled = false;
      const context = info.context;
      // Match a fresh bitmap for both transparent and alpha:false canvases.
      context.clearRect(0, 0, width, height);
      const sourceWidth = video.videoWidth || HERO_FRAME_WIDTH;
      const sourceHeight = video.videoHeight || HERO_FRAME_HEIGHT;
      const cover = Math.max(width / sourceWidth, height / sourceHeight);
      const cropWidth = width / cover;
      const cropHeight = height / cover;
      const sx = (sourceWidth - cropWidth) / 2;
      const sy = (sourceHeight - cropHeight) / 2;
      context.drawImage(video, sx, sy, cropWidth, cropHeight, 0, 0, width, height);
      return snapshot;
    };
    const drawSnapshot = (canvas, context, snapshot) => {
      if (!snapshot || !canvas.width || !canvas.height || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(snapshot, 0, 0, canvas.width, canvas.height);
    };
    const drawPair = (baseSnapshot, alphaSnapshot) => {
      drawSnapshot(baseCanvas, baseContext, baseSnapshot);
      if (alphaGl) renderMatte(baseSnapshot, alphaSnapshot);
      else drawSnapshot(alphaCanvas, alphaContext, alphaSnapshot);
    };
    const redrawVisiblePair = () => {
      resizeCanvases();
      if (!visiblePair) return;
      try {
        drawPair(visiblePair.base, visiblePair.alpha);
      } catch {
        if (assetMode === 'hevc') setAssetMode('fallback');
        else if (assetMode === 'fallback') setAssetMode('alpha2d');
      }
    };
    resizeCanvases();
    const trimPending = (role) => {
      const queue = pending[role];
      while (queue.size > MAX_PENDING_PER_VIDEO) {
        const oldestKey = Math.min(...queue.keys());
        releaseSnapshot(queue.get(oldestKey));
        queue.delete(oldestKey);
      }
      const otherRole = role === 'base' ? 'alpha' : 'base';
      const otherLatest = latestKey[otherRole];
      if (otherLatest < 0) return;
      const oldestUsefulKey = otherLatest - MAX_PENDING_PER_VIDEO;
      queue.forEach((snapshot, key) => {
        if (key < oldestUsefulKey) {
          releaseSnapshot(snapshot);
          queue.delete(key);
        }
      });
    };
    const presentMatchingPair = () => {
      const commonKeys = [...pending.base.keys()].filter((key) => pending.alpha.has(key));
      if (!commonKeys.length) return;
      const key = Math.max(...commonKeys);
      if (!showImmediatePair && key <= lastPresentedKey) return;
      const baseSnapshot = pending.base.get(key);
      const alphaSnapshot = pending.alpha.get(key);
      if (!baseSnapshot || !alphaSnapshot) return;

      try {
        drawPair(baseSnapshot, alphaSnapshot);
      } catch {
        if (assetMode === 'hevc') setAssetMode('fallback');
        else if (assetMode === 'fallback') setAssetMode('alpha2d');
        return;
      }
      showImmediatePair = false;
      baseCanvas.dataset.framePairKey = String(key);
      alphaCanvas.dataset.framePairKey = String(key);
      const pairCount = Number(baseCanvas.dataset.framePairCount || 0) + 1;
      baseCanvas.dataset.framePairCount = String(pairCount);
      alphaCanvas.dataset.framePairCount = String(pairCount);
      const previousPair = visiblePair;
      visiblePair = { key, base: baseSnapshot, alpha: alphaSnapshot };
      lastPresentedKey = key;
      lastPresentedAt = performance.now();
      hasPresentedFrame = true;
      // First composited pair is on screen — retire the still poster. Called
      // again after seeks (hasPresentedFrame resets there) but setting the
      // same value is a no-op for React.
      setPcPosterGone(true);
      pending.base.delete(key);
      pending.alpha.delete(key);
      if (previousPair) {
        releaseSnapshot(previousPair.base);
        releaseSnapshot(previousPair.alpha);
      }
      pending.base.forEach((snapshot, pendingKey) => {
        if (pendingKey <= key) {
          releaseSnapshot(snapshot);
          pending.base.delete(pendingKey);
        }
      });
      pending.alpha.forEach((snapshot, pendingKey) => {
        if (pendingKey <= key) {
          releaseSnapshot(snapshot);
          pending.alpha.delete(pendingKey);
        }
      });
    };
    const getFrameKey = (role, video, metadata) => {
      const mediaTime = Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime : video.currentTime;
      if (!Number.isFinite(mediaTime)) return -1;
      const frame = Math.max(0, Math.min(HERO_FRAME_COUNT - 1, Math.round(mediaTime * HERO_FRAME_FPS)));
      const state = frameState[role];
      if (state.last >= 0 && state.last - frame > FRAME_WRAP_THRESHOLD) state.cycle += 1;
      state.last = frame;
      return state.cycle * HERO_FRAME_COUNT + frame;
    };
    const capture = (role, video, metadata) => {
      if (disposed || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const key = getFrameKey(role, video, metadata);
      if (key < 0 || key === latestKey[role] || key <= lastPresentedKey) return;
      latestKey[role] = key;
      const canvas = role === 'base' ? baseCanvas : alphaCanvas;
      const snapshot = makeSnapshot(video, canvas, role === 'alpha');
      if (!snapshot) return;
      const previous = pending[role].get(key);
      if (previous) releaseSnapshot(previous);
      pending[role].set(key, snapshot);
      trimPending(role);
      presentMatchingPair();
    };
    const noteDecoderProgress = (role, mediaTime) => {
      const previousTime = lastProgressTime[role];
      const previousFrame = lastProgressFrame[role];
      const frame = Number.isFinite(mediaTime)
        ? Math.round(mediaTime * HERO_FRAME_FPS) % HERO_FRAME_COUNT
        : -1;
      if (frame !== previousFrame || (Number.isFinite(mediaTime) && Math.abs(mediaTime - previousTime) > 0.001)) {
        lastProgressTime[role] = mediaTime;
        lastProgressFrame[role] = frame;
        lastDecoderProgressAt[role] = performance.now();
      }
    };
    const onVideoFrame = (role, video, now, metadata) => {
      callbackIds[role] = 0;
      const mediaTime = Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime : video.currentTime;
      noteDecoderProgress(role, mediaTime);
      if (!base.seeking && !alpha.seeking) capture(role, video, metadata);
      if (!disposed && !video.paused && !video.ended && !base.seeking && !alpha.seeking) {
        callbackIds[role] = video.requestVideoFrameCallback((nextNow, nextMetadata) => onVideoFrame(role, video, nextNow, nextMetadata));
      }
    };
    const cancelVideoFrameCallbacks = () => {
      [['base', base], ['alpha', alpha]].forEach(([role, video]) => {
        if (callbackIds[role] && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(callbackIds[role]);
        }
        callbackIds[role] = 0;
      });
    };
    const startVideoFrameCallback = (role, video) => {
      if (typeof video.requestVideoFrameCallback !== 'function' || callbackIds[role] || video.paused || base.seeking || alpha.seeking) return;
      callbackIds[role] = video.requestVideoFrameCallback((now, metadata) => onVideoFrame(role, video, now, metadata));
    };
    const startBothVideoFrameCallbacks = () => {
      if (base.seeking || alpha.seeking) return;
      startVideoFrameCallback('base', base);
      startVideoFrameCallback('alpha', alpha);
    };
    const fallbackTick = () => {
      if (disposed) return;
      noteDecoderProgress('base', base.currentTime);
      noteDecoderProgress('alpha', alpha.currentTime);
      capture('base', base, { mediaTime: base.currentTime });
      capture('alpha', alpha, { mediaTime: alpha.currentTime });
      fallbackRaf = window.requestAnimationFrame(fallbackTick);
    };
    const safePlay = (video) => {
      if (!video || video.ended) {
        try { video.currentTime = 0; } catch {}
      }
      const promise = video.play();
      if (promise?.catch) promise.catch(() => {});
    };
    const recoverPlayback = (reason) => {
      if (disposed || base.seeking || alpha.seeking) return;
      const now = performance.now();
      if (!hasPresentedFrame && now - playbackStartAt < STALL_GRACE_MS) return;
      if (now < recoveryIgnoreUntil || now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) return;
      lastRecoveryAt = now;
      recoveryIgnoreUntil = now + 900;
      recoveryCount += 1;
      const baseTime = Number.isFinite(base.currentTime) ? base.currentTime : 0;
      const alphaTime = Number.isFinite(alpha.currentTime) ? alpha.currentTime : baseTime;
      const targetTime = Math.max(0, Math.min(base.duration || Number.POSITIVE_INFINITY, baseTime));
      const targetAlphaTime = Math.max(0, Math.min(alpha.duration || Number.POSITIVE_INFINITY, targetTime));
      try { base.pause(); } catch {}
      try { alpha.pause(); } catch {}
      cancelVideoFrameCallbacks();
      clearPending('base');
      clearPending('alpha');
      frameState.base.last = -1;
      frameState.alpha.last = -1;
      frameState.base.cycle = 0;
      frameState.alpha.cycle = 0;
      lastPresentedKey = -1;
      showImmediatePair = true;
      try { base.currentTime = targetTime; } catch {}
      try { alpha.currentTime = targetAlphaTime; } catch {}
      lastProgressTime.base = -1;
      lastProgressTime.alpha = -1;
      lastProgressFrame.base = -1;
      lastProgressFrame.alpha = -1;
      lastDecoderProgressAt.base = now;
      lastDecoderProgressAt.alpha = now;
      hasPresentedFrame = false;
      lastPresentedAt = now;
      window.setTimeout(() => {
        if (disposed) return;
        safePlay(base);
        safePlay(alpha);
        startBothVideoFrameCallbacks();
      }, 80);
      base.dataset.recoveryCount = String(recoveryCount);
      base.dataset.recoveryReason = reason;
    };
    let heroInView = true;      // hero 是否在视口内（交叉观察器维护）
    let visibilityObserver = null;
    // 滚动期保护：翻页/滚动会让解码短时跟不上（waiting/stalled/帧间停顿），但这是
    // 瞬时且正常的，不该被看门狗当成"真卡死"。更关键的是，降级链 hevc→fallback→
    // alpha2d 是靠换 assetMode 实现的，base/alpha 两个 <video> 会被整体重建（key 带
    // assetMode），其中 fallback→alpha2d 只换 alpha 的源、base 源不变 —— 一旦在滚动
    // 中被误触发，两条轨就会重新起播并错开，画面里猫（前景）和天空（背景）不再是同
    // 一帧。所以滚动刚结束时一律不降级，等网络/解码缓过来再说（真错误稍后仍会触发）。
    let lastScrollAt = 0;
    const noteScroll = () => { lastScrollAt = performance.now(); };
    window.addEventListener('scroll', noteScroll, { passive: true });
    // 两轨时间差超过这个值就认为错帧了，强制把 alpha 拉回 base 的时刻重播。
    const HERO_SYNC_TOLERANCE = 0.4;
    // 滚动刚过去多久之内，抑制降级与重同步（避免滚动中触发 seek 造成抖动）。
    const SCROLL_QUIET_MS = 1200;
    const RESYNC_COOLDOWN_MS = 1000;
    let lastResyncAt = 0;
    // base 是主时钟（背景），alpha（前景遮罩）跟着它走。把 alpha seek 到 base 的
    // 当前时刻即可让两轨重新同帧；seeked 处理器本来就会重排帧配对，不需要另写逻辑。
    const resyncPair = () => {
      if (disposed || base.seeking || alpha.seeking) return;
      const now = performance.now();
      if (now - lastResyncAt < RESYNC_COOLDOWN_MS) return;
      lastResyncAt = now;
      const target = Number.isFinite(base.currentTime) ? base.currentTime : 0;
      baseCanvas.dataset.syncCount = String(Number(baseCanvas.dataset.syncCount || 0) + 1);
      showImmediatePair = true;
      try { alpha.currentTime = Math.max(0, Math.min(alpha.duration || Number.POSITIVE_INFINITY, target)); } catch {}
    };

    const checkForStall = () => {
      if (disposed) return;
      // 因滚动出屏而被我们主动暂停时，别把"暂停"误判成"卡死"再拉起来。
      if (!heroInView) { stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS); return; }
      const now = performance.now();
      // 滚动进行中 / 刚结束：暂停一切破坏性处理（降级、重同步）。滚动带来的解码停顿
      // 是瞬时的，等它过去再看；否则一次快速滚动就可能把双轨整体重建、永久错帧。
      if (now - lastScrollAt < SCROLL_QUIET_MS) {
        stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS);
        return;
      }
      // 同步守卫：两轨都取到过帧之后，若它们的当前时刻已经错开超过容差，说明某条轨
      // 被单独重建过（降级）或解码滞后了 —— 画面会出现"前景是这帧、背景是另一帧"。
      // 代价小的解法是主动把 alpha seek 回 base 的时刻，让两条轨重新对齐。
      if (hasPresentedFrame && !base.seeking && !alpha.seeking
        && Number.isFinite(base.currentTime) && Number.isFinite(alpha.currentTime)
        && Math.abs(base.currentTime - alpha.currentTime) > HERO_SYNC_TOLERANCE) {
        resyncPair();
        stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS);
        return;
      }
      if (now < recoveryIgnoreUntil) {
        stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS);
        return;
      }
      const waitingForInitialFrame = !hasPresentedFrame && now - playbackStartAt > STALL_GRACE_MS;
      const baseStopped = hasPresentedFrame && !base.paused && !base.ended && now - lastDecoderProgressAt.base > STALL_CHECK_MS;
      const alphaStopped = hasPresentedFrame && !alpha.paused && !alpha.ended && now - lastDecoderProgressAt.alpha > STALL_CHECK_MS;
      const pairStopped = hasPresentedFrame && now - lastPresentedAt > STALL_CHECK_MS;
      const unexpectedlyPaused = hasPresentedFrame && (base.paused || alpha.paused);
      if ((assetMode === 'hevc' || assetMode === 'fallback') && (waitingForInitialFrame || baseStopped || alphaStopped || pairStopped)) {
        baseCanvas.dataset.fallbackReason = waitingForInitialFrame ? 'hevc-no-first-frame' : 'hevc-frame-stalled';
        if (assetMode === 'hevc') setAssetMode('fallback');
        else setAssetMode('alpha2d');
        return;
      }
      if (waitingForInitialFrame || baseStopped || alphaStopped || pairStopped || unexpectedlyPaused) {
        recoverPlayback(waitingForInitialFrame ? 'initial-frame' : unexpectedlyPaused ? 'paused' : pairStopped ? 'frame-pair-stalled' : baseStopped ? 'base-stalled' : 'alpha-stalled');
      }
      stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS);
    };
    const onMediaError = () => {
      if (!heroInView) return;
      if (assetMode === 'hevc') {
        baseCanvas.dataset.fallbackReason = 'hevc-media-error';
        setAssetMode('fallback');
        return;
      }
      if (assetMode === 'fallback') {
        baseCanvas.dataset.fallbackReason = 'fallback-media-error';
        setAssetMode('alpha2d');
        return;
      }
      const now = performance.now();
      if (now - mediaWarningAt > STALL_CHECK_MS) {
        mediaWarningAt = now;
        recoverPlayback('media-error');
      }
    };
    const onWaiting = () => {
      if (!heroInView) return;
      window.setTimeout(() => {
        if (!disposed && (!base.paused || !alpha.paused)) checkForStall();
      }, STALL_CHECK_MS);
    };
    const onSeeking = () => {
      showImmediatePair = true;
      hasPresentedFrame = false;
      lastPresentedAt = performance.now();
      cancelVideoFrameCallbacks();
      clearPending('base');
      clearPending('alpha');
      frameState.base.last = -1;
      frameState.alpha.last = -1;
      frameState.base.cycle = 0;
      frameState.alpha.cycle = 0;
      lastPresentedKey = -1;
    };
    const onSeeked = () => {
      frameState.base.last = -1;
      frameState.alpha.last = -1;
      if (!base.paused && !base.seeking && !alpha.seeking) {
        startBothVideoFrameCallbacks();
        safePlay(base);
        safePlay(alpha);
      }
    };

    base.addEventListener('play', startBothVideoFrameCallbacks);
    alpha.addEventListener('play', startBothVideoFrameCallbacks);
    base.addEventListener('seeking', onSeeking);
    alpha.addEventListener('seeking', onSeeking);
    base.addEventListener('seeked', onSeeked);
    alpha.addEventListener('seeked', onSeeked);
    base.addEventListener('waiting', onWaiting);
    alpha.addEventListener('waiting', onWaiting);
    base.addEventListener('stalled', onMediaError);
    alpha.addEventListener('stalled', onMediaError);
    base.addEventListener('error', onMediaError);
    alpha.addEventListener('error', onMediaError);

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(redrawVisiblePair);
      resizeObserver.observe(baseCanvas);
      resizeObserver.observe(alphaCanvas);
    } else {
      window.addEventListener('resize', redrawVisiblePair);
    }

    /* ── 出屏暂停链路诊断（默认完全空转，仅诊断探针置位 window.__heroMediaDebug）──
       背景：翻到尾屏后 hero 舞台已在视口上方 2700px、IO 也报了 hit:false，但两条轨
       仍 paused=false、currentTime 继续走，matte 合成循环还在烧 getError。
       这里按事件记账（含调用栈与元素身份），用来钉死「暂停之后是谁又把它播起来」，
       以及「是不是 React 重建了 <video>（新元素带 autoPlay，自己就播了）」。
       生产不收集：只有当 Page.addScriptToEvaluateOnNewDocument 事先置位才启用。 */
    const heroMediaLog = (typeof window !== 'undefined' && window.__heroMediaDebug)
      ? (window.__heroMediaLog = window.__heroMediaLog || [])
      : null;
    const mediaTag = (el) => {
      if (!el) return '-';
      if (!el.__mediaTag) el.__mediaTag = 'v' + (window.__heroMediaTagSeq = (window.__heroMediaTagSeq || 0) + 1);
      return el.__mediaTag;
    };
    const heroMediaSnapshot = (el) => (el ? {
      tag: mediaTag(el),
      paused: el.paused,
      ct: Number.isFinite(el.currentTime) ? +el.currentTime.toFixed(2) : null,
      conn: el.isConnected,
      rs: el.readyState
    } : null);
    const logHeroMedia = (kind, extra) => {
      if (!heroMediaLog) return;
      heroMediaLog.push(Object.assign({
        t: Math.round(performance.now()),
        kind,
        heroInView,
        active,
        base: heroMediaSnapshot(base),
        alpha: heroMediaSnapshot(alpha),
        stack: (new Error().stack || '').split('\n').slice(2, 6)
          .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 140))
      }, extra || {}));
      if (heroMediaLog.length > 200) heroMediaLog.shift();
    };
    if (heroMediaLog) {
      logHeroMedia('effect-run', { assetMode, isMobile, useWebglRenderer });
      const onMediaLog = (kind) => (event) => {
        const el = event.currentTarget;
        logHeroMedia(kind, { which: el === alpha ? 'alpha' : 'base', tag: mediaTag(el) });
      };
      base.addEventListener('play', onMediaLog('media-play'));
      base.addEventListener('pause', onMediaLog('media-pause'));
      alpha.addEventListener('play', onMediaLog('media-play'));
      alpha.addEventListener('pause', onMediaLog('media-pause'));
    }

    // 暂停：停时钟 + 丢帧配对 + 取消 rVFC 合成循环（同时停掉兜底 rAF）。
    const pauseHidden = () => {
      logHeroMedia('pauseHidden');
      try { base.pause(); } catch {}
      try { alpha.pause(); } catch {}
      cancelVideoFrameCallbacks();
      if (fallbackRaf) { window.cancelAnimationFrame(fallbackRaf); fallbackRaf = 0; }
    };
    // 恢复：回屏前先把两条轨重新对齐，再起播并重启合成循环。滚动出屏期间我们暂停了
    // 两个时钟，但暂停前若已因解码快慢错开，回到屏幕就必须先对齐 —— 否则用户看到的
    // 前景（alpha 猫）与背景（base 天空）不是同一帧。
    const resumeVisible = () => {
      if (!active) { logHeroMedia('resumeVisible-skip'); return; }
      logHeroMedia('resumeVisible');
      if (Number.isFinite(base.currentTime) && Number.isFinite(alpha.currentTime)
        && !base.seeking && !alpha.seeking
        && Math.abs(base.currentTime - alpha.currentTime) > HERO_SYNC_TOLERANCE) {
        showImmediatePair = true;
        try { alpha.currentTime = Math.max(0, Math.min(alpha.duration || Number.POSITIVE_INFINITY, base.currentTime)); } catch {}
      }
      if (base.paused || alpha.paused) {
        safePlay(base);
        safePlay(alpha);
      }
      if (typeof base.requestVideoFrameCallback === 'function' && typeof alpha.requestVideoFrameCallback === 'function') {
        if (!callbackIds.base && !callbackIds.alpha) startBothVideoFrameCallbacks();
      } else if (!fallbackRaf) {
        fallbackRaf = window.requestAnimationFrame(fallbackTick);
      }
    };

    if (!active) {
      // The home layer is kept mounted but hidden while another page is open.
      // Pause the clocks and drop the frame pairing so the decoder and the
      // stall watchdog stop; the watchdog would otherwise read the pause as a
      // stall and restart playback nobody can see.
      logHeroMedia('init-inactive');
      pauseHidden();
    } else {
      logHeroMedia('init-active');
      resumeVisible();
      stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS);
    }

    // 滚动出屏即暂停首屏视频：hero 是首页第一屏内容，翻到尾屏 / 滑离视口后继续
    // 解码并逐帧合成画面纯属浪费（主线程 + GPU 同时被吃）。用交叉观察器监听 hero
    // 是否真在视口内，离开即 pause 视频并停掉 rVFC 合成循环，回屏再恢复。
    const heroSection = base.closest('.hero-video-stage');
    visibilityObserver = new IntersectionObserver((entries) => {
      const inView = entries[0] ? entries[0].isIntersecting : true;
      heroInView = inView;
      logHeroMedia('io', { inView });
      if (!inView) pauseHidden();
      else resumeVisible();
    }, { threshold: 0 });
    if (heroSection) visibilityObserver.observe(heroSection);
    else logHeroMedia('io-no-section');

    return () => {
      disposed = true;
      if (visibilityObserver) visibilityObserver.disconnect();
      window.removeEventListener('scroll', noteScroll);
      if (stallTimer) window.clearTimeout(stallTimer);
      base.removeEventListener('play', startBothVideoFrameCallbacks);
      alpha.removeEventListener('play', startBothVideoFrameCallbacks);
      base.removeEventListener('seeking', onSeeking);
      alpha.removeEventListener('seeking', onSeeking);
      base.removeEventListener('seeked', onSeeked);
      alpha.removeEventListener('seeked', onSeeked);
      base.removeEventListener('waiting', onWaiting);
      alpha.removeEventListener('waiting', onWaiting);
      base.removeEventListener('stalled', onMediaError);
      alpha.removeEventListener('stalled', onMediaError);
      base.removeEventListener('error', onMediaError);
      alpha.removeEventListener('error', onMediaError);
      if (callbackIds.base && typeof base.cancelVideoFrameCallback === 'function') base.cancelVideoFrameCallback(callbackIds.base);
      if (callbackIds.alpha && typeof alpha.cancelVideoFrameCallback === 'function') alpha.cancelVideoFrameCallback(callbackIds.alpha);
      if (fallbackRaf) window.cancelAnimationFrame(fallbackRaf);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', redrawVisiblePair);
      try { base.pause(); } catch {}
      try { alpha.pause(); } catch {}
      clearPending('base');
      clearPending('alpha');
      if (visiblePair) {
        releaseSnapshot(visiblePair.base);
        releaseSnapshot(visiblePair.alpha);
        visiblePair = null;
      }
      clearSnapshotSpare();
    };
  }, [assetMode, isMobile, useWebglRenderer, active]);

  /* 移动端 hero 的出屏暂停（2026-10-10 补）。
     PC 那条「出屏即暂停」装在上面 WebGL matte 的 effect 里，而它的入口要求
     base + alpha 两个 <video> 同时存在 —— 移动端两者都没有（走 hero-mobile-video
     或 WebCodecs/jsmpeg 画布），于是**移动端 hero 从不暂停**：实测翻到尾屏后
     hero-mobile-video 仍 paused=false、currentTime 持续走（解码与浏览器合成一直
     在跑，与尾屏 WebGL 争 GPU），用户翻回首页时视频其实已经空跑了好几秒。
     这里补一条独立、轻量的同款：只观察 hero 舞台在不在视口，离开即暂停、回来再播。
     ⚠ 只作用于原生 <video>（非微信）。微信的 WebCodecs / jsmpeg 画布路径没有
       可暂停的媒体元素，其解码由各自的 effect 负责，不在本次范围内。 */
  useEffect(() => {
    if (!isMobile) return undefined;
    const stage = document.querySelector('.hero-video-stage');
    if (!stage) return undefined;
    const apply = (inView) => {
      document.querySelectorAll('video.hero-mobile-video').forEach((video) => {
        try {
          if (inView) {
            // 回屏：暂停过的元素要显式起播（autoplay 只管首次加载）。
            if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
          } else if (!video.paused) {
            video.pause();
          }
        } catch (_) { /* noop */ }
      });
    };
    // 打开二级/三级页时 home 层只是被隐藏；这条路径不经过观察器（舞台可能仍与
    // 视口相交），所以直接用 active 判定，与 PC 侧同义。
    if (!active) { apply(false); return undefined; }
    // 挂载/切换 assetMode 会重建 <video>（自带 autoPlay），此时先按当前几何定一次，
    // 否则元素会在视口外自己播起来而观察器不会再报边界事件。
    const rect = stage.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    apply((rect.width || rect.height) ? (rect.bottom > 0 && rect.top < vh) : true);
    const io = new IntersectionObserver((entries) => {
      apply(entries[0] ? entries[0].isIntersecting : true);
    }, { threshold: 0 });
    io.observe(stage);
    return () => io.disconnect();
  }, [isMobile, assetMode, active]);

  const updatePointerFromEvent = (event) => {
    const svg = wrapRef.current?.querySelector('svg');
    const rect = svg?.getBoundingClientRect() || wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return false;
    const clamp = (value) => Math.min(Math.max(value, 0), 1);
    pointerRef.current = {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height)
    };
    return true;
  };

  const handlePointerMove = (event) => {
    hoverTargetRef.current = 1;
    updatePointerFromEvent(event);
  };

  const handlePointerLeave = () => {
    hoverTargetRef.current = 0;
    pointerRef.current = { x: 0.5, y: 0.5 };
  };

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      const svg = wrapRef.current?.querySelector('svg');
      const rect = svg?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      const isInside = event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (isInside) {
        hoverTargetRef.current = 1;
        updatePointerFromEvent(event);
      } else {
        hoverTargetRef.current = 0;
        pointerRef.current = { x: 0.5, y: 0.5 };
      }
    };
    const handleWindowPointerLeave = () => {
      hoverTargetRef.current = 0;
      pointerRef.current = { x: 0.5, y: 0.5 };
    };
    window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
    window.addEventListener('pointerleave', handleWindowPointerLeave);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerleave', handleWindowPointerLeave);
    };
  }, []);

  useLayoutEffect(() => {
    let frame = 0;
    let svgNode = null;
    let paths = [];
    let centers = [];
    let hoverMix = 0;
    let lastTime = performance.now();
    // 入场动画只在 loading 加载完毕(app:ready)之后才开始，PC/移动同一套逻辑。
    // 挂载时若已在揭幕后才挂（极端时序）则立即开始，否则等 app:ready 再计时。
    let start = window.__appRevealed ? performance.now() : null;
    const onReveal = () => { if (start === null) start = performance.now(); };
    window.addEventListener('app:ready', onReveal);
    // welcome 字母的入场次序按 bbox 的 x 从左到右动态计算(不依赖 data-welcome-part 的值)，
    // 保证无论标记顺序如何，都始终「最左先入场」。refreshPaths 每次算出并缓存。
    let welcomeOrder = [];
    // 入场最后一个节点的收尾时刻(相对 start 的毫秒数)，在 refreshPaths 里一并算好。
    let introEndsAt = 1800;
    const smooth = (value) => {
      const t = Math.min(Math.max(value, 0), 1);
      return t * t * t * (t * (t * 6 - 15) + 10);
    };
    const refreshPaths = () => {
      const svg = wrapRef.current?.querySelector('svg');
      const nextPaths = svg
        ? [...svg.children].filter((node) => node.tagName?.toLowerCase() === 'path')
        : [];
      if (svg === svgNode && nextPaths.length === paths.length && nextPaths[0] === paths[0]) return;
      svgNode = svg;
      paths = nextPaths;
      const viewBox = svg?.viewBox?.baseVal;
      const viewWidth = viewBox?.width || 1640;
      const viewHeight = viewBox?.height || 241;
      centers = paths.map((node, index) => {
        try {
          const box = node.getBBox();
          return {
            x: (box.x + box.width / 2) / viewWidth,
            y: (box.y + box.height / 2) / viewHeight
          };
        } catch {
          return GROUP10_PATH_CENTERS[index] || GROUP10_WELCOME_SUBPATH_CENTERS[index - GROUP10_PATH_CENTERS.length] || { x: 0.5, y: 0.5 };
        }
      });
      // 按 bbox.x 从左到右排序 welcome 节点，作为其入场次序(最左最先)。
      welcomeOrder = paths
        .filter((node) => node.dataset.welcomePart !== undefined)
        .map((node) => {
          try { return { node, x: node.getBBox().x }; } catch { return { node, x: 0 }; }
        })
        .sort((a, b) => a.x - b.x)
        .map((entry) => entry.node);
      // 收尾时刻：所有 path 里最晚的 (delay + 1800)，与副标那条取较大值。
      // 跑完这一刻之后 opacity/filter 就是常量，再每帧重写毫无意义。
      let endsAt = BYLINE_INTRO_START_MS + BYLINE_CHAR_DURATION_MS;
      paths.forEach((node, index) => {
        const isWelcome = node.dataset.welcomePart !== undefined;
        const delay = isWelcome ? 1080 + Math.max(0, welcomeOrder.indexOf(node)) * 55 : index * 120;
        if (delay + 1800 > endsAt) endsAt = delay + 1800;
      });
      introEndsAt = endsAt;
    };
    // 入场起始态/终态各只写一次；跑完之后 opacity/filter 就是常量。
    let introStartDone = false;
    let introFinalDone = false;
    let offscreenTick = 0;
    const render = (now) => {
      // 指针一移出标题层就会被置 0；但翻页只靠滚轮、不触发 pointermove —— 若用户是
      // "鼠标停在标题上再滚去别的屏"，hoverTarget 会永远停在 1 让循环一直空转。
      // 这里每 ~20 帧用一次布局真值兜底纠正（只在 target=1 时才做，开销可忽略）。
      if (hoverTargetRef.current === 1 && (offscreenTick++ % 20) === 0) {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0) || rect.bottom < 0 || rect.top > window.innerHeight) {
          hoverTargetRef.current = 0;
          pointerRef.current = { x: 0.5, y: 0.5 };
        }
      }
      const target = hoverTargetRef.current;
      const mixSettled = Math.abs(target - hoverMix) < 0.0008;
      // 收敛后直接吸附：省掉永远追不上的尾数，也让下面的"静息"判定能真正成立。
      if (mixSettled) hoverMix = target;
      else {
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        hoverMix += (target - hoverMix) * (1 - Math.exp(-dt * 12));
      }
      lastTime = now;
      const running = start !== null && now < start + introEndsAt;
      const needIntro = running || (start === null ? !introStartDone : !introFinalDone);
      // 静息：入场已落定 + 指针没靠近 + hoverMix 已归零 → 本帧不可能有任何视觉变化。
      // 悬停特效与入场共用同一批 style 写入，所以 rAF 循环必须留着（指针随时可能回来），
      // 但可以把「每帧写 ~81 个 style 属性 + 同量级字符串分配」降到「读两个 ref + 一次比较」。
      // 实测这正是揭幕后稳态里那 ~6.7% 主线程占用的来源，而且会随停留时间一直烧下去。
      if (!needIntro && hoverMix === 0 && (bylineAlignRef.current || !bylineRef.current || start === null)) {
        frame = window.requestAnimationFrame(render);
        return;
      }
      refreshPaths();
      // 收尾那一帧直接写终值，不留"差一点点"的尾数（blur 0.0016px / opacity 0.99998）。
      const forceFinal = start !== null && !running;
      const p = pointerRef.current;
      paths.forEach((node, index) => {
        const center = centers[index] || { x: 0.5, y: 0.5 };
        const isWelcome = node.dataset.welcomePart !== undefined;
        // 从左到右的序号(0 = 最左)，替代原来按源 SVG 逆序的 data-welcome-part。
        const wIdx = isWelcome ? Math.max(0, welcomeOrder.indexOf(node)) : 0;
        const introDelay = isWelcome ? 1080 + wIdx * 55 : index * 120;
        if (needIntro) {
          const intro = forceFinal ? 1 : (start === null ? 0 : smooth((now - start - introDelay) / 1800));
          node.style.opacity = String(intro);
          node.style.filter = `blur(${((1 - intro) * HERO_INTRO_BLUR_PX).toFixed(3)}px)`;
        }
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const proximity = Math.max(0, 1 - Math.sqrt(dx * dx * 1.15 + dy * dy * 1.3) / (isWelcome ? 0.48 : 0.46));
        const pull = Math.pow(proximity, 1.15) * hoverMix;
        const wave = Math.sin(now * 0.0032 + index * 0.72) * pull;
        const x = dx * (isWelcome ? 112 : 104) * pull + wave * 5;
        const y = dy * (isWelcome ? 68 : 58) * pull + wave * 4;
        const scaleX = 1 + pull * (isWelcome ? 0.16 : 0.13);
        const scaleY = 1 + pull * (isWelcome ? 0.3 : 0.24);
        const rotate = dx * 12 * pull + wave * 2.2;
        const skew = dy * 9 * pull;
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rotate.toFixed(2)}deg) skewX(${skew.toFixed(2)}deg) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
      });
      // 移动端副标 "Four Design"：**整行一起入场**(业主明确要求，不要逐字分开)。
      // 动效本体与上面 SVG 同源 —— 同一个 smooth() easing / 1800ms / blur(52px→0) / 无位移；
      // 11 个字符共用同一个 delay，所以是同一时刻开始、同一时刻结束的"整体浮现"。
      // 起手点见 BYLINE_INTRO_START_MS 注释：与 welcome 首批同刻，上面还在入场时整行就跟着入场。
      // 位置：把左缘对齐到 R 的右缘，使首字母 F 正好接在 R 的位置上，上下读作同一处。
      const byline = bylineRef.current;
      if (byline) {
        if (!bylineAlignRef.current && start !== null) {
          const layer = wrapRef.current;
          // R = PORTFOLIO 第 3 个字母(paths[2])。直接量它的右缘，而不是硬编码 viewBox 占比，
          // 这样字形/字距变化也对得上，F 永远紧接 R 结束处。
          const rNode = paths[2];
          if (layer && rNode) {
            try {
              const lr = layer.getBoundingClientRect();
              const rr = rNode.getBoundingClientRect();
              if (lr.width > 0 && rr.width > 0) {
                byline.style.left = `${(rr.right - lr.left).toFixed(2)}px`;
                bylineAlignRef.current = true;
              }
            } catch (_) { /* 布局还没就绪，下一帧再试 */ }
          }
        }
        // 整行容器只负责定位/对齐，本身不参与淡入(避免与字符层叠加)。
        if (needIntro) {
          byline.style.opacity = '1';
          byline.style.filter = 'none';
          // 与上面 path 同一套曲线(easing/时长/解模糊)，只是副标**整行**共用一个 delay，
          // 所以是整体一起浮现，而不是从左到右依次出现。
          // 整行一起浮现：所有字符共用同一个 delay(无 i*stagger)，同一条 smootherstep 曲线，
          // 同时开始 / 同时结束。不再有独立的位移/幂次解模糊 —— 那些"自创参数"正是业主说的"跟上面SVG不一样"。
          const chars = bylineCharRefs.current;
          for (let i = 0; i < chars.length; i++) {
            const node = chars[i];
            if (!node) continue;
            const charIntro = forceFinal ? 1 : (start === null ? 0 : smooth((now - start - BYLINE_INTRO_START_MS) / BYLINE_CHAR_DURATION_MS));
            node.style.opacity = String(charIntro);
            node.style.filter = `blur(${((1 - charIntro) * HERO_INTRO_BLUR_PX).toFixed(3)}px)`;
            node.style.transform = 'none';
          }
        }
      }
      if (needIntro) {
        if (start === null) introStartDone = true;
        else if (!running) introFinalDone = true;
      }
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return () => {
      window.removeEventListener('app:ready', onReveal);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="hero hero-video-stage" id="hero" aria-label="Hero video">
      <div className="hero-video-fixed">
        {isMobile ? (
          <>
            {useWebCodecs || useJsmpeg ? (
              <>
                <div
                  className="hero-mobile-jsmpeg-poster"
                  style={{ backgroundImage: `url(${HERO_MOBILE_POSTER_SRC})`, opacity: canvasPainted ? 0 : 1 }}
                  aria-hidden="true"
                />
                <canvas
                  ref={useWebCodecs ? wcCanvasRef : jsmpegCanvasRef}
                  className="hero-mobile-video hero-mobile-jsmpeg-canvas"
                  aria-hidden="true"
                />
              </>
            ) : (
            <video
              className="hero-mobile-video"
              src={assetMode === 'mobile' ? HERO_MOBILE_SRC : HERO_MOBILE_FALLBACK_SRC}
              poster={HERO_MOBILE_POSTER_SRC}
              onError={() => { setAssetMode((mode) => (mode === 'mobile' ? 'mobile-fallback' : mode)); }}
              ref={(el) => {
                // React sets `muted` as a DOM property only and never renders the
                // attribute (long-standing React gap). WeChat's XWeb autoplay
                // whitelist checks the *attribute*, so force-write it here.
                if (el && !el.hasAttribute('muted')) el.setAttribute('muted', '');
              }}
              autoPlay
              muted
              loop
              playsInline
              webkit-playsinline="true"
              x5-playsinline="true"
              x5-video-player-type="h5"
              preload="auto"
              fetchPriority="high"
              disablePictureInPicture
              aria-label="Mobile hero video"
            />
            )}
            <div className="hero-title-stack-mobile" aria-label="Group 10 portfolio mark">
              <div
                className="hero-title-layer"
                ref={wrapRef}
                dangerouslySetInnerHTML={{ __html: heroTitleMarkup }}
              />
              <span className="hero-title-byline" ref={bylineRef} aria-label={BYLINE_TEXT}>
                {BYLINE_TEXT.split('').map((ch, i) => (
                  <span
                    key={i}
                    ref={(el) => { bylineCharRefs.current[i] = el; }}
                    className="hero-title-byline-char"
                    aria-hidden="true"
                  >{ch === ' ' ? '\u00A0' : ch}</span>
                ))}
              </span>
            </div>
          </>
        ) : (
          <>
            <canvas ref={baseCanvasRef} className="hero-video-bg hero-video-base-canvas" aria-hidden="true" />
            <img
              className={`hero-pc-poster${pcPosterGone ? ' is-gone' : ''}`}
              src={HERO_PC_POSTER_SRC}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <div
              className="hero-title-layer"
              ref={wrapRef}
              aria-label="Group 10 portfolio mark"
              onPointerMove={handlePointerMove}
              onPointerEnter={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              dangerouslySetInnerHTML={{ __html: heroTitleMarkup }}
            />
            <canvas ref={alphaCanvasRef} className="hero-video-bg hero-video-alpha-canvas" style={{ display: useWebglRenderer ? 'block' : 'none' }} aria-hidden="true" />
            <canvas ref={fallbackAlphaCanvasRef} className="hero-video-bg hero-video-alpha-canvas hero-video-alpha-2d" style={{ display: !isMobile && !useWebglRenderer ? 'block' : 'none' }} aria-hidden="true" />
            <video key={`base-${assetMode}`} ref={(el) => { baseRef.current = el; if (el && !el.hasAttribute('muted')) el.setAttribute('muted', ''); }} className="hero-video-clock hero-video-base" src={assetMode === 'hevc' ? HERO_HEVC_BASE_SRC : HERO_FALLBACK_BASE_SRC} autoPlay muted loop playsInline preload="auto" fetchPriority="high" disablePictureInPicture />
            <video key={`alpha-${assetMode}`} ref={(el) => { alphaRef.current = el; if (el && !el.hasAttribute('muted')) el.setAttribute('muted', ''); }} className="hero-video-clock hero-video-alpha" src={assetMode === 'hevc' ? HERO_HEVC_MASK_SRC : assetMode === 'fallback' ? HERO_FALLBACK_MASK_SRC : HERO_FALLBACK_ALPHA_SRC} autoPlay muted loop playsInline preload="auto" fetchPriority="high" disablePictureInPicture />
          </>
        )}
        {isMobile ? (
          <div className="hero-scroll-hint-mobile" aria-hidden="true">
            <img
              className="hero-scroll-arrow"
              src="/media/hero-scroll-arrow-mobile.svg"
              alt=""
              width={22}
              height={22}
              draggable={false}
            />
          </div>
        ) : (
          <div className="hero-scroll-hint" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}
/* ---------------------------------------------------------------------------
   HOME PAGING

   The home page is four screens and the wheel moves between them one screen at
   a time: HERO → 个人信息 → 作品展示 → 联系合作. The HERO itself stays in
   place and loops continuously. A wheel notch from page 01 moves directly to
   page 02 with the regular page scroll; no cinematic playback, screen map,
   whiteout, or hand-off state is involved.
--------------------------------------------------------------------------- */
const HOME_PAGE_IDS = ['hero', 'profile', 'projects', 'contact'];
const HOME_PAGE_COUNT = HOME_PAGE_IDS.length;

// Long enough for a one-screen smooth scroll plus its settle, so a second
// notch arriving mid-animation is swallowed instead of stacking.
const HOME_STEP_LOCK_MS = 400;

// Wheel and touch gestures closer together than this belong to the same step.
// A swipe can emit several touchmove events, so only the first resolved one may
// advance the page until the gesture has fully settled.
const HOME_GESTURE_GAP_MS = 90;
const HOME_TOUCH_THRESHOLD = 34;
const HOME_TOUCH_END_DELAY_MS = 120;

/* 整屏翻页动画时长。原来是内核的 `scrollTo({behavior:'smooth'})`（≈700ms），
   现在自己画，用同一条曲线、同一个时长，观感不变（见 goToPage 的注释）。 */
const HOME_FLIP_MS = 700;

/* cubic-bezier(0.42, 0, 0.58, 1) —— 与 CSS 的 ease-in-out 同值，也是内核原生
   平滑滚动用的那条曲线；换掉原生实现后「翻页的手感」必须一模一样。
   标准 Newton 求 t(x) 再取 y，6 次迭代足够（误差 << 1px）。 */
function flipEase(p, x1 = 0.42, y1 = 0, x2 = 0.58, y2 = 1) {
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const at = (t) => ((ax * t + bx) * t + cx) * t;
  const bt = (t) => ((ay * t + by) * t + cy) * t;
  const slope = (t) => (3 * ax * t + 2 * bx) * t + cx;
  let t = p;
  for (let i = 0; i < 6; i += 1) {
    const dx = at(t) - p;
    if (Math.abs(dx) < 1e-4) break;
    const d = slope(t);
    if (Math.abs(d) < 1e-6) break;
    t -= dx / d;
  }
  return bt(Math.min(1, Math.max(0, t)));
}

const HOME_PAGING_QUERY = '(min-width: 1px)';

// The nav renders above the home page, so it cannot receive the pager as a
// prop without threading state through App. It reads this instead.
const homePagerRef = { current: null };

function usePagingEnabled(active = true) {
  const [enabled, setEnabled] = useState(() => (
    active && document.documentElement.getAttribute('data-paging') === 'on'
  ));

  useLayoutEffect(() => {
    const query = window.matchMedia(HOME_PAGING_QUERY);
    const apply = () => {
      const on = active && query.matches;
      document.documentElement.setAttribute('data-paging', on ? 'on' : 'off');
    // The browser's own scroll restore would land the visitor halfway down a
    // page it is not allowed to scroll freely. The paged home keeps its saved
    // screen index aligned with the browser position.
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = on ? 'manual' : 'auto';
      }
      setEnabled((current) => (current === on ? current : on));
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [active]);

  return enabled;
}
function HomePage({ openWorks, paging, active = true, deckFocusId = '', revealProjects = false, chromeHidden = false, chromeIn = false, deckVeiled = false }) {
  const [profileRef, profileSeen] = useRevealOnView();
  // 首屏视频是否已真正开始播放。尾屏预挂载必须等这个信号 —— 首屏视频优先级
  // 绝对最高，WebGL 编译绝不能抢在它前面（抢了会拖慢视频首帧）。
  const [heroVideoReady, setHeroVideoReady] = useState(false);
  const markHeroVideoReady = useCallback(() => setHeroVideoReady(true), []);
  const [coversPreloaded, setCoversPreloaded] = useState(false);
  const [tailReady, setTailReady] = useState(false);
  const [tailBurned, setTailBurned] = useState(false);
  // 首屏 Loading 遮罩只在首页出现（index.html 按 hash 判定），揭幕信号也只由
  // 首页给出：hero 真正播起来 = 首屏内容加载完毕。遮罩里的进度条另有真实来源
  // （preload 资源条目 + <video> buffered），这个事件只是"可以揭幕了"的终判。
  //
  // 揭幕闸门：首屏可播 + 封面预载完 + 尾屏编译完 + 尾屏灯光烧完。
  // 尾屏 WebGL 既然在 loading 期就预载/编译，就应该**连它的 2.7s 灯光渐入一起
  // 在遮罩里做完**：实测（outputs/perf-reveal）它满帧烧录时在揭幕后 3.2s 窗口里
  // 吃掉主线程 2095ms（65%），正好压住首屏入场动画 —— 这就是"loading 结束后 hero
  // 依旧长时间卡顿"的根因。现在烧录改在遮罩期以 20fps 受控帧率跑完（见
  // Street.jsx 的 BURN_FRAME_MS），揭幕时尾屏已经"熟"了，且它在此之前绝不跑满帧。
  //
  // 兜底 6s：低端 GPU 上着色器编译 + 灯光烧录可能偏慢，但**绝不能让某一闸门异常时
  // 把 loading 永久卡住**。正常路径（heroVideoReady ≈2.9s、烧录在编译后 +3.4s）落在
  // 5s 出头，所以这道兜底只在异常时生效；它一旦触发也只是"提前揭幕"，烧录会被
  // 降级到 20fps 继续在后台跑完，绝不会满帧漏进首屏。
  const markTailBurned = useCallback(() => setTailBurned(true), []);
  const revealedRef = useRef(false);
  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    window.requestAnimationFrame(() => window.dispatchEvent(new Event('app:ready')));
  }, []);
  /* 「进度条上所有登记过的加载任务都完成了吗」—— 直接问 index.html 的注册表
     （__bootTasks().pending），而不是在本文件里维护一份清单。
     ★ 业主 2026-10-13 的核心要求就落在这里：**以后任何新加的加载内容**只要按约定
       派发 loading:progress，就自动出现在进度条上、也自动成为揭幕条件 ——
       进度和加载时间都跟着内容走，不需要回来改这段闸门代码。
     注册表不存在（老 HTML / 缓存）时返回 true，退回原来的四道闸门。 */
  const bootTasksIdle = useCallback((exceptId = null) => {
    const snapshot = typeof window.__bootTasks === 'function' ? window.__bootTasks() : null;
    if (!snapshot) return true;
    const pending = snapshot.pending;
    return exceptId ? pending.every((id) => id === exceptId) : pending.length === 0;
  }, []);
  useEffect(() => {
    if (heroVideoReady && coversPreloaded && tailReady && tailBurned && bootTasksIdle()) reveal();
  }, [heroVideoReady, coversPreloaded, tailReady, tailBurned, bootTasksIdle, reveal]);
  /* 6s 兜底：只放行「尾屏烧录」这一件事（低端 GPU 上着色器编译 + 烧录可能很慢，
     但绝不能让首屏永久扣在遮罩后面；烧录会在后台继续跑完）。
     ⚠ 2026-10-13 收紧授权范围 —— 原来这里是 `setTimeout(reveal, 6000)`，只看
       heroVideoReady && coversPreloaded，于是**任何新登记的加载任务都被它绕过**：
       合成一个"7s 才完成"的新任务实测，遮罩照样在 6.8s 收掉、新任务被无视，
       正是业主说的"加了新任务、进度还按旧任务量算"。
       现在它必须等注册表里**除尾屏之外**的任务全部完成（bootTasksIdle(TAIL_TASK_ID)），
       新任务想被漏算也漏不掉。 */
  useEffect(() => {
    if (!heroVideoReady || !coversPreloaded) return undefined;
    let id = 0;
    const start = window.setTimeout(() => {
      // 之后每 500ms 复核一次：尾屏之外的任务一完成就放行（尾屏本身不再等）。
      const check = () => {
        if (revealedRef.current) { window.clearInterval(id); return; }
        if (bootTasksIdle(TAIL_TASK_ID)) { reveal(); window.clearInterval(id); }
      };
      check();
      id = window.setInterval(check, 500);
    }, 6000);
    return () => { window.clearTimeout(start); window.clearInterval(id); };
  }, [heroVideoReady, coversPreloaded, bootTasksIdle, reveal]);
  /* 这里原本还有一道「15s 无条件揭幕」的 React 侧终极兜底，2026-10-13 **删掉了**：
     业主口径是「加载时间必须实时跟加载内容挂钩」，而固定 15s 会在图片/长图变多时
     抢在任务完成之前揭幕（"新任务没算进去"就是这么暴露的）。
     现在"什么时候认输"只有一个地方说了算 —— index.html 的**看门狗**：
     跑满 15s 且**连续 5s 一点进度都没涨**才放行（真卡住才走，与内容多少无关），
     它自己会派发 app:ready 并从内部把遮罩收掉，所以首屏标题不会停在 opacity:0。 */
  /* 揭幕闸门「为什么还没放行」的现场快照（2026-10-13，业主自查用）：
     在控制台敲 `window.__revealGate` 即可看到四道闸门 + 进度条上还差哪些任务
     （bootPending）、首屏视频的真实缓冲余量与揭幕时刻；揭幕后保留**揭幕那一刻**的快照。
     250ms 采样、不写任何 DOM、揭幕即停，无可感知开销。
     顺带承担一件事：**每次采样都完整复核一遍闸门**（含 bootTasksIdle），满足即揭幕 ——
     这样即使某个任务是在四道 state 闸门都已为真之后才登记的，也照样会被等到。 */
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const v = document.querySelector('video.hero-mobile-video, video.hero-video-base');
      let ahead = 0;
      if (v) {
        try {
          const at = v.currentTime || 0;
          for (let i = 0; i < v.buffered.length; i += 1) {
            if (at + 0.05 >= v.buffered.start(i) && at <= v.buffered.end(i)) {
              ahead = Math.max(ahead, v.buffered.end(i) - at);
            }
          }
        } catch (_) { /* noop */ }
      }
      const snapshot = typeof window.__bootTasks === 'function' ? window.__bootTasks() : null;
      window.__revealGate = {
        gates: { heroVideoReady, coversPreloaded, tailReady, tailBurned },
        bootPending: snapshot ? snapshot.pending : null,
        bootCount: snapshot ? snapshot.count : null,
        bootRatio: snapshot ? Math.round(snapshot.ratio * 1000) / 1000 : null,
        video: v ? {
          readyState: v.readyState,
          paused: v.paused,
          currentTime: Number((v.currentTime || 0).toFixed(2)),
          duration: isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null,
          aheadSec: Number(ahead.toFixed(2)),
        } : null,
        revealed: revealedRef.current,
        heroReadyReason: typeof window !== 'undefined' ? window.__heroReadyReason : undefined,
        atMs: Math.round(performance.now()),
      };
      if (!revealedRef.current
        && heroVideoReady && coversPreloaded && tailReady && tailBurned && bootTasksIdle()) {
        reveal();
      }
      if (!revealedRef.current) timer = window.setTimeout(tick, 250);
    };
    timer = window.setTimeout(tick, 250);
    return () => window.clearTimeout(timer);
  }, [heroVideoReady, coversPreloaded, tailReady, tailBurned, bootTasksIdle, reveal]);
  const [projectsRef, projectsSeen, projectsResync] = useRevealOnView();
  const [contactRef, contactSeen] = useRevealOnView({ threshold: 0.16 });
  const [contactPreload, setContactPreload] = useState(false);
  useEffect(() => {
    const el = contactRef.current;
    if (!el) return undefined;
    // 尾屏在 loading 阶段就已通过 setContactPreload(true) 挂载（见下方预载 effect），
    // 这里只负责「临近时确保挂载」，绝不把它设回 false —— 否则会卸载已预热的 WebGL。
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setContactPreload(true); },
      { root: null, rootMargin: '150% 0px 150% 0px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Mobile shows the three-card poker stack; desktop keeps the hover-fan deck.
  const isMobile = document.documentElement.getAttribute('data-device') === 'mobile';

  // PC 首页卡组是 4:3(.showcase-deck-card aspect-ratio: 4/3),用 cover43。
  // ⚠ 不要再回落 detailHero(16:9):比例不符 → object-fit:cover 每侧裁 12.5%,
  //   构图(标题字位)被浏览器二次裁掉,不是设计稿的样子。
  const worksItems = projectShowcases.map((project) => {
    const work = worksByCategory[project.category]?.[project.work];
    return { project, cover: work?.cover43 ?? work?.detailHero };
  });

  // Mobile shows every real work (the placeholder Motion Space is excluded), so
  // the stack grows with the portfolio. Desktop keeps the curated 7-card set.
  // ⚠ 2026-10-07:一级卡组与二级轨道必须是**同一批卡、同一个顺序**(跨级转场是
  //   同一张卡在动),所以这里直接复用 WORKS_RAIL,不再各写一份 flatMap ——
  //   两份数据一旦顺序错开,放大/收回的落点就会落到另一张卡上。
  // 一级卡组主卡/副卡 = 3:5(.mob-card),底部队列是 .mw-card(同样 3:5,
  // 跨级要求同一张卡面) → 两者都取 image(cover-portrait)。
  const mobileWorksItems = WORKS_RAIL.map((work) => ({
    project: { id: work.id, category: work.category, title: work.title, meta: work.subtitle },
    cover: work.image ?? work.detailHero,
    cover43: work.cover43 ?? work.detailHero
  }));

  // 预载全部挪到 loading 阶段：封面 + 尾屏 WebGL 都在首页可见前就绪，
  // 揭幕进入 hero 后不再有任何网络/编译负载 → 零卡顿（PC 与移动端一致）。
  //
  // ⚠ 2026-10-13 曾串行化（视频 > 封面 > 尾屏），起因是三批 t=0 同时起跑时
  //   33 个并发请求把连接池占满，视频的 range 请求被排到队尾 → 首帧被拖慢，
  //   揭幕瞬间尾屏又抢主线程编译 → 视频卡在开场那几秒。
  // ★ 2026-10-11 改为 **P2 全并行 + 限并发 6 路**：
  //   · 封面：并发窗口 6（见 runPool），带宽照样吃满但给视频 range 留位置；
  //   · 尾屏冷启动/编译/烧录：挂载即起跑，与视频缓冲同时进行；
  //   · 揭幕条件**完全不变**：视频不满足"能连续播"就不揭幕（见下面的 reveal）。
  //   风险（业主已知，效果不好就退回 P1）：尾屏 WebGL 编译是整条链上最重的
  //   主线程负载，与视频首帧解码重叠会把首帧推晚 —— 存在"抢了自己要等的那道
  //   闸门"的反馈环，需实测确认净收益。
  // 进度条权重**先登记**（2026-10-13）：这些任务排在视频之后才启动，若等它们
  // 真开始才上报，条子会在视频下完后先冲到很高、等新任务进来再"停住"。
  // 这里在挂载当帧就把权重报一次 0 —— index.html 的任务表按 id 锁权重、
  // progress 取 max（单调），重复上报无副作用，条子从第一帧起就按真实总量爬。
  // ⚠ 作品封面**不在**这里整组登记了（2026-10-13 改）：它们改成**一张图一个任务**
  //   （id = img:<路径>），见下面 warmStage 的预载 effect —— 业主口径是"进度要实时
  //   跟加载内容挂钩"，一张一份权重，加图/换图自动生效，也不会漏算。
  useEffect(() => {
    const announce = (id, weight) => {
      try {
        window.dispatchEvent(new CustomEvent('loading:progress', { detail: { id, weight, progress: 0 } }));
      } catch (_) { /* noop */ }
    };
    /* ★ 2026-10-11：尾屏在进度条里的权重由 2 提到 TAIL_PROGRESS_WEIGHT(8)。
       ⚠ 这个数**只影响读数，不影响揭幕**：揭幕问的是 __bootTasks().pending
       （该项的值到没到 1），权重大小不进那条判据，所以调大不会推迟也不会提前揭幕。
       为什么调大：尾屏烧录是首屏 loading 末段**唯一还在动**的任务，原先只占 2 权重 →
       烧录那 0.5 权重只值总分的 0.9%，2 秒里读数几乎不动，观感就是"卡在 98%"。
       提到 8 之后烧录段值约 3.1%，条子在这 2 秒里一路在爬。 */
    announce(TAIL_EVENT_ID, TAIL_PROGRESS_WEIGHT);
  }, []);

  /* hero 视频"够播"了就播报一声（2026-10-13）：App 拿它当"最危险的那段下载已经过去"的
     信号，在遮罩还在时预热环境光的 WebGL 上下文与 shader 编译。只做一次跨组件通知，
     不进 state、不触发任何重渲染。 */
  useEffect(() => {
    if (!heroVideoReady) return;
    window.__heroReady = true;
    try { window.dispatchEvent(new Event('hero:ready')); } catch (_) { /* noop */ }
  }, [heroVideoReady]);

  const [warmStage, setWarmStage] = useState(0);
  /* ★ 2026-10-11 P2：挂载即起跑，不再等视频的任何信号（含 2.5s 兜底一并取消）。
     ⚠⚠ 这里改的**只是"什么时候开始干"**，不是"什么时候揭幕" ——
        下面 reveal 的四道闸门（heroVideoReady && coversPreloaded && tailReady
        && tailBurned && bootTasksIdle）**一个字都没动**：视频没满足"能连续播"
        （缓冲余量 / 追到片尾 / 填充速率）就绝不揭幕。
        业主口径：所有内容都加载完、且视频能流畅播放，才结束 loading 让用户进 hero。
     P2 与 P1 的区别：P1 把起跑门槛降到"首帧已上屏"，P2 直接挂载即起跑，
     只靠**限并发 6 路**（见 runPool）给视频的 range 请求留带宽位置。 */
  useEffect(() => { setWarmStage(1); }, []);

  const warmStartedRef = useRef(false);
  // 此 effect 在 HomePage 挂载时（即 loading 遮罩仍可见时）立即执行，
  // warmStage 在挂载当帧即为 1（P2），所以封面与尾屏从第一帧起就与视频并行。
  useEffect(() => {
    if (!warmStage || warmStartedRef.current) return undefined;
    warmStartedRef.current = true;
    let cancelled = false;
    /* 作品图片总清单（一级封面 + 二级/详情封面）。分两拨：
       · critical = 本机马上要显示的封面 + 详情页首屏那块长图 → **每张一个 loading 任务**，
         参与计分也参与揭幕；
       · cross    = 另一套比例（换设备/跨断点才用到）→ **不进 loading**，揭幕后静默预热。 */
    const inventory = worksImageInventory(isMobile);
    const all = [...inventory.covers, ...inventory.tiles];
    const total = all.length;
    let done = 0;
    /* 每张图 = **一个独立的 loading 任务**（id 带文件名），不再是"整组一个 covers"。
       为什么必须一张一个：
         ① 业主口径「进度和加载时间要实时跟加载内容挂钩」—— 一张图一份权重，
            加一张图总分就自动 +1、揭幕就自动推迟一点，不需要改任何计分代码；
         ② 整组一个 id 时，progress 只能报"完成比例"，看不出是哪张在拖，
            而且以后往组里加图容易忘了改总量。
       登记必须在**开跑之前**：index.html 的总分是现算的，晚登记会让条子先冲到高处
       再卡住（paint 只增不减），观感就是"假进度"。 */
    const announce = (id, progress) => {
      try {
        window.dispatchEvent(new CustomEvent('loading:progress', {
          detail: { id, weight: 1, progress }
        }));
      } catch (_) { /* noop */ }
    };
    all.forEach((src) => announce(`img:${src}`, 0));
    const finish = () => { if (!cancelled) setCoversPreloaded(true); };
    /* 一张封面 = 下载 + **显式解码**。
       ⚠ onload 只代表"字节到齐"，解码还排在主线程队列里。33 张 WebP 的解码
       如果留到揭幕后（首次显示某张卡才做）就会砸在首屏视频与入场动画上 ——
       这正是"进入后卡一会"的另一半成因。这里在遮罩下解掉，decode() 完成才算数。
       decode() 失败/不支持一律当完成，绝不让它把闸门吊死。 */
    const IMG_TIMEOUT_MS = 12000;
    /* ★ 2026-10-13（微信移动端业主反馈"滑到作品页 3:5 封面还是空的"）：
       过去这里只有游离的 `new Image()`。游离图片在微信 X5 / WKWebView 里不保证被
       真正取回并留在图片缓存里（X5 的"智能图片加载"会把没进 DOM 的图当成不需要），
       于是 loading 期等于白下：卡片上屏那一刻又得重新走一趟网络，慢网下就是空卡。
       改法：把这些图**挂进一个隐藏容器**（位置挪出屏幕、1×1 裁切、opacity 极低但
       仍在渲染树里 —— 不是 display:none，避免被判定为"不可见就不解码"），
       让内核按"页面里的图"来取。全部落地后容器立刻移除，不长期占内存。
       配合同一提交里 `markImagePreloaded`：已经在 DOM 里的卡组/轨道卡会在预载
       完成的那一帧就挂上 src，解码也发生在遮罩下 —— 这正是"进入后不卡"的来源。 */
    const store = document.createElement('div');
    store.id = 'img-preload-store';
    store.setAttribute('aria-hidden', 'true');
    store.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;'
      + 'overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    if (document.body) document.body.appendChild(store);
    const preloadOne = (src) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.alt = '';
      let settled = false;
      const settle = (ok) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (ok) markImagePreloaded(src);
        resolve();
      };
      /* 单张的兜底（2026-10-13）：某张图 404 / 挂住时不能把整条 loading 吊死。
         到点算"有结论"，但**明确记一笔**，方便在控制台一眼看出是哪张图的问题 ——
         这不是"假装成功"，页面侧那张卡本来也就只能用占位图。 */
      const timer = window.setTimeout(() => {
        console.warn('[loading] 图片超时，按完成处理：', src);
        settle(false);
      }, IMG_TIMEOUT_MS);
      img.onload = () => {
        markImagePreloaded(src);
        let p = null;
        try { p = typeof img.decode === 'function' ? img.decode() : null; } catch (_) { p = null; }
        if (p && typeof p.then === 'function') p.then(() => settle(true), () => settle(true));
        else settle(true);
      };
      img.onerror = () => {
        console.warn('[loading] 图片加载失败：', src);
        settle(false);
      };
      img.src = src;
      try { store.appendChild(img); } catch (_) { /* noop */ }
    });
    /* ★ 2026-10-11 P2：并发跑，但**同时只有 6 张在飞**（每完成一张就补一张）。
       为什么不是 33 条一起上（2026-10-13 实测踩过）：33 个并发请求会把连接池占满，
       视频的 range 请求被排到队尾 → 视频首帧被自己人拖慢 → heroVideoReady 更晚 →
       抢的正是自己要等的那道闸门。6 路在 HTTP/1.1 下已接近浏览器每域名上限，
       带宽照样吃得满，同时给视频留出位置。
       **每完成一张就报一次**（进度条据此一张张爬）；单张失败/超时照样 resolve，
       所以收尾用"全部 settle"，不会被某一张打断。 */
    const PRELOAD_CONCURRENCY = 6;
    const run = async (list) => {
      let cursor = 0;
      const worker = async () => {
        while (cursor < list.length) {
          const src = list[cursor];
          cursor += 1;
          // eslint-disable-next-line no-await-in-loop
          await preloadOne(src);
          done += 1;
          announce(`img:${src}`, 1);
        }
      };
      const lanes = Math.max(1, Math.min(PRELOAD_CONCURRENCY, list.length));
      await Promise.all(Array.from({ length: lanes }, () => worker()));
    };
    /* 隐藏预载容器用完即撤：卡片们此时已经各自挂上 src（markImagePreloaded 的订阅
       在预载成功那一刻就把 src 派给了 DOM 里已存在的卡组/轨道），
       资源也已在内核缓存里，移除容器不再影响任何一张卡的显示，只把内存还回去。 */
    const dropStore = () => {
      /* 只撤容器，**不**清元素上的 src：清 src 等于告诉内核"这张图不要了"，
         在个别内核上会把已解码的位图一起丢掉，详情页的长图就要重下（实测过
         resource timing 里多出一条条件请求）。元素随容器一起被回收，
         缓存条目照旧留着，卡片各自身上的 src 也不受影响。 */
      try { store.remove(); } catch (_) { /* noop */ }
    };
    if (total === 0) {
      dropStore();
      finish();
    } else {
      run(all).then(() => {
        dropStore();
        finish();
      });
    }
    /* 跨比例那批（PC 的 3:5 / 手机的 16:9）不占启动带宽：等**揭幕之后**再悄悄下，
       纯粹暖 HTTP 缓存（换设备、跨 1100px 断点时才用得到）。 */
    if (inventory.cross.length) {
      const warmCross = () => {
        inventory.cross.forEach((src) => {
          const img = new Image();
          img.decoding = 'async';
          img.src = src;
        });
      };
      if (window.__appRevealed) warmCross();
      else window.addEventListener('app:ready', warmCross, { once: true });
    }
    // 尾屏 WebGL 在 loading 阶段就挂载（见 ContactStreet 的 onTailReady），
    // shader 编译 / 纹理加载在遮罩下进行，进入尾屏时场景已就绪。
    // ⚠ 2026-10-11 P2：它现在与视频缓冲**同时**发生（warmStage 挂载即为 1）。
    //   代价：WebGL 编译是整条链上最重的主线程负载，重叠会拖慢视频首帧。
    //   兜底仍在：heroVideoReady 不满足就不揭幕，最坏情况只是 loading 变长，
    //   不会让用户在视频卡顿的状态下进入 hero。
    setContactPreload(true);
    return () => { cancelled = true; };
  }, [warmStage]);
  /* ⚠ 依赖数组只有 warmStage：worksItems / mobileWorksItems 每次渲染都是新数组，
     放进依赖会让这个 effect 每渲染一次就 cleanup 一次（cancelled=true + 清掉兜底
     定时器），预载会被自己掐断、闸门永不打开。warmStartedRef 保证只跑一次。 */

  // Where the controller thinks it is. On a paged home the scroll position is
  // the only thing that can say: the browser may have restored one from an
  // earlier visit, and starting at 0 while the page sits on 3 would leave the
  // wheel and the view disagreeing for the rest of the session.
  const startIndexRef = useRef(null);
  if (startIndexRef.current === null) {
    /* 2026-10-08 PC 业主反馈「二级页刷新后返回一级,SELECTED WORK 标题消失」。
       成因:goWorks 离开一级时把入口屏号写进 sessionStorage(portfolioHomeEntryIndex),
       回程也靠 restoreScroll 滚回那一屏 —— 但**在二级页刷新**时,首页层是**新挂载**的,
       startIndex 恒取 0、hasEnteredPage 恒 false。于是回程把窗口滚回屏 2(作品屏),
       分屏控制器却以为自己停在屏 0:`projectsVisible = hasEnteredPage && index===2`
       永远不成立 → 整个 motion-reveal-section 不带 is-visible,
       .display-reveal-title 停在 opacity:0 / clip-path:inset(0 100% 0 0) —— 标题整块消失。
       (不刷新时首页层保持挂载、index 还是 2,所以复现不出来。)
       修法:落地时**不在一级**(hash 是 #/works 或 #/detail,就是刷新后的落点)才读回
       入口屏号。注意不能改成读 window.scrollY —— 首页层此刻是 .is-hidden,文档高度塌成 0,
       scrollY 会被浏览器钳回 0,那正是当初把它钉死为 0 的原因。 */
    const landedOffHome = parseRoute().page !== 'home';
    const saved = landedOffHome
      ? Number(window.sessionStorage.getItem('portfolioHomeEntryIndex') ?? 0)
      : 0;
    const safe = Number.isFinite(saved) ? saved : 0;
    startIndexRef.current = Math.max(0, Math.min(HOME_PAGE_COUNT - 1, Math.round(safe)));
  }

  const [index, setIndex] = useState(startIndexRef.current);

  // 环境光(SideRays)已提升为 **App 层单例**(见 App 的 app-rays-layer):
  // 一级首页与二级作品页现在共用同一个 WebGL 实例、同一套以一级为准的参数。
  // 首页不再自己挂载/调度光层,这里只负责把 projects/contact 的实测可见性
  // 通过 data-section 暴露给 App 的光驱动(见下方 reveal* 的写入处)。

  // The first screen is already visible on the first paint. Later screens
  // reveal when their one-screen gesture arrives.
  const [hasEnteredPage, setHasEnteredPage] = useState(() => startIndexRef.current > 0);

  /* 三屏的入场 / 离场由 CSS 的 [HOME MOTION] 块（styles.css）直接读 section 上的
     `is-visible` 驱动，这里不再需要任何一次性闩。
     （旧版的 `is-entered` 闩只增不减，做不出离场，已连同 CSS 一起移除。
       要恢复「每屏只播一次」需要重新引入闩并改回 CSS 驱动条件。） */
  const indexRef = useRef(index);
  const lockedUntilRef = useRef(0);
  const scrollingRef = useRef(false);
  const reducedRef = useRef(false);
  /* 自绘翻页动画的 rAF 句柄（0 = 没有飞行中的翻页）。见 goToPage 的注释。 */
  const flipRafRef = useRef(0);
  /* 尾屏 iframe 的「翻页飞行中」标记（2026-10-10，A1）。
     true ⇒ ContactStreet 把 iframe 压到 30fps（FLIP_FRAME_MS），落地立即回满帧。
     为什么需要：翻页动画由本页自绘（每帧 window.scrollTo），而尾屏是同源 iframe、
     与父页面共享主线程。翻页一开始 active 就翻真、尾屏当帧切满帧，两者逐帧抢主线程
     ⇒ 滑入尾屏那 700ms 的卡顿感。降帧只在这 700ms 内生效，且不改变场景时间推进
     （受控档恒报真实时钟，见 Street.jsx 的时间轴铁律），所以画面不会变慢或错位。
     ⚠ 三条出口都必须清：动画最后一帧、instant 直跳、卸载/paging 关闭。残留会让
     尾屏长期停在 30fps。 */
  const [tailFlipping, setTailFlipping] = useState(false);

  indexRef.current = index;

  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Align the controller index and scroll position before the first gesture.
  useLayoutEffect(() => {
    if (!paging) return;
    // Align to the screen the controller is actually on. This runs again when
    // the home layer comes back from another page (paging flips false -> true),
    // which lands the reader on the screen they left from, not screen 01.
    const aligned = indexRef.current * (window.innerHeight || 1);
    if (Math.abs(window.scrollY - aligned) > 1) window.scrollTo(0, aligned);
  }, [paging]);

  // A paged screen is exactly one viewport tall, so this is both the scroll
  // target for page `n` and the distance one notch travels.
  const pageHeight = () => window.innerHeight || document.documentElement.clientHeight || 1;

  // The screens are one --vh tall, and on a phone --vh changes as the address
  // bar slides in and out. When it does, the offset the controller is sitting
  // on no longer lands on a screen boundary, so the position is re-aligned to
  // the current page once the viewport has settled. The delay keeps the
  // realign out of the address-bar animation, where innerHeight reports a new
  // value on every frame and a scroll per frame would jitter.
  useEffect(() => {
    if (!paging) return undefined;
    let timer = 0;
    const realign = () => {
      timer = 0;
      // 翻页飞行中不校正：动画自己每帧把终点算成 index * 当前页高，
      // 中途地址栏变高/变矮也落在整屏边界上。这里再插一次 scrollTo 反而会把
      // 平滑滚动打断成一帧硬切（见 goToPage 注释）。
      if (flipRafRef.current) return;
      const aligned = indexRef.current * pageHeight();
      if (Math.abs(window.scrollY - aligned) > 1) {
        window.scrollTo({ top: aligned, behavior: 'auto' });
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(realign, 160);
    };
    window.addEventListener('resize', schedule);
    const viewport = window.visualViewport;
    if (viewport) viewport.addEventListener('resize', schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', schedule);
      if (viewport) viewport.removeEventListener('resize', schedule);
    };
  }, [paging]);
  /* ⚠ 2026-10-10 业主：「二级返回一级时，动效还没执行完毕就能触发翻页，会把主卡副卡
     的动效出现在第二屏/尾屏」。转场期间一级页虽然还在场(PC)或已开始回程(移动端),
     它的翻页监听是活的 —— 一旦翻页,形变要落到的那个"源卡位置"就被挪到了别的屏。
     这里把「形变转场进行中」也算作锁定:goHome/goWorks 起跑时置一个上限,
     转场真正结束(onLeavingDone / onEntryArmed)时清零。 */
  const isLocked = () => performance.now() < lockedUntilRef.current
    || performance.now() < (window.__worksMorphUntil || 0);
  const lockFor = (ms) => { lockedUntilRef.current = performance.now() + ms; };

  const goToPage = (next, { instant = false } = {}) => {
    const clamped = Math.max(0, Math.min(HOME_PAGE_COUNT - 1, next));
    setHasEnteredPage(true);
    setIndex(clamped);
    /* ⚠⚠ 翻页动画由本页**自己画**，不要退回 `scrollTo({behavior:'smooth'})`。
       （2026-10-10 业主：努比亚 Z70U 自带浏览器里「上下屏切换有时直接硬切」，
       同机 Edge 正常。）原生平滑滚动把动画交给内核，能不能补间、补到几帧全看
       内核实现；本页还有两处会从外面打断它：
       ① `html[data-paging="on"]` 是 `scroll-snap-type: y mandatory`。地址栏收放
          触发 resize → --vh 变 → 每个分屏的 height 变 → **吸附位置变**，内核会把
          滚动位置瞬时重新吸附，正好把飞行中的动画掐掉（这解释了「有时」：只在
          翻页途中地址栏高度真的变化时复现）。
       ② 同一次 resize 会让上面的 realign（160ms 防抖）在飞行中再发一次
          `behavior:'auto'` 的 scrollTo，同样把它掐掉。
       自己画 + 飞行中挂 `is-flipping`（关掉吸附）+ 飞行中跳过 realign，三条一起消。
       每帧按「缓动进度的增量」推进**剩余行程**（而不是写死 from→to 的直线插值）：
       终点每帧现算，中途视口变高/变矮时终点跟着移动，位置本身始终连续（不会因为
       终点瞬移而把画面拽走一步），最后一帧的增量恰好 = 1 ⇒ 落点精确落在整屏边界上，
       不需要任何事后校正。 */
    const root = document.documentElement;
    const dest = () => clamped * pageHeight();
    if (flipRafRef.current) window.cancelAnimationFrame(flipRafRef.current);
    flipRafRef.current = 0;
    if (instant || reducedRef.current || Math.abs(dest() - window.scrollY) < 2) {
      root.classList.remove('is-flipping');
      scrollingRef.current = false;
      /* 直跳路径没有飞行窗口，但可能紧接在上一段被取消的动画之后，那条路径
         已经把 tailFlipping 置真了，这里必须清掉，否则尾屏会一直停在冻结态。 */
      setTailFlipping(false);
      window.scrollTo(0, dest());
      return;
    }
    const start = performance.now();
    let prevEase = 0;
    let y = window.scrollY;
    root.classList.add('is-flipping');
    scrollingRef.current = true;
    /* 飞行中把尾屏 iframe 整个冻结（见 ContactStreet 的「翻页冻结档」注释）。
       为什么是冻结而不是降频：demo 的单帧渲染耗时是固定的，间隔放宽到大于单帧
       耗时也不会减少任何工作量；实测降频（33ms）在真机上无可感回报。 */
    setTailFlipping(true);
    /* 同一窗口内把 SideRays 全屏柔光也降到 6.7fps（见 SideRays.jsx 的 flipping 注释）。
       用一个独立时间戳，不用 __worksMorphUntil，后者会经 isLocked() 锁住翻页。
       只置时间戳，不手动清零：过期即恢复，翻页被取消时最多多降频 250ms。 */
    window.__raysFlipThrottleUntil = performance.now() + HOME_FLIP_MS + 250;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / HOME_FLIP_MS);
      const ease = flipEase(p);
      const take = p >= 1 ? 1 : (ease - prevEase) / Math.max(1e-3, 1 - prevEase);
      prevEase = ease;
      const to = dest();
      y += (to - y) * Math.min(1, Math.max(0, take));
      if (p < 1) {
        window.scrollTo(0, y);
        flipRafRef.current = window.requestAnimationFrame(tick);
        return;
      }
      window.scrollTo(0, dest());
      flipRafRef.current = 0;
      root.classList.remove('is-flipping');
      scrollingRef.current = false;
      setTailFlipping(false);
    };
    flipRafRef.current = window.requestAnimationFrame(tick);
  };

  /* 翻页飞行中离开一级页 / 组件卸载：停掉 rAF 并摘掉 is-flipping。
     dependency 是 paging ⇒ paging 关掉（进二级页）时也会跑到，html 上不会残留
     那条「关吸附」的 class。 */
  useEffect(() => () => {
    if (flipRafRef.current) window.cancelAnimationFrame(flipRafRef.current);
    flipRafRef.current = 0;
    document.documentElement.classList.remove('is-flipping');
    /* 同一处清翻页标记：转场中离开一级页 / 组件卸载时不能把尾屏留在冻结态。 */
    setTailFlipping(false);
  }, [paging]);

  const step = (direction) => {
    if (isLocked()) return;
    const current = indexRef.current;
    const next = current + direction;
    if (next < 0) return;
    if (next > HOME_PAGE_COUNT - 1) { lockFor(HOME_STEP_LOCK_MS); return; }
    goToPage(next);
    lockFor(HOME_STEP_LOCK_MS);
  };

  // One wheel notch, one page. The native scroll is taken over completely
  // here: left alone it would drift between screens and the paging would fall
  // apart, so every gesture is claimed and resolved by hand.
  useEffect(() => {
    if (!paging) return undefined;

    let gestureAt = 0;
    let settleTimer = 0;
    let touchStartY = 0;
    let touchStartX = 0;
    let touchTracking = false;
    let touchConsumed = false;
    let touchEndTimer = 0;
    let deckGesture = false;   // a touch that began on the mobile card deck: owned by the deck, never a page flip
    // 触点落在缩览图条上的手势（业主 2026-10-09：圆点带/缩览图带上下滑必须能翻屏）。
    // 缩览图条的盒子含顶部 40px 内 padding，圆点下方整条视觉带都在它的命中区里，
    // 旧逻辑把整条带完全豁免 ⇒ 竖滑全被吞。改为按轴锁定：横向 = 原生横 pan，
    // 纵向优势 = 接管为整屏翻页。
    let thumbsGesture = false;
    let thumbsAxisLocked = false;
    let thumbsIsVertical = false;

    const onWheel = (event) => {
      if (event.ctrlKey || event.metaKey) return;    // pinch zoom, leave alone
      // 尾屏(contact = index 3)的 iframe 内部已劫持 wheel：它 preventDefault 掉
      // 自身滚动(所以 demo 相机不动)，再通过 postMessage 把deltaY 交给本页面的
      // message 监听 → 由那里合成 WheelEvent 派发到这里(见 Street.jsx)。
      // 本处只处理落在页面自身(非 iframe)的滚轮，无需再向iframe 回灌，避免环路。
      event.preventDefault();
      const now = performance.now();
      const gap = now - gestureAt;
      gestureAt = now;
      if (isLocked()) return;
      if (gap < HOME_GESTURE_GAP_MS) return;         // same gesture, still streaming
      if (Math.abs(event.deltaY) < 2) return;
      step(event.deltaY > 0 ? 1 : -1);
    };

    const onTouchStart = (event) => {
      if (event.touches.length !== 1) {
        touchTracking = false;
        return;
      }
      const touch = event.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchTracking = true;
      touchConsumed = false;
      // Touches that start on a showcase card are "play" gestures (drag/flip the
      // card). The deck already claims them via touch-action:none + pointer
      // capture, so the pager must not also treat their vertical drift as a
      // whole-screen page flip. Thumbnail-strip touches are NOT exempted here
      // any more — see the axis lock in onTouchMove below.
      deckGesture = !!(event.target && event.target.closest
        && event.target.closest('.mob-deck'));
      thumbsGesture = !!(event.target && event.target.closest
        && event.target.closest('.mob-thumbs'));
      thumbsAxisLocked = false;
      thumbsIsVertical = false;
      window.clearTimeout(touchEndTimer);
    };

    const onTouchMove = (event) => {
      if (deckGesture || !touchTracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (thumbsGesture && !thumbsAxisLocked) {
        // 轴锁定：横向优势（含对角拉扯阶段）放行给原生横 pan，绝不 preventDefault
        // （那会杀死 overflow-x 滚动）；纵向位移过起步噪声后锁定为翻页手势。
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          thumbsAxisLocked = true;
          thumbsIsVertical = false;
          return;
        }
        if (Math.abs(deltaY) < 12) return;
        thumbsAxisLocked = true;
        thumbsIsVertical = true;
      }
      if (thumbsGesture && !thumbsIsVertical) return;   // native horizontal pan
      event.preventDefault();
      if (touchConsumed || isLocked()) return;
      if (Math.abs(deltaY) < HOME_TOUCH_THRESHOLD || Math.abs(deltaY) < Math.abs(deltaX)) return;
      touchConsumed = true;
      step(deltaY < 0 ? 1 : -1);
    };

    const onTouchEnd = () => {
      touchEndTimer = window.setTimeout(() => {
        touchTracking = false;
        touchConsumed = false;
        deckGesture = false;
        thumbsGesture = false;
        thumbsAxisLocked = false;
        thumbsIsVertical = false;
      }, HOME_TOUCH_END_DELAY_MS);
    };

    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target && target.tagName ? target.tagName : '';
      if (target && (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;

      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        if (isLocked()) return;
        goToPage(event.key === 'Home' ? 0 : HOME_PAGE_COUNT - 1);
        lockFor(HOME_STEP_LOCK_MS);
        return;
      }

      let direction = 0;
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ' || event.key === 'Spacebar') direction = 1;
      else if (event.key === 'ArrowUp' || event.key === 'PageUp') direction = -1;
      if (!direction) return;
      event.preventDefault();
      step(direction);
    };

    // Any native scroll that slips through is corrected to the nearest whole
    // screen after the gesture settles. During touch, the move handler already
    // owns the gesture and the correction prevents partial-screen drift.
    const onScroll = () => {
      if (isLocked() || scrollingRef.current) return;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (isLocked() || scrollingRef.current) return;
        const height = pageHeight();
        const nearest = Math.max(0, Math.min(HOME_PAGE_COUNT - 1, Math.round(window.scrollY / height)));
        if (Math.abs(window.scrollY - nearest * height) > 6) {
          goToPage(nearest, { instant: true });
          return;
        }
        if (nearest !== indexRef.current) {
          setIndex(nearest);
        }
      }, 75);
    };

    const onScrollEnd = () => { scrollingRef.current = false; };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(touchEndTimer);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
    };
  }, [paging]);

  // The nav links render outside this component, so they reach the pager
  // through the module-level ref instead of a chain of props.
  useEffect(() => {
    if (!paging) {
      homePagerRef.current = null;
      return undefined;
    }
    homePagerRef.current = {
      jumpTo(id) {
        const target = HOME_PAGE_IDS.indexOf(id);
        if (target < 0) return false;
        if (isLocked()) return true;
        if (target === indexRef.current) return true;
        goToPage(target);
        lockFor(HOME_STEP_LOCK_MS);
        return true;
      },
    };
    return () => { homePagerRef.current = null; };
  }, [paging]);

  // With paging on, arrival at a page is what reveals it - the observer is only
  // there for the unpaged (touch and narrow) layout.
  /* 首页重新可见(二级页返回)时主动重算一次各区块的入场状态。
     goHome 里的滚动恢复是双 rAF,而这一帧 scrollY 还在 0;若只靠滚动事件,
     「可见」这件事就依赖事件时序。这里在 active 翻真的同一帧、以及滚动恢复
     之后各补一次,确保二级页收拢回来的那张卡落在**已经渲染好**的一级页上。 */
  useLayoutEffect(() => {
    if (!active) return undefined;
    projectsResync();
    const timers = [0, 60, 200].map((ms) => window.setTimeout(projectsResync, ms));
    const raf = window.requestAnimationFrame(() => window.requestAnimationFrame(projectsResync));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.cancelAnimationFrame(raf);
    };
  }, [active, projectsResync]);

  const profileVisible = paging ? hasEnteredPage && index === 1 : profileSeen;
  // revealProjects:二级页 → 一级页的回程期间强制点亮(见 App 的 exitWorks)。
  // 回程只有 ~600ms,期间一级页必须**已经是完整的**,否则卡片收拢的落点是一片空。
  const projectsVisible = revealProjects || (paging ? hasEnteredPage && index === 2 : projectsSeen);
  const contactVisible = paging ? hasEnteredPage && index === 3 : contactSeen;

  /* ★ 2026-10-11 业主（第 18 轮）：「动效**只在首次出现**，不要重复出现。」
     之前驱动入场的是 is-visible（= 这一屏是当前屏，可进可出）⇒ 每次翻回来都重播。
     换成 hm-played —— 一个**只加不减**的闩：屏号第一次成为当前屏时挂上，之后永不
     移除。CSS 里入场 animation 挂在它身上；动画规则不被摘掉，浏览器就不会重播，
     于是整个会话里每屏只演一次。is-visible 仍然照旧（离场回落 / 屏内既有揭示）。
     ⚠ 在渲染期直接维护而不是 useEffect + setState：慢一帧会让 is-visible 先挂上、
       闩还没挂上，那一帧文字正停在离场态（opacity 0）—— 观感上就是一次闪烁。
       这里只是往 Set 里加数字，幂等，StrictMode 下重复渲染也无副作用。 */
  const playedRef = useRef(null);
  if (playedRef.current === null) playedRef.current = new Set();
  if (profileVisible) playedRef.current.add(1);
  if (projectsVisible) playedRef.current.add(2);
  if (contactVisible) playedRef.current.add(3);
  const played = playedRef.current;

  return (
    <>
      <HeroSection active={active} onVideoReady={markHeroVideoReady} />

      <section ref={profileRef} className={`profile profile-shot motion-reveal-section${profileVisible ? ' is-visible' : ''}${played.has(1) ? ' hm-played' : ''}`} id="profile">
        {isMobile ? <ProfileContent /> : <ProfileContentPC />}
      </section>

      {/* The projects and contact screens sit on one continuous
          ground. The washes are painted once across all three instead of
          restarting at the top of each screen, so turning a page never reveals a
          fresh bright corner sliding in. */}
      <div className="home-ground">
      <section ref={projectsRef} className={`section projects motion-reveal-section${projectsVisible ? ' is-visible' : ''}${played.has(2) ? ' hm-played' : ''}`} id="projects">
        <div className="container">
          <div className="projects-heading">
            <h2 className="display-reveal-title rany-display-heading">Project Display</h2>
          </div>
        </div>
        <div className="project-list">
          {isMobile ? (
            <MobileShowcaseDeck items={mobileWorksItems} openWorks={openWorks} active={active} focusId={deckFocusId} chromeHidden={chromeHidden} chromeIn={chromeIn} deckVeiled={deckVeiled} />
          ) : (
            <ShowcaseDeck items={worksItems} openWorks={openWorks} />
          )}
        </div>
      </section>

      <section ref={contactRef} className={`contact-page street-contact motion-reveal-section${contactVisible ? ' is-visible' : ''}${played.has(3) ? ' hm-played' : ''}`} id="contact">
        {/* preload：提前挂载 iframe，让 Three.js 的 WebGL 上下文创建、shader 编译、
            logo 纹理加载与【2.7 秒灯光渐入】全部在用户到达尾屏之前完成。
            为什么闸门只有 heroVideoReady 一道（2026-10-04 第二轮修复）：
              旧条件是 heroVideoReady && index >= 2，漏掉了一条真实路径——
              用户在 Home/About 屏直接点导航栏「Contact」直达尾屏。此时 index 从
              0/1 直接跳 3，旧闸门在点击瞬间才放行 → iframe 当场开始加载 demo →
              场景初始化 + 灯光渐入全部落在用户盯着黑屏的时间里（实测截图：
              Contact 导航已高亮、画面仍是纯深色底）。
              demo 的夜街场景有 2.7s 的 intro 灯光渐入（scene.js: intro += dt/2.7，
              dt 被 clamp 到 0.05s 无法快进），intro=0 时所有灯只有 35% 亮度、
              phoneLight 全灭 —— 雨夜没灯就是黑的，这就是黑屏的直接原因。
              （探针测不出来：headless 默认 prefers-reduced-motion → demo
              intro=reduced?1:0 直接跳过渐入，所以探针里永远"秒亮"。）
            heroVideoReady 触发时机 = 首屏视频真正开始播放（playing + readyState>=3）。
            用户铁律是"视频加载优先级最高、尾屏挂载不能在视频之前"——视频一旦
            playing 就已满足，此后无论用户停在哪一屏都放行预挂载：
            用户停留 Home 看视频的几秒里，demo 在后台把 intro 烧完，
            之后无论从哪屏、滚轮还是导航直达，画面都是就绪的。
            微信端无原生 <video>，heroVideoReady 永不触发 → 行为同旧版
            （到尾屏才挂载），无回归。 */}
        <ContactStreet
          active={active && contactVisible}
          preload={active && contactPreload}
          /* 翻页飞行中把尾屏 iframe 整个冻结，落地恢复满帧。
             见 ContactStreet 的「翻页冻结档」注释：降频（33ms）已证明无效，
             因为 demo 单帧渲染耗时本身就大于该间隔。 */
          flipping={tailFlipping}
          onTailReady={() => setTailReady(true)}
          onTailBurned={markTailBurned}
        />
      </section>
      </div>

    </>
  );
}

/* 二级页：
   PC 端 = works-v2.0.0 demo 的 orbit 布局（焦点主卡 + 右侧 rail 列表 + 4s 自动轮播，
   悬停列表暂停 / 切分类或换焦点重置冷却）。
   移动端保持原有竖排 showcase 列表不变。
   顶部 .works-orbit-nav 是**临时保留**的 demo 导航（与项目自身 nav-works 并存用于对比），
   确认后整块删除该 nav 节点即可。 */
const ORBIT_AUTO_DELAY = 4000;

function WorksPage({
  activeCategory, goDetail, workId = '', returning = false,
  entry = null, leaving = false, handingOff = false, onEntryArmed = null, onLeavingDone = null,
  onActiveWorkChange = null, onHome = null
}) {
  const works = worksByCategory[activeCategory.id] ?? [];
  const isMobile = isMobileDevice();
  const [activeIndex, setActiveIndex] = useState(() => {
    const i = works.findIndex((w) => w.id === workId);
    return i >= 0 ? i : 0;
  });
  /* ---- 移动端项目轨道(2026-10-07 打通一级/二级)---------------------------
     一级卡组与二级轨道现在是**同一批 11 张卡、同一个顺序、同一套卡面**,
     两级之间的转场由轨道自己执行(见下方 entry/leaving 两个 effect):
     入场 = 主卡先被摆在源卡矩形上(尺寸也等于源卡),其余卡以同一尺寸叠在它
     身后,然后整轨一起张开到静止姿态;离场 = 反向收拢回首页那张卡。
     没有第二个元素参与交接,所以不可能出现「跳帧换了一张卡」;副卡与主卡
     同帧出发、同帧到位,所以也不再「主卡站稳了副卡才出来」。 */
  const [pos, setPos] = useState(() => {
    /* ⚠ 2026-10-10 第 16 轮(业主第 2 条「二级导航点不动」的真根因之一):
       无 workId 时原先一律落到**整条轨道的第 0 个作品**(恒属默认分类 ui),
       于是「直达 / 首次进入 VI·3D·AIGC」时:轨道先报 UI 首卡 → App 把分类
       回写成 ui → 分类 effect 又把轨道拉回目标分类首卡 → 再报 → …… 两个方向
       互相回写,实测每次 54 次 replaceState,最终 React #185 崩溃黑屏。
       修法:没有 workId 时落到**当前分类的第一张**,与 App 的 route.category
       在同一帧就一致,通知回写是空操作,循环不成立。 */
    const i = WORKS_RAIL.findIndex((w) => w.id === workId);
    const first = WORKS_RAIL.findIndex((w) => w.category === activeCategory.id);
    const p = RAIL_HOME + (i >= 0 ? i : Math.max(0, first));
    /* 副本只有两份时,末尾几个作品会落在允许区间之外 —— 折回一份(两份逐项相同,
       是同一件作品),免得挂载后第一帧就触发一次整轨瞬移。 */
    return p > RAIL_HI ? p - RAIL_N : (p < RAIL_LO ? p + RAIL_N : p);
  });
  const posRef = useRef(pos);
  posRef.current = pos;
  const realIndexOf = (p) => ((p % RAIL_N) + RAIL_N) % RAIL_N;
  const workAt = (p) => WORKS_RAIL[realIndexOf(p)];
  // 'idle' 常态 / 'armed' 入场初始姿态(禁过渡的那一帧) / 'entering' 张开中 /
  // (离场由 leaving 单独驱动,不改 phase —— 它必须是瞬时切换,不能有入场过渡)
  const [phase, setPhase] = useState('idle');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [landed, setLanded] = useState(false);
  /* ---- PC 入场动效的重放计数（2026-10-08 第八轮）-------------------------
     「一级进二级」与「切换分类」都要让主卡 + 列表重新入场。列表槽位是**新节点**
     （key = work.id）⇒ 切分类时自己就重放了；但主卡容器 .works-orbit-focus 与
     rail 标签是**同一批 DOM**，CSS 动画只在 animation-name 变化或元素重建时
     重启 —— 所以这里让 a / b 两个**同内容**的 keyframes 名交替，靠「名字变了」
     重放。比「先摘类、下一帧再挂」少一帧露静止态的闪烁。
     ⚠ 必须 useLayoutEffect：分类切换的 state 要在**绘制前**改完 className；
       useEffect 已经画过一帧原始姿态了。 */
  const [risePass, setRisePass] = useState(0);
  const riseCategoryRef = useRef(activeCategory.id);
  useLayoutEffect(() => {
    if (riseCategoryRef.current === activeCategory.id) return;
    riseCategoryRef.current = activeCategory.id;
    setRisePass((pass) => pass + 1);
  }, [activeCategory.id]);
  const stageRef = useRef(null);
  const pageRef = useRef(null);
  const orbitRef = useRef(null);
  const railHoverRef = useRef(false);
  const timerRef = useRef(null);
  const index = works.length ? Math.min(activeIndex, works.length - 1) : 0;
  const current = works[index];

  const openDetail = (work) => {
    if (!work) return;
    // 2026-10-08: 三级页头图已删,hero morph 没有落点 ⇒ PC 与移动端统一直切
    // (移动端整页翻屏、PC 导航胶囊 morph 照旧),不再查询源卡矩形建飞行层。
    goDetail(work.category ?? activeCategory.id, work.id);
  };
  const openDetailRef = useRef(openDetail);
  openDetailRef.current = openDetail;

  const stopAuto = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startAuto = useCallback(() => {
    stopAuto();
    if (isMobile || works.length < 2 || railHoverRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setActiveIndex((i) => (i + 1) % works.length);
    }, ORBIT_AUTO_DELAY);
  }, [isMobile, works.length, stopAuto]);

  // 换分类 / 换焦点都重新计一次冷却；卸载或离开时清掉定时器。
  useEffect(() => {
    startAuto();
    return stopAuto;
  }, [startAuto, stopAuto, index, activeCategory.id]);
  useEffect(() => {
    // workId 优先(首页点卡 / 返回翻页时定位到来源项目),无 workId 回落 0
    const i = works.findIndex((w) => w.id === workId);
    setActiveIndex(i >= 0 ? i : 0);
  }, [workId, activeCategory.id]);

  // demo fitGallery 的 orbit 分支：主卡封面 16:9，用 stage 剩余高度反推画廊总宽
  //（上限 1140），保证一屏内高度刚好占满、间距与 demo 一致。
  const fitOrbit = useCallback(() => {
    if (isMobile) return;
    const stage = stageRef.current;
    const orbit = orbitRef.current;
    if (!stage || !orbit) return;
    const label = orbit.querySelector('.works-orbit-label');
    const desc = orbit.querySelector('.works-orbit-desc');
    if (!label || !desc) return;
    const s = getComputedStyle(stage);
    const available = stage.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
    const gap = parseFloat(getComputedStyle(orbit).columnGap) || 60;
    const rail = 270;
    const extra = label.offsetHeight + 13 + desc.offsetHeight + 34;
    const mainWidth = Math.max(160, available - extra - 34) * (16 / 9) + 34;
    orbit.style.width = `${Math.min(1140, mainWidth + rail + gap)}px`;
  }, [isMobile]);

  useLayoutEffect(() => {
    fitOrbit();
    const ro = new ResizeObserver(fitOrbit);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener('resize', fitOrbit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fitOrbit);
    };
  }, [fitOrbit, index, activeCategory.id, works.length]);

  /* ---- 移动端项目轨道(2026-10-07 打通一级/二级)-------------------------
     横滑 = 切换项目,闭环:滑过第 11 张回第 1 张;竖滑(上滑)= 进详情;
     点侧卡 = 切到该卡;点主卡 = 进详情。轴锁定:位移超过 10px 才判定主轴。
     指针捕获挂在舞台上,用 elementFromPoint 还原点击命中的卡
     (pointer capture 会把 pointerup 重定向到舞台)。 */
  const trackRef = useRef(null);
  const railRef = useRef({ down: false, axis: null, startX: 0, startY: 0, dx: 0, dy: 0, lastDX: 0, vel: 0, moved: false, pid: null });
  const firstPaintRef = useRef(true);   // 首帧静默归位(不做过场)
  const teleportRef = useRef(false);    // 本次 pos 变更来自整轨瞬移 → 不许补间
  const durRef = useRef(0);             // 覆盖本次补间时长(点导航 = 快速滑动)
  const appliedRef = useRef(null);      // 已写进 DOM 的 pos,避免重复写重启动画
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;

  const railGeom = useCallback(() => {
    const stage = stageRef.current;
    const track = trackRef.current;
    const slide = track ? track.children[0] : null;
    const card = slide ? slide.querySelector('.mw-card') : null;
    if (!stage || !track || !slide || !card) return null;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    /* ⚠ 绝不能用 offsetWidth:它取整(实测 290.812 → 291),再乘上索引
       (pos 最大 21)就把整轨推偏最多 4px —— 探针实测主卡比舞台中心偏左
       2.5px,且入场落点与回程落点各差同一个量。改用 getComputedStyle 读
       已解算的小数宽度(/stage 同理,用 rect.width 而不是 clientWidth)。
       ⚠ 两个宽度必须分开取:卡槽宽(--mw-pitch)决定**排布节距**,卡面宽
       (--mw-card-w)决定**居中基准**。副卡缩小之后槽宽会窄于卡面宽,混用
       会让主卡偏心 —— 见 mobile.css 里 --mw-pitch 的说明。 */
    const slotW = parseFloat(getComputedStyle(slide).width);
    const cardW = parseFloat(getComputedStyle(card).width);
    if (!(slotW > 0) || !(cardW > 0)) return null;
    return { stageW: stage.getBoundingClientRect().width, slideW: slotW + gap, slotW, cardW };
  }, []);

  /* 当前卡左边缘的目标位置。
     ⚠ 卡面在槽里是**居中溢出**的(槽宽 --mw-pitch 窄于卡面宽 --mw-card-w),
       所以要减掉这个内偏移 (slotW − cardW)/2,否则整轨恒定偏心半个差值
       (实测 26.15px,入场首帧与离场落点一起偏)。 */
  const railBase = (g, p) => (g.stageW - g.cardW) / 2 - (g.slotW - g.cardW) / 2 - p * g.slideW;

  const railApply = useCallback((dx = 0, dy = 0, animate = false, extraY = 0, dur = 0) => {
    const track = trackRef.current;
    const g = railGeom();
    if (!track || !g) return;
    const base = railBase(g, posRef.current);
    track.style.transition = animate ? `transform ${dur || 620}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none';
    track.style.transform = `translate3d(${base + dx}px, ${extraY + dy * 0.3}px, 0)`;
  }, [railGeom]);

  // 静止归位:pos 一变就把轨道吸到该索引。整轨瞬移(pos ± N)与首帧都不补间。
  useLayoutEffect(() => {
    if (!isMobile) return undefined;
    if (appliedRef.current === pos) return undefined;
    if (phaseRef.current === 'armed' || phaseRef.current === 'entering') return undefined;
    /* ⚠ 2026-10-10 性能:入场挂载这一趟要跳过 —— 紧接着的入场 effect(声明在后面,
       同一个提交里必然后跑)会把 track 的姿态、transition 与 appliedRef 整个重写一遍,
       这里再写一次是纯多余。更要紧的是:「写」会让入场 effect 的 railGeom()/
       getBoundingClientRect() 变成**写后读** —— 那 165+ 个刚挂载的节点会被强制
       多跑一整趟样式重算 + 布局。探针实测(手机 4× 降速):点击后 89ms 处那记
       80~145ms 长任务的主要成分就是它,而这一记正是业主能看见的「卡一下」。
       只在入场 effect 确实会接管时才跳(它需要 track.children[idx] 里的 .mw-card);
       它要是不接管,这里照旧归位,不会把轨道留在错误位置。 */
    if (entry && entry.rect) {
      const track = trackRef.current;
      const slide = track ? track.children[posRef.current] : null;
      if (slide && slide.querySelector('.mw-card')) return undefined;
    }
    /* ⚠ 离场期间绝不归位:回程的 track transform 是**收拢动画**的一部分,这里一旦
       接管就会把它换成「吸到某个索引」的补间 —— 整轨被拉走,收拢动画当场作废
       (2026-10-07 实测:pos 被改掉时 track 被拽走 477px)。 */
    if (leavingRef.current) return undefined;
    const teleport = teleportRef.current;
    teleportRef.current = false;
    appliedRef.current = pos;
    railApply(0, 0, !firstPaintRef.current && !teleport, 0, durRef.current);
    durRef.current = 0;
    firstPaintRef.current = false;
    return undefined;
  }, [pos, isMobile, railApply]);

  /* 闭环:当前索引越出中间副本时整轨瞬移一份。瞬移前后可见窗口里是同一批卡、
     同一批位置,所以肉眼无变化;必须等补间走完再做 —— 期间整轨还在动,提前
     瞬移会把没走完的那一段吃掉。 */
  useEffect(() => {
    if (!isMobile) return undefined;
    if (pos >= RAIL_LO && pos <= RAIL_HI) return undefined;
    const timer = window.setTimeout(() => {
      teleportRef.current = true;
      setPos((p) => (p > RAIL_HI ? p - RAIL_N : p + RAIL_N));
    }, 680);
    return () => window.clearTimeout(timer);
  }, [pos, isMobile]);

  /* 入场:轨道自己就是那张在飞的卡(替代旧的「裸露 img 覆盖层」)。
     ① 布局阶段先量出主卡静止矩形,再把「源卡姿态」以内联样式压上去:
        整轨下移 (源卡中心 − 主卡中心),每张卡 translateX 到主卡位置并缩放到
        「源卡高度 / 主卡高度」—— 主卡此刻与源卡**同位置、同尺寸**,其余卡以
        同一尺寸精确叠在它身后(完全被挡住)。
     ② 下一帧清掉内联 transform、同时把过渡时长**内联**写死为入场时长,交给
        浏览器张开:主卡回到 scale(1)、副卡从主卡身后抽出来。两者同一时长、
        同一曲线 → 同帧出发、同帧到位,不再出现「主卡站好了副卡才出来」。
        ⚠ 过渡时长必须和内联 transform 在同一次写入里给出:靠类名切换来改时长
          会晚一帧(setState 是异步的),那一帧已经用 520ms 起跑了。
     旧做法的病根:覆盖层是张没有蒙版/标题/阴影的裸图,交接瞬间这些东西凭空
     出现,读起来就是「跳帧换了一张卡」。现在全程只有这张卡本体,没有交接。 */
  const enterDoneRef = useRef(onEntryArmed);
  enterDoneRef.current = onEntryArmed;
  useLayoutEffect(() => {
    if (!isMobile || !entry || !entry.rect) return undefined;
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage) return undefined;
    const idx = posRef.current;
    const slideEl = track.children[idx];
    const cardEl = slideEl ? slideEl.querySelector('.mw-card') : null;
    const g = railGeom();
    if (!cardEl || !g) return undefined;
    const dst = cardEl.getBoundingClientRect();       // 静止态(此刻还没压入场姿态)
    const src = entry.rect;
    if (!(dst.height > 0 && src.height > 0)) return undefined;

    const scale = src.height / dst.height;
    const dy = (src.y + src.height / 2) - (dst.y + dst.height / 2);
    /* 副卡(左右邻居)也必须是**同一张卡**:一级卡组里它们此刻已经摆在主卡两侧
       (±81px、0.86 倍、±8° 倾斜),姿态随 entry 一起传了进来。于是入场初始姿态
       里 idx±1 就停在**它们在一级里的位置**,再与主卡同帧张开到二级的静止位 ——
       副卡从「一级里它原来的位置」接着动,而不是从主卡身后凭空抽出来。
       远处副本看不见,照旧压在主卡位置(被主卡完整盖住)。
       ⚠ 缩放要换算:一级卡面高 = entry.cardH,二级卡面高 = dst.height,同尺寸
         在两级里的 scale 系数不同,直接套 p.scale 会小一圈。 */
    const deckH = entry.cardH || src.height;
    const poseFor = (i) => {
      if (i === idx) return null;
      const p = i === idx - 1 ? entry.prevPose : (i === idx + 1 ? entry.nextPose : null);
      if (!p) return null;
      const k = (p.scale * deckH) / dst.height;
      return `translate(${p.dx - (i - idx) * g.slideW}px, ${p.dy || 0}px) rotate(${p.rot || 0}deg) scale(${k})`;
    };
    const slides = Array.prototype.slice.call(track.children);
    /* 只有屏幕上看得见的三张卡(当前卡 + 左右邻居)参与张开。
       其余副本一律**立即隐藏**,不跟着飞 —— 它们本来就躲在主卡身后,
       参与动效只会白白多画三十张卡(入场起跑空档的旧病根就是这个),
       落到屏幕上还会从主卡两侧露出一圈边。
       ⚠ 必须 `visibility:hidden` 而不是 `display:none`/`remove`:槽位参与 flex
         排布,摘掉任何一个都会让整排位置整体位移,节距和居中全错。 */
    const near = (i) => i >= idx - 1 && i <= idx + 1;
    track.style.transition = 'none';
    track.style.transform = `translate3d(${railBase(g, idx)}px, ${dy}px, 0)`;
    slides.forEach((el, i) => {
      el.style.transition = 'none';
      if (!near(i)) {
        el.style.transform = '';
        el.style.visibility = 'hidden';
        return;
      }
      el.style.transform = poseFor(i) || `translateX(${-(i - idx) * g.slideW}px) scale(${scale})`;
    });
    setPhase('armed');
    phaseRef.current = 'armed';
    appliedRef.current = idx;
    firstPaintRef.current = false;

    let raf = 0;
    raf = window.requestAnimationFrame(() => {
      raf = window.requestAnimationFrame(() => {
        slides.forEach((el, i) => {
          if (!near(i)) return;
          el.style.transition = `transform ${RAIL_EMERGE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          el.style.transform = '';
        });
        track.style.transition = `transform ${RAIL_EMERGE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        track.style.transform = `translate3d(${railBase(g, idx)}px, 0px, 0)`;
        setPhase('entering');
        phaseRef.current = 'entering';
      });
    });
    const done = window.setTimeout(() => {
      /* 收尾要把非邻居卡的 visibility 一起还回去:隐藏只是为了这一次张开,
         落定之后它们照旧在屏外待命(左右滑动时会进来)。 */
      slides.forEach((el) => { el.style.transition = ''; el.style.visibility = ''; });
      setPhase('idle');
      phaseRef.current = 'idle';
      setLanded(true);
      if (enterDoneRef.current) enterDoneRef.current();
    }, RAIL_EMERGE_MS + 40);
    const landedOff = window.setTimeout(() => setLanded(false), RAIL_EMERGE_MS + 1400);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(done);
      window.clearTimeout(landedOff);
    };
  }, [entry, isMobile, railGeom]);

  /* 回程一开始(leaving 一变)就把非邻居卡隐藏掉,不等收拢起跑。
     收拢必须等一级页落点几何稳定(滚动复位 + 焦点瞬移,通常 2~4 帧)才开始,
     而 `mw-leaving` 从第一帧就是亮的 —— 若等到 run() 里才隐藏,这几帧里
     非邻居卡仍是"可见"状态跟着一起等,正是业主看到的"其余卡片也在跟随"。
     它们本来就停在屏外,提前隐藏零视觉代价。 */
  useLayoutEffect(() => {
    if (!isMobile || !leaving) return undefined;
    const track = trackRef.current;
    if (!track) return undefined;
    const idx = posRef.current;
    Array.prototype.forEach.call(track.children, (el, i) => {
      if (i >= idx - 1 && i <= idx + 1) return;
      el.style.transition = 'none';
      el.style.transform = '';
      el.style.visibility = 'hidden';
    });
    return undefined;
  }, [leaving, isMobile]);

  /* 离场:二级 → 一级,反向收拢回首页卡组里的那张卡。
     首页此刻已经可见(goHome 先把卡组焦点瞬移到同一张卡),所以这里能量到真实
     落点;量到之后整轨反向收敛 —— 主卡缩到首页尺寸并移到它的位置,左右两张副卡
     同样收回到**它们在一级卡组里的姿态**(位置/缩放/旋转),结束时二级页卸下,
     屏幕上只剩一级卡组里的同样三张卡,逐像素对齐,所以交接看不见。
     ⚠ 必须是「同一个入场动效的镜像」:入场从一级姿态张开到二级静止位,离场就
       从二级静止位收拢回一级姿态 —— 两端同一张卡、同一曲线、同一时长。 */
  const leaveDoneRef = useRef(onLeavingDone);
  leaveDoneRef.current = onLeavingDone;
  useLayoutEffect(() => {
    if (!isMobile || !leaving) return undefined;
    const idx = posRef.current;
    const work = workAt(idx);
    if (!work) { if (leaveDoneRef.current) leaveDoneRef.current(); return undefined; }
    const realIdx = realIndexOf(idx);
    const prevWork = WORKS_RAIL[(realIdx - 1 + RAIL_N) % RAIL_N];
    const nextWork = WORKS_RAIL[(realIdx + 1) % RAIL_N];
    let raf = 0;
    let tries = 0;
    let lastSig = '';
    let stable = 0;
    let finished = false;

    const poseOf = (el, self) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0)) return null;
      let s = 1; let rot = 0;
      try {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        s = Math.hypot(m.a, m.b) || 1;
        rot = Math.atan2(m.b, m.a) * 180 / Math.PI;
      } catch (_) { /* 无 DOMMatrix 时退化为纯位移+缩放 */ }
      return { dx: (r.x + r.width / 2) - self.cx, dy: (r.y + r.height / 2) - self.cy, scale: s, rot };
    };

    const measure = () => {
      const el = document.querySelector(`[data-deck-work="${work.id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return null;
      const self = { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      const prevPose = poseOf(document.querySelector(`[data-deck-work="${prevWork.id}"]`), self);
      const nextPose = poseOf(document.querySelector(`[data-deck-work="${nextWork.id}"]`), self);
      /* 签名里连两张副卡的姿态一起算:只要任一还在动(卡片复活/滚动未停),就不算稳定。 */
      const sig = [r.x, r.y, r.width, r.height, el.offsetHeight,
        prevPose ? prevPose.dx : NaN, prevPose ? prevPose.scale : NaN,
        nextPose ? nextPose.dx : NaN, nextPose ? nextPose.scale : NaN]
        .map((v) => (Number.isFinite(v) ? v.toFixed(1) : '-')).join('|');
      return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, cardH: el.offsetHeight, prevPose, nextPose, sig };
    };

    const run = (m) => {
      if (finished) return;
      const track = trackRef.current;
      const g = railGeom();
      const slideEl = track ? track.children[idx] : null;
      const cardEl = slideEl ? slideEl.querySelector('.mw-card') : null;
      if (!track || !g || !cardEl) { if (leaveDoneRef.current) leaveDoneRef.current(); return; }
      const dst = cardEl.getBoundingClientRect();
      if (!(dst.height > 0)) { if (leaveDoneRef.current) leaveDoneRef.current(); return; }
      finished = true;
      const rect = m.rect;
      const scale = rect.height / dst.height;
      const dy = (rect.y + rect.height / 2) - (dst.y + dst.height / 2);
      const dur = RAIL_LEAVE_MS;
      const deckH = m.cardH || rect.height;
      const poseFor = (i) => {
        if (i === idx) return null;
        const p = i === idx - 1 ? m.prevPose : (i === idx + 1 ? m.nextPose : null);
        if (!p) return null;
        const k = (p.scale * deckH) / dst.height;
        return `translate(${p.dx - (i - idx) * g.slideW}px, ${p.dy || 0}px) rotate(${p.rot || 0}deg) scale(${k})`;
      };
      const slides = Array.prototype.slice.call(track.children);
      /* 回程只让**屏幕上看得见的三张卡**收拢(业主第四轮第 2 条):
         其余副本直接消失,不跟着飞回一级页。
         旧写法的病:非邻居卡的目标是 `translateX(-(i-idx)·节距)`,那正好是
         「从自己的槽位飞回主卡中心」—— 十几张卡穿过屏幕叠到主卡身上,而主卡
         此刻正在缩小,缩到比它们还窄时就从两侧露出一整圈卡边,读起来就是
         "一堆卡跟着回到一级页"。
         ⚠ 用 visibility 而不是 display:槽位参与 flex 排布,摘掉会改变节距;
         ⚠ 离场不需要还原,WorksPage 收拢结束就卸载。 */
      const near = (i) => i >= idx - 1 && i <= idx + 1;
      slides.forEach((el, i) => {
        if (!near(i)) {
          el.style.transition = 'none';
          el.style.transform = '';
          el.style.visibility = 'hidden';
          return;
        }
        el.style.transition = `transform ${dur}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        el.style.transform = poseFor(i) || `translateX(${-(i - idx) * g.slideW}px) scale(${scale})`;
      });
      track.style.transition = `transform ${dur}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      track.style.transform = `translate3d(${railBase(g, idx)}px, ${dy}px, 0)`;
      window.setTimeout(() => { if (leaveDoneRef.current) leaveDoneRef.current(); }, dur + 40);
    };

    const poll = () => {
      tries += 1;
      const m = measure();
      if (m) {
        // ⚠ 必须连续两帧量到同一组几何:goHome 还在把首页滚回离开时的位置,
        //   量早了读到的是滚动前的坐标,落点会与返回后的卡片错开。
        if (lastSig && lastSig === m.sig) {
          stable += 1;
          if (stable >= 2) { run(m); return; }
        } else {
          stable = 0;
        }
        lastSig = m.sig;
      }
      if (tries >= 90) { if (leaveDoneRef.current) leaveDoneRef.current(); return; }
      raf = window.requestAnimationFrame(poll);
    };
    raf = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(raf);
  }, [leaving, isMobile, railGeom]);

  /* 导航联动(方向一):主卡滑到谁 → 上方导航实时切到它的分类。
     只把结果抛给 App(它更新 route.category 并 replaceState),不在这里改路由 ——
     导航高亮由 App 的 activeCategory 驱动,闭环才不会打架。 */
  const notifyRef = useRef(onActiveWorkChange);
  notifyRef.current = onActiveWorkChange;
  /* --mw-vh(2026-10-09 真机修复·第二轮):业主手机(Firefox Android,overlay 动态
     工具栏)实测 100dvh 和 innerHeight 都等于**全屏高** —— 工具栏是悬浮层,
     盖在 layout viewport 上,二者都不排除它 ⇒ fixed 层仍偏下、底部被裁、
     贴底 hint 不可见。真正排除工具栏的是 visualViewport.height
     (乘回 scale 抵消 pinch-zoom),innerHeight 只作无 visualViewport 的兜底。 */
  useEffect(() => {
    if (!isMobile) return undefined;
    const setVh = () => {
      const vv = window.visualViewport;
      const raw = vv ? vv.height * vv.scale : window.innerHeight;
      const h = Math.round(raw);
      /* ⚠ 2026-10-10 性能:--mw-vh 写在 documentElement 上,写一次就是**全文档**
         样式失效(它喂 .works-index-page 的 height 与 --mw-card-h/--mob-pitch/
         --cross-scale)。而转场里 620ms 的 window.scrollTo(0,0)(见 goWorks)会触发
         visualViewport 的 scroll → setVh,写回一个**完全相同**的值 —— 白送一次
         全文档重算。实测这一笔就是转场期间那次 Layout 的触发栈之一
         (setVh ← commitHookEffectListMount)。值没变就不写。 */
      if (h > 0 && document.documentElement.style.getPropertyValue('--mw-vh') !== `${h}px`) {
        document.documentElement.style.setProperty('--mw-vh', `${h}px`);
      }
    };
    setVh();
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', setVh);
    window.visualViewport?.addEventListener('resize', setVh);
    window.visualViewport?.addEventListener('scroll', setVh);
    return () => {
      window.removeEventListener('resize', setVh);
      window.removeEventListener('orientationchange', setVh);
      window.visualViewport?.removeEventListener('resize', setVh);
      window.visualViewport?.removeEventListener('scroll', setVh);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !notifyRef.current) return undefined;
    const work = workAt(pos);
    if (work) notifyRef.current(work);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, isMobile]);

  /* 导航联动(方向二):点上方导航 → 主卡列表快速滑到该分类的第一张。
     走闭环最短路径(11 张里绕近路),时长压到 440ms,读起来是「快速滑动」。
     ⚠ 两者一致时是空操作 —— 滑到某张卡时 notify 已把分类回写,不会自己滑走。 */
  useEffect(() => {
    if (!isMobile) return undefined;
    /* ⚠ 离场期间不许再滑:goHome 清空 hash 会触发一次 hashchange,parseRoute('')
       把分类重置成默认的 ui,这个 effect 会立刻把主卡滑回 ui 首卡 —— 正在收拢的
       轨道被整体拽走,收拢动画当场作废(业主第三轮之前「回程像换了一张卡」的
       一半原因就在这里)。 */
    if (leavingRef.current) return undefined;
    const cur = workAt(pos);
    if (cur && cur.category === activeCategory.id) return undefined;
    const targetReal = WORKS_RAIL.findIndex((w) => w.category === activeCategory.id);
    if (targetReal < 0) return undefined;
    durRef.current = 440;
    setPos((p) => {
      const curReal = realIndexOf(p);
      let delta = targetReal - curReal;
      if (delta > RAIL_N / 2) delta -= RAIL_N;
      if (delta < -RAIL_N / 2) delta += RAIL_N;
      return delta === 0 ? p : p + delta;
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory.id, isMobile]);

  /* workId 从外部变化(深链、从三级页返回)时归位。就近取道,避免为了相邻两张
     卡横穿整条轨道;同一张卡时空操作,不会被 notify 的回写触发成环。 */
  useEffect(() => {
    if (!isMobile || !workId) return undefined;
    const real = WORKS_RAIL.findIndex((w) => w.id === workId);
    if (real < 0) return undefined;
    setPos((p) => {
      const curReal = realIndexOf(p);
      if (curReal === real) return p;
      let delta = real - curReal;
      if (delta > RAIL_N / 2) delta -= RAIL_N;
      if (delta < -RAIL_N / 2) delta += RAIL_N;
      return p + delta;
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, isMobile]);

  /* 重新吸附:样式/字体就绪之前量出的几何可能是错的(生产环境 CSS 先于 JS,
     这里只是保险)。入场/离场动画期间绝不能重吸 —— 那会把正在张开(或收拢)
     的轨道按回静止位。 */
  useEffect(() => {
    if (!isMobile) return undefined;
    const reapply = () => {
      if (phaseRef.current !== 'idle' || leavingRef.current) return;
      appliedRef.current = posRef.current;
      railApply(0, 0, false, 0);
    };
    const timers = [90, 320, 720].map((t) => window.setTimeout(reapply, t));
    if (document.fonts?.ready) document.fonts.ready.then(reapply).catch(() => {});
    window.addEventListener('resize', reapply);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', reapply);
    };
  }, [isMobile, railApply]);

  /* 滚轮(移动端二级页):向下 = 进三级详情,向上 = 回一级页面。
     与三级页顶部「滚轮向上 = 返回」同向 —— 整套体验是「上下翻屏、左右滑卡」。
     监听挂在 section 上而不是 window:详情层是它的兄弟节点,翻页期间不会被误触。 */
  const homeRef = useRef(onHome);
  homeRef.current = onHome;
  useEffect(() => {
    if (!isMobile) return undefined;
    const el = pageRef.current;
    if (!el) return undefined;
    let last = 0;
    const onWheelEvt = (event) => {
      if (event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      const now = performance.now();
      /* ⚠ 2026-10-10 业主「进入二级后马上滑动鼠标没有任何反应，禁止的时间太长」:
         原来 `last = now` 写在下面那两行判断**之前** —— 于是入场动效期间(700+40ms)
         的每一次滚轮都会把这个节流计数器刷新，人却什么也看不到；等动效结束、真正
         允许操作时，第一下又被 620ms 节流吃掉 ⇒ 体感死区 ≈ 740 + 620 ≈ 1.3s。
          now 只在**事件真正被接受**时才刷新计数器（620ms 防连翻保持原值）。 */
      if (now - last < 620) return;
      if (leavingRef.current || phaseRef.current !== 'idle') return;
      last = now;
      if (event.deltaY > 0) openDetailRef.current(workAt(posRef.current));
      else if (homeRef.current) homeRef.current();
    };
    el.addEventListener('wheel', onWheelEvt, { passive: false });
    return () => el.removeEventListener('wheel', onWheelEvt);
  }, [isMobile]);

  const railDown = (e) => {
    const d = railRef.current;
    d.down = true; d.axis = null; d.moved = false;
    d.startX = e.clientX; d.startY = e.clientY;
    d.dx = 0; d.dy = 0; d.lastDX = 0; d.vel = 0; d.pid = e.pointerId;
    const stage = stageRef.current;
    if (stage?.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
  };
  const railMove = (e) => {
    const d = railRef.current;
    if (!d.down) return;
    const rawDx = e.clientX - d.startX;
    const rawDy = e.clientY - d.startY;
    if (!d.axis) {
      if (Math.abs(rawDx) < 10 && Math.abs(rawDy) < 10) return;
      d.axis = Math.abs(rawDx) > Math.abs(rawDy) ? 'x' : 'y';
    }
    if (d.axis === 'x') {
      // 闭环:没有两端阻尼,滑到边界继续滑就是绕回另一端。
      d.vel = rawDx - d.lastDX; d.lastDX = rawDx; d.dx = rawDx;
      if (Math.abs(rawDx) > 8) d.moved = true;
      railApply(rawDx, 0, false, 0);
    } else {
      /* ⚠ 2026-10-10 业主:「轨道卡片这里手指似乎能拖着卡片上滑,不应该出现
         上滑,只能左右滑动切换轨道卡片」。
         原来这里会把 rawDy 直接喂给 railApply —— 整条轨道跟着手指上下位移
         (dy × 0.3),读起来就是「卡片被拖着走」,且松手时还有一次回弹或反向
         上翻的顿挫。现在垂直方向**只记录位移用于松手判定,不再产生任何跟手
         位移**:轨道始终钉在自己的位置上,视觉上只可能左右动。
         翻页(进详情)仍在松手时按阈值提交 —— 那是「上下翻屏」的入口,不属
         于轨道本体的位移。 */
      d.dy = rawDy;
      if (Math.abs(rawDy) > 8) d.moved = true;
    }
  };
  const railUp = (e) => {
    const d = railRef.current;
    if (!d.down) return;
    d.down = false;
    const stage = stageRef.current;
    if (stage?.releasePointerCapture) { try { stage.releasePointerCapture(d.pid); } catch (_) {} }
    // ⚠ 手势判定结果必须先读成局部常量再更新状态 —— 不能把 d.dx 留在
    // setPos 的 updater 里读:updater 由 React 调度时才执行(该 fiber 已有挂起
    // 更新时不走 eager 路径),而下面紧接着就把 d.dx 清零,读到 0 →「dx < 0」
    // 恒假 → 无论左右滑都切上一张(2026-10-07 探针实测的横滑失灵就是这个)。
    const axis = d.axis;
    const dx = d.dx;
    const dy = d.dy;
    const flick = Math.abs(d.vel) > 0.45;
    d.dx = 0; d.dy = 0; d.axis = null; d.vel = 0; d.lastDX = 0;

    if (!d.moved) {
      // 点击:命中侧卡 → 切到它;命中主卡 → 进详情
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slide = el ? el.closest('.mw-slide') : null;
      const idx = slide && trackRef.current ? Array.prototype.indexOf.call(trackRef.current.children, slide) : -1;
      if (idx >= 0 && idx !== posRef.current) setPos(idx);
      else openDetailRef.current(workAt(posRef.current));
      return;
    }
    if (axis === 'x' && (Math.abs(dx) > 62 || flick)) {
      setPos((p) => p + (dx < 0 ? 1 : -1));
    } else if (axis === 'y' && Math.abs(dy) > 72) {
      openDetailRef.current(workAt(posRef.current));
    } else {
      railApply(0, 0, true, 0);
    }
  };
  const railCancel = () => {
    const d = railRef.current;
    if (!d.down) return;
    d.down = false; d.dx = 0; d.dy = 0; d.axis = null;
    railApply(0, 0, true, 0);
  };

  // 指针视差：只写 CSS 变量，动效交给 CSS transition。
  // 倾斜/位移变量写在共同父级 .works-orbit-focus 上,卡片与镜面倒影同时继承,
  // 倒影才能与主卡同步动(rotateX 取反 = 地面镜像共轭)。
  const handleCardMove = (event) => {
    const card = event.currentTarget;
    const scope = card.closest('.works-orbit-focus') ?? card;
    const box = card.getBoundingClientRect();
    const px = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const py = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    scope.style.setProperty('--rx', `${-py * 8}deg`);
    scope.style.setProperty('--ry', `${px * 11}deg`);
    scope.style.setProperty('--px', `${-px * 12}px`);
    scope.style.setProperty('--py', `${-py * 9}px`);
    card.style.setProperty('--mx', `${(px + 0.5) * 100}%`);
    card.style.setProperty('--my', `${(py + 0.5) * 100}%`);
  };
  const handleCardLeave = (event) => {
    const scope = event.currentTarget.closest('.works-orbit-focus') ?? event.currentTarget;
    ['--rx', '--ry', '--px', '--py'].forEach((key) => scope.style.removeProperty(key));
  };
  const handleRailEnter = () => {
    railHoverRef.current = true;
    stopAuto();
  };
  const handleRailLeave = () => {
    railHoverRef.current = false;
    startAuto();
  };

  const orbitArrow = (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5 19L19 5M5 5h14v14" />
    </svg>
  );
  const orbitChevron = (dir) => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d={dir === 'prev' ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'} />
    </svg>
  );

  if (isMobile) {
    // 2026-10-07 单屏项目轨道:一屏展示全部 11 张卡(按导航分类顺序排列),
    // 左右滑动闭环轮回,上滑/点主卡进详情,点侧卡切到该卡。
    // 轨道与首页卡组是同一批卡、同一套卡面 —— 跨级转场由轨道自己执行
    // (mw-entering / mw-leaving),没有第二个元素参与交接。
    // returning:从三级页返回翻页(上滑)时二级页从屏幕底部同步升回,与详情层
    // 的上滑离场构成「相机上移」的整屏翻页(mw-under-return)。
    /* ⚠ 2026-10-10 性能:轨道这 22 个槽位(154 个节点)只取决于 pos,但原来每次
       WorksPage 重渲染都会把它们整批重建 —— 而进二级页这一段里,WorksPage 会因为
       phase(armed/entering/idle)、landed、handingOff 等状态变化重渲染 5~7 次,
       每一次都白重建这 154 个元素(手机 4× 降速下每次十几到几十毫秒,且正好落在
       动画帧里)。用 useMemo 把依赖收窄成 pos:相位类变化不再触碰这批节点。
       键值、结构、属性完全不变,只是跳过 React 的重建 → 视觉与行为零变化。 */
    const railSlides = useMemo(() => RAIL_SLIDES.map((work, i) => {
      /* 距当前卡 ±RAIL_WINDOW 之外:整张卡不参与绘制、也不解码封面
         (见 RAIL_WINDOW 处的说明)。attribute 存在即代表 far。 */
      const live = Math.abs(i - pos) <= RAIL_WINDOW;
      return (
        <div
          className={`mw-slide${i === pos ? ' is-current' : ''}`}
          key={`${work.id}-${i}`}
          data-rail-index={i}
          data-rail-work={work.id}
          data-far={live ? undefined : ''}
        >
          <button
            type="button"
            className="mw-card"
            aria-label={`${work.title} — 下滑或点按查看设计详情`}
          >
            {/* ⚠ 只给活跃窗口挂 src:33 个节点同时挂上会让首帧一次性解码
                 全部封面,正好压在动画起跑那一帧上(实测多花 ~85ms)。
                 远处副本要么被主卡盖住、要么远在屏外,不需要位图。
                 ⚠ 取 image(3:5)而非 detailHero(16:9):.mw-card 是 3:5,
                   塞 16:9 会被 object-fit:cover 每侧裁掉 33%。且跨级转场
                   要求一级 .mob-card 与二级 .mw-card 是同一张卡面。 */}
            <img
              className="mw-card-img"
              src={live ? (work.image ?? work.detailHero) : undefined}
              alt=""
              decoding="async"
            />
            <span className="mw-card-veil" aria-hidden="true" />
            <span className="mw-card-copy" aria-hidden="true">
              <strong>{work.title}</strong>
              <b>{work.subtitle}</b>
            </span>
          </button>
        </div>
      );
      /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }), [pos]);
    return (
      <section
        ref={pageRef}
        className={`works-index-page${phase === 'entering' ? ' mw-entering' : ''}${phase === 'armed' ? ' mw-armed' : ''}${landed ? ' mw-landed' : ''}${leaving ? ' mw-leaving' : ''}${returning ? ' mw-under-return' : ''}${handingOff ? ' mw-handoff' : ''}`}
      >
        <div
          className="mw-stage"
          ref={stageRef}
          onPointerDown={railDown}
          onPointerMove={railMove}
          onPointerUp={railUp}
          onPointerCancel={railCancel}
        >
          <div className="mw-track" ref={trackRef}>
            {railSlides}
          </div>
        </div>
        <button
          type="button"
          className="mw-hint"
          aria-label="下滑查看设计详情"
          onClick={() => openDetailRef.current(workAt(posRef.current))}
        >
          {/* 2026-10-09 按业主设计稿调整：文字在上、双箭头 icon 在下（原先是
              icon 在上），整体抬高不再贴底（bottom 28px → 60px），icon 22→16、
              文字 10→11px，间距 3→8px —— 比例对齐设计稿（390×845 基准：
              文案底≈760、icon 底≈784、屏底留白≈61px）。 */}
          <span className="mw-hint-text" aria-hidden="true">下滑查看详情</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6.5l6 6 6-6" />
            <path d="M6 12.5l6 6 6-6" />
          </svg>
        </button>
      </section>
    );
  }

  /* 右侧「IN THIS COLLECTION」列表卡片的渲染器：渲染两份 ——
     本体（button，可交互）+ 倒影副本（div，纯视觉）。
     副本走同一套 class，所以 is-selected 位移、封面、排版全部自动同步；
     翻转 / 高斯模糊 / 遮罩由 CSS 的 .works-orbit-rail-mirror 负责。
     （2026-10-08 第五轮：倒影从 -webkit-box-reflect 换成真实 DOM 副本，
       因为 box-reflect 既不支持高斯模糊，也没有可供放大的裁切余量。） */
  const renderRailCard = (work, i, mirror) => {
    const Tag = mirror ? 'div' : 'button';
    const attrs = mirror
      ? { 'aria-hidden': true }
      : {
          type: 'button',
          'aria-pressed': i === index,
          'aria-label': `选择 ${work.title}`,
          onPointerEnter: () => setActiveIndex(i),
          onClick: () => setActiveIndex(i),
        };
    return (
      /* 入场/离场动效的外层槽位（2026-10-08 第八轮）。
         卡片自己的两条动画通道都被占了 —— transform 归「选中位移
         translateX(-7px) / hover」、translate 归常驻慢浮 works-orbit-rail-bob
         —— 入场动画若直接写在卡片上，动画结束那一帧会从 translateY(0)
         硬跳到 translateX(-7px)（动画不参与 transition，是硬切）。
         所以照 PC 个人信息屏的老办法：每张卡配一个**独立入场包装层**，
         动效只碰包装层，卡片两条通道原样不动。
         ⚠ 槽位就是 rail 的 flex item：间距仍由 rail 的 gap:7px 决定，
           几何与不加槽位时逐像素相同。--i 挂在这里，卡片慢浮靠继承取值；
           槽位本身也是新节点（key=work.id）⇒ 切分类时入场动效自动重放。 */
      <div
        key={mirror ? `mirror-${work.id}` : work.id}
        className="works-orbit-rail-slot"
        style={{ '--i': i }}
      >
        <Tag
          className={`works-orbit-rail-card${i === index ? ' is-selected' : ''}`}
          {...attrs}
        >
          <span className="works-orbit-clip" aria-hidden="true">
            <span className="works-orbit-sheen" />
            <span className="works-orbit-glow" />
          </span>
        {/* 列表缩览是 16:9(.works-orbit-rail-card .works-orbit-cover 继承
            .works-orbit-cover 的 16/9),必须取 detailHero。原先取的是
            work.image —— 那个字段现在是 3:5 的移动端卡面素材,放进 16:9 的
            盒子里会每侧裁掉 33%(object-fit:cover)。 */}
          <div className="works-orbit-cover"><img src={work.detailHero ?? work.image} alt={mirror ? '' : work.subtitle} /></div>
          <div className="works-orbit-rail-copy">
            <span>{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{work.title}</h3>
              <p>{work.subtitle}</p>
            </div>
            <span className="works-orbit-rail-arrow">{orbitArrow}</span>
          </div>
        </Tag>
      </div>
    );
  };

  return (
    /* PC 入场/离场动效的相位类（2026-10-08 第八轮）：
         orbit-rise-a / -b —— 同一套入场 keyframes 的两个名字，靠交替重放
                              （见 risePass 注释）；挂在这里而不是元素上，
                              是为了让「主卡 + rail 整个列表」用同一批规则。
         orbit-fall        —— 离场（回一级）：把整层浮到首页上方，
                              卡片按反向错峰坠下淡出、底衬与装饰随后溶解。
       ⚠ 这两个类都带 --orbit 前缀，移动端渲染的是另一个根类（不带 --orbit），
         所以 PC 动效一行都漏不到移动端。 */
    <section
      className={`works-index-page works-index-page--orbit orbit-rise-${risePass % 2 === 0 ? 'a' : 'b'}${!isMobile && leaving ? ' orbit-fall' : ''}`}
      style={{ '--orbit-n': works.length }}
    >
      <div className="works-container works-orbit-container">
        <div className="works-orbit-stage" ref={stageRef}>
          <div className="works-orbit" ref={orbitRef}>
          <div className="works-orbit-focus">
            {/* 悬浮感三件套(2026-10-04):卡片在 .works-orbit-float 里做慢速浮动,
                底座(显示器支架式)承接投影,地面光池 + 镜面反射营造展台感。
                浮动动画走 wrapper 的 transform,不碰卡片自己的 tilt transform。 */}
            <div className="works-orbit-float">
            {current ? (
              <button
                type="button"
                className="works-orbit-card"
                aria-label={`查看 ${current.title}`}
                onPointerMove={handleCardMove}
                onPointerLeave={handleCardLeave}
                onClick={() => openDetail(current)}
              >
                <span className="works-orbit-edge" aria-hidden="true" />
                <span className="works-orbit-clip" aria-hidden="true">
                  <span className="works-orbit-sheen" />
                  <span className="works-orbit-glow" />
                </span>
                <div className="works-orbit-cover">
                  <LazyImage src={current.detailHero ?? current.image} alt={current.title} />
                  <span className="works-orbit-peek"><span>OPEN PROJECT</span>{orbitArrow}</span>
                </div>
              </button>
            ) : null}
            </div>
            {current ? (
              <div className="works-orbit-floor" aria-hidden="true">
                {/* 真实 DOM 镜像:与卡片同宽同高,外框(12px padding + 1px 描边 +
                    15px 圆角)与内层 16:9 画面逐项复刻主卡,使倒影也是一张"卡片",
                    翻转后底面与主卡底边相接。超出地面的部分由 floor overflow 裁掉。 */}
                <div className="works-orbit-floor-mirror">
                  <div className="works-orbit-floor-frame">
                    <div className="works-orbit-floor-media">
                      <img className="works-orbit-floor-mirror-far" src={current.detailHero ?? current.image} alt="" />
                      <img className="works-orbit-floor-mirror-near" src={current.detailHero ?? current.image} alt="" />
                    </div>
                    <span className="works-orbit-floor-sheen" />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div
            className="works-orbit-rail"
            onPointerEnter={handleRailEnter}
            onPointerLeave={handleRailLeave}
          >
            <div className="works-orbit-rail-label">
              IN THIS COLLECTION <span>{String(works.length).padStart(2, '0')}</span>
            </div>
            {works.map((work, i) => renderRailCard(work, i, false))}
            {/* 倒影：真实 DOM 镜像副本（取代 `-webkit-box-reflect` —— 后者既不
                支持高斯模糊，也没有可供放大的裁切余量）。纯视觉、不可交互。 */}
            <div className="works-orbit-rail-mirror" aria-hidden="true">
              {works.map((work, i) => renderRailCard(work, i, true))}
            </div>
          </div>
          </div>
        </div>

        {/* stage 底部信息行 + 页脚点缀（自 demo 移入，纯装饰）
            2026-10-09 业主标注改版（二次澄清）：**不加**分类序号；斜杠后的数字
            不是作品数，而是该分类按导航左右顺序（categories 数组序）的序号：
            UI 设计→01、VI 设计→02、3D 设计→03、AIGC→04。 */}
        <div className="works-orbit-stage-meta">
          <div className="works-orbit-collection-label">
            <span className="works-orbit-dot" />
            <span>{activeCategory.cn}</span>
            <span className="works-orbit-divider">/</span>
            <span>{String(categories.findIndex((c) => c.id === activeCategory.id) + 1).padStart(2, '0')} PROJECTS</span>
          </div>
          <span className="works-orbit-hint">HOVER TO FOCUS<span className="works-orbit-hint-line" /></span>
        </div>
        <footer className="works-orbit-footer">
          <span>设计是看得见的思考，也是看不见的取舍、克制与共情。</span>
          <span className="works-orbit-footer-right">
            2026 <span className="works-orbit-divider">/</span> FOUR DESIGN
          </span>
        </footer>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Long-scroll detail gallery.

   Each exported artwork is one extremely tall JPEG (up to 32768px, ratio up to
   22:1). Loading it as a single file is impossible: the decoded bitmap alone
   would be ~240MB. Every scroll is therefore cut into ~1600px bands in source
   space, encoded at two widths (1470 desktop / 714 mobile) and streamed in as
   the visitor scrolls. Band 1 loads eager + high priority, band 2 eager, all
   later bands are native lazy. Each band carries a ~250 byte inline LQIP so
   the column never collapses or jumps while a band is in flight.
--------------------------------------------------------------------------- */
const SCROLL_ROOT = '/detail';

function ScrollTile({ workId, slug, tile, eager, highPriority }) {
  const [loaded, setLoaded] = useState(false);
  const base = `${SCROLL_ROOT}/${workId}/${slug}/tile-${String(tile.i).padStart(3, '0')}`;
  const desktop = `${base}.webp`;
  const mobile = `${base}@714.webp`;
  return (
    <div
      className={`scroll-tile${loaded ? ' is-loaded' : ''}`}
      style={{ aspectRatio: `${tile.w} / ${tile.h}`, backgroundImage: `url("${tile.lqip}")` }}
    >
      <img
        src={desktop}
        srcSet={`${mobile} ${DETAIL_SCROLLS.mobileWidth}w, ${desktop} ${DETAIL_SCROLLS.desktopWidth}w`}
        sizes="(max-width: 1100px) calc(100vw - 36px), min(1470px, calc(100vw - 220px))"
        width={tile.w}
        height={tile.h}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={highPriority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function DetailScroll({ workId, fallbackImages }) {
  const work = DETAIL_SCROLLS.works[workId];
  const scrolls = work ? work.scrolls : null;
  if (!scrolls || !scrolls.length) {
    if (!fallbackImages || !fallbackImages.length) return null;
    return (
      <div className="detail-image-stack">
        {fallbackImages.map((item, index) => (
          <div className="detail-design-shot" key={item.id ?? `${workId}-fallback-${index}`}>
            <LazyImage src={item.src} alt={item.title} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="detail-scrolls">
      {scrolls.map((scroll) => (
        /* ⚠ key 里必须带 workId（2026-10-13 业主反馈的「三级页图片残留」）。
           只按 scroll.slug / tile.i 做 key 时，A→B 切项目 React 会**复用同一批
           DOM 节点**，只把 <img> 的 src 换成 B 的地址 —— 而浏览器在**新图解码完成
           之前会继续绘制旧图**，于是 B 的页面里明晃晃地留着 A 的图，误导性极强。
           带上 workId 后整块重建：新 <img> 没有任何旧位图，加载期间只显示
           ScrollTile 自己的 LQIP（24×25 内联 webp，拉伸即模糊），
           真图 onLoad 后才淡入（.scroll-tile.is-loaded img）。 */
        <div className="detail-scroll" key={`${workId}-${scroll.slug}`}>
          {scroll.tiles.map((tile, index) => (
            <ScrollTile
              key={`${workId}-${tile.i}`}
              workId={workId}
              slug={scroll.slug}
              tile={tile}
              eager={index < 2}
              highPriority={index === 0}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function WorkDetailPage({ activeCategory, work, flip = '', onSwipeProject = null, onBack = null, neighborWorks = null }) {
  const pageRef = useRef(null);
  const swipeRef = useRef({ down: false, startX: 0, dx: 0, lastDX: 0, vel: 0, moved: false });
  const backRef = useRef({ active: false, startY: 0, pulled: 0 });

  /* 相邻项目首图预取（2026-10-13）:左右滑/点导航切项目时,新项目第一屏的图是
     现场请求的 —— 慢网下用户要盯着 LQIP 模糊图等一会。这里在详情页停留 700ms 后
     （错开当前项目首图的带宽窗口）把左右邻居的第一块 tile 拉进 HTTP 缓存,
     滑动落地时通常已在缓存里。⚠ 只取移动端实际会用的 @714 变形,别把 1470 的
     大图也拉下来 —— 那是桌面端 sizes 才会选中的。 */
  const neighborKey = neighborWorks && neighborWorks.length
    ? neighborWorks.map((item) => (item && item.id) || '').filter(Boolean).join('|')
    : '';
  useEffect(() => {
    if (!neighborKey) return undefined;
    const timer = window.setTimeout(() => {
      neighborKey.split('|').forEach((id) => {
        const entry = DETAIL_SCROLLS.works[id];
        const scroll = entry && entry.scrolls && entry.scrolls[0];
        const tile = scroll && scroll.tiles && scroll.tiles[0];
        if (!scroll || !tile) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = `${SCROLL_ROOT}/${id}/${scroll.slug}/tile-${String(tile.i).padStart(3, '0')}@714.webp`;
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [neighborKey]);

  // 内滚归位:每次切换作品(Last/Next、分类下拉、二级页进入)都回到顶部。
  // ⚠ 返回翻页期间组件**不重挂**、work.id 不变,这个 effect 不会跑 ——
  // 用户停在 50% 的滚动位置得以保持,上滑翻页直接在原地执行(业主明确要求)。
  useEffect(() => {
    const el = pageRef.current;
    if (el) el.scrollTop = 0;
  }, [work?.id]);

  /* 顶部返回(2026-10-07 业主诉求):详情页停在 0%(顶部)时,
     ① 鼠标滚轮向上 ② 触摸「下拉」—— 都触发返回二级页面的翻页。
     ⚠ 为什么是「下拉」而不是「上滑」:详情页是内滚容器,手指上滑在顶部
       就是**正常的阅读滚动**(内容往下走),拦下它详情页就滚不动了。顶部
       唯一空着的手势是向下拉(滚动已被 contain 挡住,今天什么都不发生),
       而它与「滚轮向上」是同一个语义方向(回到上一屏 / 往上一页)。
     下拉只有越过 64px 才提交,普通滚动完全不受影响;提交时先清掉内联
     transform 再交给翻页动画(mwFlipBackOut 从 translateY(0) 起跑)。 */
  useEffect(() => {
    if (!onBack) return undefined;
    const el = pageRef.current;
    if (!el) return undefined;

    const onWheel = (event) => {
      if (el.scrollTop > 0 || event.deltaY >= 0) return;
      // 已经在顶部还继续向上滚 → 不是滚动,是明确的“往回一屏”
      event.preventDefault();
      onBack();
    };
    const onTouchStart = (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      backRef.current = { active: el.scrollTop <= 0, startY: touch.clientY, pulled: 0 };
    };
    const onTouchMove = (event) => {
      const state = backRef.current;
      if (!state.active) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dy = touch.clientY - state.startY;
      if (dy < 0) {
        // 手指向上 = 正常滚动,退出本手势,不做任何拦截
        if (dy < -6) state.active = false;
        return;
      }
      if (el.scrollTop > 0) { state.active = false; return; }
      state.pulled = dy;
      // 顶部下拉:跟手位移(最多 54px),越过一半就开始压住原生回弹
      el.style.transition = 'none';
      el.style.transform = `translateY(${Math.min(dy * 0.45, 54)}px)`;
      if (dy > 4 && event.cancelable) event.preventDefault();
    };
    const finishBack = () => {
      const state = backRef.current;
      if (!state.active) return;
      state.active = false;
      const commit = state.pulled > 64;
      el.style.transition = '';
      el.style.transform = '';
      if (commit) onBack();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', finishBack);
    el.addEventListener('touchcancel', finishBack);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', finishBack);
      el.removeEventListener('touchcancel', finishBack);
    };
  }, [onBack]);

  /* 横滑切换项目(移动端,对应设计稿图二的左右滑)。
     层是 touch-action: pan-y 的内滚容器:竖向滚动交给浏览器原生处理,
     横向位移以 pointer 事件进来 —— 轴锁定后只跟横轴,跟手位移 18%,
     提交阈值 72px 或 flick。翻页动效期间(onSwipeProject 为 null)不挂。 */
  const swipeDown = (e) => {
    const s = swipeRef.current;
    s.down = true; s.moved = false; s.axis = null;
    s.startX = e.clientX; s.dx = 0; s.lastDX = 0; s.vel = 0;
  };
  const swipeMove = (e) => {
    const s = swipeRef.current;
    if (!s.down) return;
    const dx = e.clientX - s.startX;
    if (Math.abs(dx) < 12) return;
    s.vel = dx - s.lastDX; s.lastDX = dx; s.dx = dx; s.moved = true;
    const el = pageRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx * 0.18}px)`;
    }
  };
  const swipeSettle = (commit) => {
    const el = pageRef.current;
    if (el) {
      el.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translateX(0px)';
      window.setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, 340);
    }
    if (commit) onSwipeProject?.(swipeRef.current.dx < 0 ? 1 : -1);
  };
  const swipeUp = () => {
    const s = swipeRef.current;
    if (!s.down) return;
    s.down = false;
    swipeSettle(s.moved && (Math.abs(s.dx) > 72 || Math.abs(s.vel) > 0.5));
  };
  const swipeCancel = () => {
    const s = swipeRef.current;
    if (!s.down) return;
    s.down = false;
    swipeSettle(false);
  };
  const swipeHandlers = onSwipeProject ? {
    onPointerDown: swipeDown,
    onPointerMove: swipeMove,
    onPointerUp: swipeUp,
    onPointerCancel: swipeCancel
  } : {};

  if (!work) return null;

  const detailImages = work.detailImages ?? [
    { id: `${work.id}-fallback-01`, src: work.detailHero, title: `${work.title} detail visual 01` },
    { id: `${work.id}-fallback-02`, src: work.detailHero, title: `${work.title} detail visual 02` },
    { id: `${work.id}-fallback-03`, src: work.detailHero, title: `${work.title} detail visual 03` },
    { id: `${work.id}-fallback-04`, src: work.detailHero, title: `${work.title} detail visual 04` }
  ];

  return (
    <section
      ref={pageRef}
      className={`work-detail-page${flip === 'enter' ? ' mw-flip-enter' : ''}${flip === 'exit' ? ' mw-flip-exit' : ''}`}
      {...swipeHandlers}
    >
      {/* 2026-10-08(业主):三级页头图删除,PC / 移动端同规。
          黑底即间距:.detail-content 的顶部 padding 承担原 hero 的高度,
          PC 170px(≈参考图蓝框高度)、移动端 96px,之后直接进标题区。 */}
      <div className="detail-content">
        <div className="detail-title">
          {/* 2026-10-09(业主):三级页顶部第一行英文小字(activeCategory.label)移除 */}
          <h1>{work.title}</h1>
          <p>{work.subtitle}</p>
        </div>
        <DetailScroll workId={work.id} fallbackImages={detailImages} />
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);




