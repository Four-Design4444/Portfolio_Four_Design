import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Copy, House, Mail, Phone } from 'lucide-react';
import './styles.css';
import './mobile.css';
import fourLogo from './assets/four-logo.svg';
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


// Covers are cropped from the exported long scrolls (see
// .workbuddy/tools/build-detail-covers.py). The gallery itself is served by the
// tiled scrolls in DETAIL_SCROLLS, so no work needs a hand-picked image set.
const worksByCategory = {
  ui: [
    {
      id: 'coomo-home-mini',
      title: 'COOMO HOME',
      subtitle: '家居购物小程序',
      image: '/detail/coomo-home-mini/v1/cover-portrait.webp',
      detailHero: '/detail/coomo-home-mini/v1/cover.webp'
    },
    {
      id: 'smart-home-platform',
      title: 'COOMO HOME',
      subtitle: '智能家居中控平台',
      image: '/detail/smart-home-platform/v1/cover-portrait.webp',
      detailHero: '/detail/smart-home-platform/v1/cover.webp'
    },
    {
      id: 'coomo-official',
      title: 'COOMO 官网',
      subtitle: '家居品牌官网',
      image: '/detail/coomo-official/v1/cover-portrait.webp',
      detailHero: '/detail/coomo-official/v1/cover.webp'
    },
    {
      id: 'muguan-official',
      title: '慕冠家居官网',
      subtitle: '家具品牌官网',
      image: '/detail/muguan-official/v1/cover-portrait.webp',
      detailHero: '/detail/muguan-official/v1/cover.webp'
    }
  ],
  vi: [
    {
      id: 'brand-summer',
      title: 'Brand 觅野',
      subtitle: '品牌视觉系统',
      image: '/detail/brand-summer/v1/cover-portrait.webp',
      detailHero: '/detail/brand-summer/v1/cover.webp'
    },
    {
      id: 'campaign-visual',
      title: '商业活动视觉',
      subtitle: '画册 / KV',
      image: '/detail/campaign-visual/v1/cover-portrait.webp',
      detailHero: '/detail/campaign-visual/v1/cover.webp'
    },
    {
      id: 'packaging-system',
      title: '运营设计',
      subtitle: '海报视觉系统',
      image: '/detail/packaging-system/v1/cover-portrait.webp',
      detailHero: '/detail/packaging-system/v1/cover.webp'
    }
  ],
  '3d': [
    {
      id: 'future-chair',
      title: 'Future Chair',
      subtitle: '产品 3D 渲染',
      image: '/detail/future-chair/v1/cover-portrait.webp',
      detailHero: '/detail/future-chair/v1/cover.webp'
    }
  ],
  aigc: [
    {
      id: 'ai-poster-lab',
      title: 'AI Workflow',
      subtitle: 'ComfyUI 工作流实验',
      image: '/detail/ai-poster-lab/v1/cover-portrait.webp',
      detailHero: '/detail/ai-poster-lab/v1/cover.webp'
    },
    {
      id: 'aigc-model',
      title: 'Model Consistency',
      subtitle: 'AIGC 模特一致性',
      image: '/detail/aigc-model/v1/cover-portrait.webp',
      detailHero: '/detail/aigc-model/v1/cover.webp'
    },
    {
      id: 'aigc-style',
      title: 'AIGC Character',
      subtitle: 'QQ 形象视觉设计',
      image: '/detail/aigc-style/v1/cover-portrait.webp',
      detailHero: '/detail/aigc-style/v1/cover.webp'
    }
  ]
};

// Seven cards laid out as a slightly staggered row (NOT an arc). `left` is the
// resting x position, `restY`/`rot` give each card its small resting tilt and
// vertical nudge, `z` stacks them left-to-right. Hovering a card lifts it to
// the top layer and pushes everything to its right further right, which is
// what makes the row open up. Every card also mirrors into the floor below it.
const projectShowcases = [
  {
    id: 'ui-1',
    category: 'ui',
    work: 0,
    index: '01',
    title: 'COOMO HOME',
    meta: '家居购物小程序',
    description: '以简洁界面与流畅购物流程重构家居线上体验，平衡品牌调性与转化效率。',
    deck: { left: 8.64, rot: -2.6, restY: 8, z: 1 }
  },
  {
    id: 'ui-2',
    category: 'ui',
    work: 1,
    index: '02',
    title: '智家中控平台',
    meta: '智能家居中控界面',
    description: '将多设备控制与场景联动整合为直观的可视化系统，降低用户决策成本。',
    deck: { left: 19.74, rot: -1.6, restY: -2, z: 2 }
  },
  {
    id: 'ui-3',
    category: 'ui',
    work: 2,
    index: '03',
    title: '品牌官方网站',
    meta: '响应式官网设计',
    description: '在多种终端上保持品牌叙事的一致性与高级感，让内容成为视觉主角。',
    deck: { left: 30.84, rot: -0.6, restY: 3, z: 3 }
  },
  {
    id: 'vi-1',
    category: 'vi',
    work: 0,
    index: '04',
    title: 'Brand Visual',
    meta: '品牌视觉系统',
    description: '以统一的图形语言与色彩体系传递品牌核心价值，建立可识别的视觉资产。',
    deck: { left: 41.94, rot: 0.2, restY: -5, z: 4 }
  },
  {
    id: 'vi-2',
    category: 'vi',
    work: 1,
    index: '05',
    title: 'Campaign KV',
    meta: '商业活动视觉',
    description: '围绕主题构建具有冲击力与记忆点的传播画面，让信息在第一眼被捕捉。',
    deck: { left: 53.04, rot: 1.0, restY: 1, z: 5 }
  },
  {
    id: '3d-1',
    category: '3d',
    work: 0,
    index: '06',
    title: 'Product 3D',
    meta: '产品三维渲染',
    description: '用光影与材质塑造真实可信的商品视觉表达，强化产品的高级感与细节张力。',
    deck: { left: 64.14, rot: 1.9, restY: -3, z: 6 }
  },
  {
    id: 'aigc-1',
    category: 'aigc',
    work: 0,
    index: '07',
    title: 'AI Workflow',
    meta: 'ComfyUI 生成工作流',
    description: '把 AI 能力固化为可复用的视觉生产管线，让创意探索从随机走向可控。',
    deck: { left: 75.24, rot: 2.8, restY: 7, z: 7 }
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

function HeroMotionDemo() {
  const [hovered, setHovered] = useState(false);
  const letters = Object.entries(fourLetterPaths);
  const markRef = useRef(null);
  const letterRefs = useRef([]);
  const subtitleRef = useRef(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const hoverTargetRef = useRef(0);

  const handlePointerMove = (event) => {
    const rect = markRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    pointerRef.current = { x: x / 100, y: y / 100 };
    markRef.current.style.setProperty('--hero-pointer-x', `${x.toFixed(2)}%`);
    markRef.current.style.setProperty('--hero-pointer-y', `${y.toFixed(2)}%`);
  };

  const handlePointerEnter = (event) => {
    hoverTargetRef.current = 1;
    setHovered(true);
    handlePointerMove(event);
  };

  const handlePointerLeave = () => {
    hoverTargetRef.current = 0;
    setHovered(false);
    pointerRef.current = { x: 0.5, y: 0.5 };
  };

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

    const smooth = (value) => {
      const t = Math.min(Math.max(value, 0), 1);
      return t * t * t * (t * (t * 6 - 15) + 10);
    };

    const render = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      hoverMix += (hoverTargetRef.current - hoverMix) * (1 - Math.exp(-dt * 9));
      const p = pointerRef.current;

      letterRefs.current.forEach((node, index) => {
        if (!node) return;
        const introDelay = index * 520;
        const introDuration = 2600;
        const intro = smooth((now - start - introDelay) / introDuration);
        const center = centers[index] ?? centers[0];
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const distance = Math.sqrt(dx * dx * 1.2 + dy * dy * 2.8);
        const proximity = Math.max(0, 1 - distance / 0.58);
        const pull = proximity * proximity * hoverMix;
        const wave = Math.sin(now * 0.0028 + index * 1.1) * pull;
        const x = dx * 64 * pull;
        const y = dy * 44 * pull + wave * 3;
        const scaleX = 1 + pull * 0.09;
        const scaleY = 1 + pull * 0.18;
        const blur = 0;

        node.style.opacity = String(intro);
        node.style.filter = `blur(${blur.toFixed(3)}px)`;
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
      });

      if (subtitleRef.current) {
        const intro = smooth((now - start - 1750) / 1200);
        const dx = p.x - 0.5;
        const dy = p.y - 0.82;
        const distance = Math.sqrt(dx * dx * 1.1 + dy * dy * 4.2);
        const proximity = Math.max(0, 1 - distance / 0.74);
        const pull = proximity * proximity * hoverMix;
        const wave = Math.sin(now * 0.0031) * pull;
        const x = -50 + dx * 36 * pull;
        const y = dy * 24 * pull + wave * 2;
        const scaleX = 1 + pull * 0.025;
        const scaleY = 1 + pull * 0.075;
        const blur = (1 - intro) * 8 + pull * (0.3 + proximity * 2.6);

        subtitleRef.current.style.opacity = String(intro);
        subtitleRef.current.style.filter = `blur(${blur.toFixed(3)}px)`;
        subtitleRef.current.style.transform = `translate3d(${x.toFixed(2)}%, ${y.toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
      }

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="hero-motion-demo">
      <div className="hero-motion-bg" />
      <div
        ref={markRef}
        className={`hero-motion-mark${hovered ? ' is-hovered' : ''}`}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <svg className="hero-motion-svg" width="701" height="200" viewBox="0 0 701 200" aria-label="FOUR">
          <g className="hero-motion-logo-core">
            {letters.map(([key, paths], index) => (
              <g
                className="hero-motion-letter"
                style={{ '--letter-delay': `${index * 520}ms` }}
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
        <p className="hero-motion-subtitle" ref={subtitleRef}>Personal works exhibition</p>
      </div>
      <div className="hero-motion-note">
        <span>BlurText style SVG entrance</span>
        <span>Hover FOUR to preview logo blur diffusion</span>
      </div>
    </section>
  );
}

function LogoMark({ large = false }) {
  return <img className={large ? 'four-logo four-logo-large' : 'four-logo'} src={fourLogo} alt="FOUR" />;
}

// 设备形态只由 index.html 头部脚本判定一次(data-device),渲染期内不变
const isMobileDevice = () => document.documentElement.getAttribute('data-device') === 'mobile';

function parseRoute() {
  const hash = window.location.hash;
  if (hash.startsWith('#/hero-motion-demo')) {
    return { page: 'heroMotionDemo', category: 'ui', workId: '' };
  }
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

// 2026-10-05: 三级导航实时自适应亮背景。详情页滚动时导航条底下掠过的内容亮度
// 会变化(顶部 hero 暗、下滑大图可能很亮)。用 elementsFromPoint 探测导航带正下方
// 当前盖着的元素,图片用 canvas 采样真实像素估算平均亮度;超阈值给 body 挂
// .nav-on-light 让玻璃翻深色、保证白字可读。rAF 节流 + 滞回阈值防抖。仅 PC
// 详情页生效(移动端导航是另一套且 dataset 静态)。只改颜色/样式,不动交互动效。
function useDetailNavOnLight(isDetail) {
  useEffect(() => {
    if (!isDetail) {
      document.body.classList.remove('nav-on-light');
      return undefined;
    }
    if (document.documentElement.dataset.device === 'mobile') {
      document.body.classList.remove('nav-on-light');
      return undefined;
    }

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

    // 入场 + 大图懒加载分批到位,延迟复采几次
    const timers = [0, 350, 900, 1800].map((t) => window.setTimeout(measure, t));

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('load', onScroll, true);
      timers.forEach((t) => window.clearTimeout(t));
      if (scrollStopTimer) window.clearTimeout(scrollStopTimer);
      if (frame) window.cancelAnimationFrame(frame);
      document.body.classList.remove('nav-on-light');
    };
  }, [isDetail]);
}

function App() {
  const [route, setRoute] = useState(parseRoute);
  const [homeActiveSection, setHomeActiveSection] = useState('hero');
  const [homeScrollY, setHomeScrollY] = useState(() => Number(window.sessionStorage.getItem('portfolioHomeScrollY') ?? 0));
  const [worksScrollY, setWorksScrollY] = useState(() => Number(window.sessionStorage.getItem('portfolioWorksScrollY') ?? 0));
  const paging = usePagingEnabled(route.page === 'home');
  const [navMotion, setNavMotion] = useState('');
  const [sharedPill, setSharedPill] = useState(null);
  const [sharedImage, setSharedImage] = useState(null);
  const sharedImageRef = useRef(null);
  sharedImageRef.current = sharedImage;
  const [worksActiveLocked, setWorksActiveLocked] = useState(false);
  const previousPageRef = useRef(route.page);
  /* 2026-10-06 移动端二级/三级交互合并:
     - mobileFlip = 'enter' 详情页正从顶部下滑翻入(works 保持在底下可见)
                  = 'cover' 详情页已落定(works 隐藏但保持挂载)
                  = 'exit'  详情页整体上滑翻回 works(不重置内滚)
     - exitDetail 保存退出翻页期间的 {category, work},防止 route 先切回 works
       时 WorkDetailPage 拿到错误的 work 而闪帧。 */
  const [mobileFlip, setMobileFlip] = useState(null);
  const [exitDetail, setExitDetail] = useState(null);
  const mobileFlipTimerRef = useRef(0);
  const scheduleMobileFlipClear = () => {
    window.clearTimeout(mobileFlipTimerRef.current);
    mobileFlipTimerRef.current = window.setTimeout(() => {
      setMobileFlip(null);
      setExitDetail(null);
    }, 720);
  };

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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

  useLayoutEffect(() => {
    if (route.page !== 'detail' || !sharedImageRef.current) return undefined;

    // The morph target is the detail hero, whose box only becomes meaningful
    // once its bitmap is in: with `height: auto` an unloaded hero collapses to
    // a 0px inline or a ~22px alt-text line, and aiming the morph at such a
    // rect squashed the whole cover onto the top edge (seen on mobile). So:
    // wait for the real bitmap before aiming, keep re-aiming while the morph
    // runs (late loads / toolbar resizes then glide instead of snapping), and
    // never leave the overlay stuck if the bitmap never shows up.
    let frame = 0;
    let disposed = false;
    let attempts = 0;
    let hasTarget = false;
    let trackedFrames = 0;
    const selector = '[data-detail-hero-image="true"]';

    const apply = (rect) => {
      setSharedImage((current) => {
        if (!current) return current;
        const prev = current.toRect;
        if (
          prev &&
          Math.abs(prev.x - rect.x) < 0.5 &&
          Math.abs(prev.y - rect.y) < 0.5 &&
          Math.abs(prev.width - rect.width) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5
        ) return current;
        return { ...current, toRect: rect };
      });
      hasTarget = true;
    };

    const updateImageTarget = () => {
      if (disposed || !sharedImageRef.current) return;
      attempts += 1;

      const hero = document.querySelector(selector);
      const rect = hero ? readNavRect(selector) : null;
      const ready = Boolean(hero && hero.complete && hero.naturalWidth > 0);

      if (rect && rect.width > 0 && rect.height > 0 && ready) {
        // The hero figure is a full-bleed image with square corners, so the
        // overlay has to unwind to exactly that before handing the frame over.
        rect.radius = hero ? getComputedStyle(hero).borderRadius : '0px';
        apply(rect);
        trackedFrames += 1;
      } else if (!hasTarget && attempts >= 260) {
        // Bitmap never arrived (~4s). Derive the hero box from the overlay
        // image's own ratio, or drop the overlay rather than freezing it.
        const layerImg = document.querySelector('.shared-image-transition img');
        if (layerImg && layerImg.naturalWidth > 0 && layerImg.naturalHeight > 0) {
          const width = window.innerWidth || 390;
          apply({ x: 0, y: 0, width, height: width * (layerImg.naturalHeight / layerImg.naturalWidth), radius: '0px' });
        } else {
          setSharedImage(null);
          return;
        }
      }

      // While the morph runs, keep following the hero for about its duration
      // so a late layout change retargets the running transition smoothly.
      if (!hasTarget || trackedFrames < 90) {
        frame = window.requestAnimationFrame(updateImageTarget);
      }
    };

    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(updateImageTarget);
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
    };
  }, [route.page, sharedImage?.workId]);

  /* 2026-10-06 移动端:首页卡片 → 二级页的放大落点追踪。
     与上面 detail 的追踪同构,目标是二级页当前主卡里的封面 img
     ([data-work-image]),位图就绪后把 toRect 补给 SharedImageTransition,
     并把圆角从首页卡组的 20px 过渡到二级主卡的圆角。 */
  useLayoutEffect(() => {
    if (route.page !== 'works' || !sharedImageRef.current) return undefined;
    const workId = sharedImageRef.current.workId;
    if (!workId) return undefined;

    let frame = 0;
    let disposed = false;
    let attempts = 0;
    let hasTarget = false;
    let trackedFrames = 0;
    const selector = `[data-work-image="${workId}"]`;

    const apply = (rect) => {
      setSharedImage((current) => {
        if (!current) return current;
        const prev = current.toRect;
        if (
          prev &&
          Math.abs(prev.x - rect.x) < 0.5 &&
          Math.abs(prev.y - rect.y) < 0.5 &&
          Math.abs(prev.width - rect.width) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5
        ) return current;
        return { ...current, toRect: rect };
      });
      hasTarget = true;
    };

    const updateImageTarget = () => {
      if (disposed || !sharedImageRef.current) return;
      attempts += 1;
      const img = document.querySelector(selector);
      const card = img ? img.closest('.mw-card') : null;
      const rect = img && card ? readNavRect(selector) : null;
      const ready = Boolean(img && img.complete && img.naturalWidth > 0);
      if (rect && card && rect.width > 0 && rect.height > 0 && ready) {
        rect.radius = getComputedStyle(card).borderRadius;
        apply(rect);
        trackedFrames += 1;
      } else if (!hasTarget && attempts >= 260) {
        setSharedImage(null);
        return;
      }
      if (!hasTarget || trackedFrames < 90) {
        frame = window.requestAnimationFrame(updateImageTarget);
      }
    };

    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(updateImageTarget);
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
    };
  }, [route.page, sharedImage?.workId]);

  const restoreScroll = (key, fallback) => {
    const saved = Number(window.sessionStorage.getItem(key) ?? fallback);
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo(0, saved)));
  };

  const goHome = () => {
    // 回程也要挂一个 motion 类:`works-to-home` 在 mobile.css 里被用来把
    // **回程的配色节奏**翻过来(线先转白、白圆慢半拍再淡出,见「回程的配色
    // 节奏必须与去程相反」)。此前这里一律置 '',回程就会沿去程的配色时序跑,
    // 中途出现"灰线落在深色背景上"的隐形帧。
    // 形变本身不靠这个类(三条线的 d 是纯 transition,状态类一翻就补间)。
    setNavMotion(route.page === 'home' ? '' : 'works-to-home');
    setSharedPill(null);
    setWorksActiveLocked(false);
    window.location.hash = '';
    setRoute({ page: 'home', category: route.category, workId: '' });
    // The home layer stayed mounted, so its screen index is still the one the
    // reader left on. Restore the recorded entry offset, which on a paged home
    // is exactly that screen boundary, so the wheel controller and the view
    // stay in step instead of being reset to screen 01.
    restoreScroll('portfolioHomeScrollY', homeScrollY);
  };

  const goWorks = (category = route.category, restore = false, opts = null) => {
    if (route.page === 'home') {
      setNavMotion('home-to-works');
      // 2026-10-06 移动端:首页点卡 → 二级页,卡片放大无缝接入。
      // 复用 SharedImageTransition:from = 首页卡组卡片,to = 二级页当前主卡
      // (由下方 route.page==='works' 的追踪 effect 补 toRect)。
      if (opts?.rect && opts?.src) {
        setSharedImage({
          src: opts.src,
          fromRect: opts.rect,
          fromRadius: '20px',
          toRect: null,
          workId: opts.workId ?? ''
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
    window.scrollTo(0, 0);
    const workId = opts?.workId ?? '';
    window.location.hash = `/works?category=${category}${workId ? `&work=${workId}` : ''}`;
    setRoute({ page: 'works', category, workId });
    if (restore) {
      restoreScroll('portfolioWorksScrollY', worksScrollY);
    } else {
      window.requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  };

  const goDetail = (category, workId, transitionImage) => {
    const fromRect = readNavRect(`[data-category-pill="${category}"]`);
    if (fromRect) {
      setSharedPill({ rect: fromRect, title: categories.find((item) => item.id === category)?.title ?? activeCategory.title, mode: 'works' });
    }
    if (transitionImage?.rect && transitionImage?.src && !isMobileDevice()) {
      setSharedImage({
        src: transitionImage.src,
        fromRect: transitionImage.rect,
        fromRadius: transitionImage.radius ?? '12px',
        toRect: null,
        workId
      });
    } else {
      setSharedImage(null);
    }
    setWorksActiveLocked(false);
    setNavMotion('to-detail');
    // 2026-10-06 移动端:进入详情改为「下滑翻页」——详情层从顶部滑入盖住二级页,
    // 导航 morph(works→detail)照旧由路由驱动,这里只负责层的入场。
    if (isMobileDevice()) {
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
    window.location.hash = `/detail?category=${activeCategory.id}&work=${target.id}`;
    setRoute({ page: 'detail', category: activeCategory.id, workId: target.id });
    window.scrollTo(0, 0);
  };

  const goDetailCategory = (category) => {
    const target = worksByCategory[category]?.[0];
    if (!target) return;

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
    const entryCategory = window.sessionStorage.getItem('portfolioDetailEntryCategory');
    const shouldRestore = entryCategory === route.category;
    // A back tap during the entry morph would otherwise strand the overlay on
    // the works page: nothing re-aims it there, so drop it explicitly.
    setSharedImage(null);
    setWorksActiveLocked(true);
    window.setTimeout(() => setWorksActiveLocked(false), 860);
    setNavMotion('to-works');
    if (isMobileDevice()) {
      // 2026-10-06 移动端返回 = 上滑翻页:详情层(内滚停在原处,不回卷到 0)
      // 整体向上滑出,露出底下的二级页。route 先切 works 让导航同时开始
      // detail→works 的 morph;WorkDetailPage 借 exitDetail 保持挂载 720ms。
      window.clearTimeout(mobileFlipTimerRef.current);
      setExitDetail({ category: activeCategory, work: activeWork, workId: activeWork?.id ?? '' });
      setMobileFlip('exit');
      scheduleMobileFlipClear();
      goWorks(route.category, false, { workId: activeWork?.id ?? '' });
      return;
    }
    goWorks(route.category, shouldRestore);
  };

  return (
    <>
      <main>
        {route.page !== 'heroMotionDemo' && (
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
        )}
        {sharedPill && <SharedCategoryPill pill={sharedPill} />}
        {sharedImage && (
          <SharedImageTransition
            transition={sharedImage}
            onDone={() => setSharedImage(null)}
          />
        )}
        {route.page === 'heroMotionDemo' ? (
          <HeroMotionDemo />
        ) : (
          <>
            {/* The home layer is never unmounted, only hidden. Its images,
                video and scroll position survive a trip into works or detail,
                so coming back needs no reload and lands on the same screen. */}
            <div
              className={`page-keep${route.page === 'home' ? '' : ' is-hidden'}`}
              aria-hidden={route.page !== 'home'}
            >
              <HomePage
                openWorks={goWorks}
                paging={paging && route.page === 'home'}
                active={route.page === 'home'}
              />
            </div>
            {/* 2026-10-06 移动端:详情页在底下时二级页保持挂载(翻页动效的底层),
                enter 期间可见(详情层还没盖满)、落定后 visibility 隐藏但不卸载,
                返回翻页时立刻可见。PC 端维持原样(只有 works 才挂载)。 */}
            {route.page === 'works' ? (
              <WorksPage
                activeCategory={activeCategory}
                goDetail={goDetail}
                workId={route.workId}
                arriving={Boolean(sharedImage && sharedImage.workId)}
              />
            ) : route.page === 'detail' && isMobileDevice() ? (
              <div
                className={`mw-under${mobileFlip === 'enter' ? '' : ' is-covered'}`}
                aria-hidden="true"
              >
                {/* workId 跟随路由:详情翻入的 640ms 里,底下露出的必须是
                    用户刚点进来的那张卡,而不是回落到第 0 张 */}
                <WorksPage activeCategory={activeCategory} goDetail={goDetail} workId={route.workId} />
              </div>
            ) : null}
            {route.page === 'detail' || exitDetail ? (
              <WorkDetailPage
                activeCategory={exitDetail ? exitDetail.category : activeCategory}
                work={exitDetail ? exitDetail.work : activeWork}
                imageTransitionActive={!exitDetail && Boolean(sharedImage && sharedImage.workId === activeWork?.id)}
                flip={mobileFlip}
                onSwipeProject={
                  !exitDetail && isMobileDevice() && works.length > 1
                    ? (dir) => goDetailByIndex(activeIndex + dir)
                    : null
                }
              />
            ) : null}
          </>
        )}
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

// The image itself never carries the corner: on the list it is the card shell
// (mobile) or the image button (desktop) that clips it. Walk up to whatever is
// actually rounding the picture so the morph starts from the visible radius.
function readClippedRadius(element) {
  let node = element;
  while (node && node !== document.body) {
    const radius = getComputedStyle(node).borderRadius;
    if (radius && radius !== '0px' && radius !== '0%') return radius;
    node = node.parentElement;
  }
  return '0px';
}

function SharedImageTransition({ transition, onDone }) {
  const [isMoving, setIsMoving] = useState(false);
  const targetRect = transition.toRect ?? transition.fromRect;
  const rect = isMoving ? targetRect : transition.fromRect;
  // Corners travel with the box: the overlay starts with the radius that is
  // really clipping the cover on the list (mobile 18px / desktop 12px) and
  // unwinds to the radius the hero figure itself has, so the hand-off at the
  // end matches instead of snapping square.
  const radius = (isMoving ? targetRect.radius : transition.fromRadius) ?? transition.fromRadius ?? '12px';
  const style = {
    '--image-x': `${rect.x}px`,
    '--image-y': `${rect.y}px`,
    '--image-w': `${rect.width}px`,
    '--image-h': `${rect.height}px`,
    '--image-radius': radius
  };

  useEffect(() => {
    if (!transition.toRect) return undefined;
    const frame = window.requestAnimationFrame(() => setIsMoving(true));
    return () => window.cancelAnimationFrame(frame);
  }, [transition.toRect]);

  return (
    <div
      className="shared-image-transition"
      style={style}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'width') onDone();
      }}
      aria-hidden="true"
    >
      <img src={transition.src} alt="" />
    </div>
  );
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

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    let frame = 0;
    const syncVisibility = () => {
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

    const observer = new IntersectionObserver(
      ([entry]) => {
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
    const visibilityTimer = window.setInterval(syncVisibility, 240);
    window.addEventListener('scroll', syncVisibility, { passive: true });
    window.addEventListener('resize', syncVisibility);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearInterval(visibilityTimer);
      window.removeEventListener('scroll', syncVisibility);
      window.removeEventListener('resize', syncVisibility);
    };
  }, [threshold, rootMargin]);

  return [ref, visible];
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
    const onScrollEnd = () => { lockIndexRef.current = -1; moveTo(itemIndexFromScroll(), false); };
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
      {!isDetail && <button type="button" className="morph-logo" data-shared-logo-anchor="true" onClick={goHomeWithScroll} aria-label="FOUR Home"><LogoMark /></button>}
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
            onClick={() => goWorks(category.id)}
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
  // right. That is what makes the row "fan open", and it is why moving from
  // card 1 to card 2 makes card 1 drop back and slide left again.
  const PUSH = 24;      // px a neighbour shifts away from the hovered card
  const PUSH_CAP = 3;   // neighbours further than this many steps move no more

  return (
    <div
      ref={stageRef}
      className={`showcase-deck${visible ? ' is-visible' : ''}`}
      onPointerLeave={() => setHovered(-1)}
    >
      {items.map(({ project, cover }, index) => {
        const active = index === hovered;
        const distance = index - hovered;
        const push = hovered < 0 || active
          ? 0
          : Math.sign(distance) * Math.min(Math.abs(distance), PUSH_CAP) * PUSH;

        const deckVars = {
          '--x': `${project.deck.left}%`,
          '--rot': active ? 0 : project.deck.rot,
          '--y': active ? -46 : project.deck.restY,
          '--push': push,
          '--scale': active ? 1.06 : 1,
          '--z': active ? 60 : project.deck.z,
          '--i': index
        };

        return (
          <React.Fragment key={project.id}>
            {/* The reflection belongs to the floor, not to the card. It follows
                the card horizontally, but stays on the fixed ground plane while
                the card itself can float higher on hover. */}
            <span
              className={`showcase-deck-reflection${active ? ' is-active' : ''}`}
              aria-hidden="true"
              style={{ ...deckVars, '--mirror-push': `${push}px` }}
            >
              <LazyImage src={cover} alt="" aria-hidden="true" />
            </span>
            <div
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
                onClick={() => openWorks(project.category)}
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
          </React.Fragment>
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
function MobileShowcaseDeck({ items, openWorks }) {
  const deckRef = useRef(null);
  const cardRefs = useRef([]);
  const dimRefs = useRef([]);
  const thumbRefs = useRef([]);
  const dotRefs = useRef([]);
  const counterRef = useRef(null);
  const stripRef = useRef(null);
  const ctxRef = useRef({ items, openWorks });
  ctxRef.current = { items, openWorks };

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
      const isMain = s.isDrag && Math.abs(r) < 0.5;
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
      el.style.transition = s.isDrag ? 'none' :
        'transform .58s cubic-bezier(.26,1.24,.44,1), opacity .38s ease';
      el.style.transform = transform;
      el.style.opacity = op;
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
          // 2026-10-06 移动端:带上卡片几何与封面,二级页用 SharedImageTransition
          // 做放大无缝接入(卡片从首页原位放大成二级页主卡)。
          const cardEl = cardRefs.current[s.downIdx];
          const rect = cardEl ? cardEl.getBoundingClientRect() : null;
          ctxRef.current.openWorks(item.project.category, false, {
            workId: item.project.id,
            rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
            src: item.cover
          });
        }
      } else {
        goToRef.current(s.downIdx);
      }
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
      if (!stateRef.current.isDrag) goToRef.current(stateRef.current.active + 1);
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
    <div className="mob-showcase">
      <h2 className="mob-heading rany-display-heading">Project Display</h2>
      <div className="mob-counter" ref={counterRef}>01 / 11</div>

      <div className="mob-stage">
        <div className="mob-deck" ref={deckRef}>
          {items.map(({ project, cover }, i) => (
            <div
              className="mob-card"
              key={project.id}
              data-idx={i}
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
      <button
        type="button"
        className="mob-viewall"
        onClick={() => ctxRef.current.openWorks('ui')}
      >
        查看全部
      </button>
      <div className="mob-thumbs" ref={stripRef}>
        {items.map(({ project, cover }, i) => (
          <div
            className="mob-thumb"
            key={project.id}
            ref={(el) => { thumbRefs.current[i] = el; }}
            onClick={() => { goToRef.current(i); if (scheduleCarouselRef.current) scheduleCarouselRef.current(); }}
          >
            <LazyImage src={cover} alt="" />
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

/* Lazy-loads an image: the real src is only assigned once the element is within
   one viewport of the screen, so flipping to the next paged screen already has
   its images ready. No placeholder is used; the surrounding layout reserves the
   space via CSS aspect-ratio or fixed dimensions. */
function LazyImage({ src, alt = '', className, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.src = src;
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.src = src;
          io.disconnect();
        }
      },
      { root: null, rootMargin: '100% 0px 100% 0px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
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
    const measure = () => {
      const nodes = [...document.querySelectorAll(selector)];
      if (nodes.length !== count) return;
      if (nodes.some((n) => !isRendered(n))) return;
      /* 正在 dock 形变中就别量：此刻的宽度是动画中间值，写回 CSS 会自激。 */
      const row = nodes[0].parentElement;
      if (row && row.classList.contains('is-docked')) return;
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
      /* 2026-10-04 修 BUG:以二级页 URL 刷新启动时首页隐藏,首次量出的宽度
         全为 0(芯片变成细条)且无人重测。RO 挂在每枚芯片上,但回调必须
         防抖 120ms:dock 展开收起的 width 过渡期间芯片每帧都在变,逐帧测量
         会把过渡中间值写回 CSS(实测停在 48px 的中间态);防抖后只在尺寸
         稳定 120ms 后量一次,拿到的必然是落定的静止宽度。 */
      if (!ro) {
        ro = new ResizeObserver(() => {
          clearTimeout(roTimer);
          roTimer = setTimeout(measure, 120);
        });
        nodes.forEach((n) => ro.observe(n));
      }
    };
    measure();
    /* 字体加载完 / 容器宽度变化都会改静止态宽度，各等一次。 */
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    const t = setTimeout(measure, 400);
    /* 2026-10-04 修 BUG:以二级页 URL 刷新启动时首页隐藏,挂载时量出的宽度
       全为 0(芯片变细条)。RO 方案在预览面板冻结渲染下不可靠,改为确定性
       方案:路由 hash 变化(返回一级)后按 200/600/1200ms 各重测一次,
       此时首页必然已渲染,量到的是落定的静止宽度。 */
    const onHash = () => { [200, 600, 1200].forEach((d) => setTimeout(measure, d)); };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('hashchange', onHash); clearTimeout(t); clearTimeout(roTimer); if (ro) ro.disconnect(); };
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
    const probe = measureStatDockWidth._probe || (measureStatDockWidth._probe = document.createElement('span'));
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
    document.body.append(probe);
    probe.style.fontSize = dockNameFont;
    const dockFontPx = parseFloat(getComputedStyle(probe).fontSize);
    probe.style.fontSize = '';
    probe.style.paddingLeft = dockPadX;
    const dockPadPx = parseFloat(getComputedStyle(probe).paddingLeft);
    probe.remove();
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
       经验/技能卡展开后高度为 0、无法正常显示。RO 在测量条
       获得真实高度(首页变为可见)时自动重测,自愈;另配路由 hash 变化后的
       200/600/1200ms 三次确定性重测(预览面板冻结渲染时 RO 不可靠)。 */
    const ro = new ResizeObserver(() => measure());
    root.querySelectorAll('.mob-card-measure').forEach((m) => ro.observe(m));
    window.addEventListener('resize', measure);
    const onHash = () => { [200, 600, 1200].forEach((d) => setTimeout(measure, d)); };
    window.addEventListener('hashchange', onHash);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('hashchange', onHash); };
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
  const timerRef = useRef(0);
  const widthsRef = useRef({ main: 0, done: 0 });
  const copiedRef = useRef(false);
  const [copied, setCopied] = useState(false);

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
    setCopied(true);
    timerRef.current = setTimeout(() => {
      copiedRef.current = false;
      rollerRef.current.style.width = widthsRef.current.main + 'px';
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
      <span className="pf-copy-text">
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
// 缓冲余量：短视频取「片长的一半」，长片最多等 1.5s，避免为一条几十秒的片子干等。
const HERO_SMOOTH_AHEAD_SEC = 1.5;
// 兜底：视频报错 / 极慢网络 / 自动播放被拦时永远等不到「能连续播」，不能把首屏永久
// 扣在遮罩后面，到点直接放行。要小于 index.html 的 HARD_CAP，这样揭幕时进度条是补
// 满 100% 的，而不是硬超时那种「停在原处淡出」。
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
    const supportsHEVC = HERO_HEVC_CODEC_TYPES.some((type) => /^(probably|maybe)$/.test(video.canPlayType(type)));
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
        const smooth = (node) => {
          if (!node) return false;
          if (node.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return false;
          // 真的在动才算：缓冲够了但被自动播放策略摁住的，交给兜底放行。
          if (node.paused && (node.currentTime || 0) <= 0.05) return false;
          const need = isFinite(node.duration) && node.duration
            ? Math.min(HERO_SMOOTH_AHEAD_SEC, node.duration * 0.5)
            : HERO_SMOOTH_AHEAD_SEC;
          return bufferedAhead(node) >= need;
        };
        const heroSmooth = () => {
          const list = [v];
          document.querySelectorAll('video.hero-video-alpha').forEach((extra) => list.push(extra));
          return list.every(smooth);
        };
        const mark = (force) => {
          if (videoReadyRef.current) return;
          if (!force && !heroSmooth()) return;
          videoReadyRef.current = true;
          if (stopReadyWatch) { stopReadyWatch(); stopReadyWatch = null; }
          try { onVideoReady(); } catch (_) { /* noop */ }
        };
        const onProgress = () => mark(false);
        v.addEventListener('playing', onProgress);
        v.addEventListener('canplay', onProgress);
        v.addEventListener('progress', onProgress);
        v.addEventListener('timeupdate', onProgress);
        const smoothPoll = window.setInterval(onProgress, 200);
        const smoothFailSafe = window.setTimeout(() => mark(true), HERO_SMOOTH_FAILSAFE_MS);
        stopReadyWatch = () => {
          window.clearInterval(smoothPoll);
          window.clearTimeout(smoothFailSafe);
          v.removeEventListener('playing', onProgress);
          v.removeEventListener('canplay', onProgress);
          v.removeEventListener('progress', onProgress);
          v.removeEventListener('timeupdate', onProgress);
        };
      }
    }
    const kick = () => {
      const video = pickVideo();
      if (!video) return;
      diag.attempts += 1;
      diag.mutedAttr = video.hasAttribute('muted');
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
    const renderMatte = (colorSnapshot, matteSnapshot) => {
      alphaGl.viewport(0, 0, alphaCanvas.width, alphaCanvas.height);
      [colorSnapshot, matteSnapshot].forEach((snapshot, index) => {
        alphaGl.activeTexture(alphaGl.TEXTURE0 + index);
        alphaGl.bindTexture(alphaGl.TEXTURE_2D, matteTextures[index]);
        alphaGl.texImage2D(alphaGl.TEXTURE_2D, 0, alphaGl.RGBA, alphaGl.RGBA, alphaGl.UNSIGNED_BYTE, snapshot);
      });
      alphaGl.drawArrays(alphaGl.TRIANGLE_STRIP, 0, 4);
      if (alphaGl.getError() !== alphaGl.NO_ERROR) throw new Error('WebGL matte render failed');
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

    const releaseSnapshot = (snapshot) => {
      if (!snapshot) return;
      snapshot.width = 1;
      snapshot.height = 1;
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
          canvas.width = width;
          canvas.height = height;
        }
      });
    };
    const makeSnapshot = (video, canvas, keepAlpha) => {
      const width = canvas.width || HERO_FRAME_WIDTH;
      const height = canvas.height || HERO_FRAME_HEIGHT;
      const snapshot = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
      snapshot.width = width;
      snapshot.height = height;
      const context = snapshot.getContext('2d', { alpha: keepAlpha });
      if (!context) return null;
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

    const checkForStall = () => {
      if (disposed) return;
      // 因滚动出屏而被我们主动暂停时，别把"暂停"误判成"卡死"再拉起来。
      if (!heroInView) { stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS); return; }
      const now = performance.now();
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

    // 暂停：停时钟 + 丢帧配对 + 取消 rVFC 合成循环（同时停掉兜底 rAF）。
    const pauseHidden = () => {
      try { base.pause(); } catch {}
      try { alpha.pause(); } catch {}
      cancelVideoFrameCallbacks();
      if (fallbackRaf) { window.cancelAnimationFrame(fallbackRaf); fallbackRaf = 0; }
    };
    // 恢复：仅在还没跑到时重新起播并重启合成循环，避免重复启动。
    const resumeVisible = () => {
      if (!active) return;
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
      pauseHidden();
    } else {
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
      if (!inView) pauseHidden();
      else resumeVisible();
    }, { threshold: 0 });
    if (heroSection) visibilityObserver.observe(heroSection);

    return () => {
      disposed = true;
      if (visibilityObserver) visibilityObserver.disconnect();
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
    };
  }, [assetMode, isMobile, useWebglRenderer, active]);

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
    const start = performance.now();
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
    };
    const render = (now) => {
      refreshPaths();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      hoverMix += (hoverTargetRef.current - hoverMix) * (1 - Math.exp(-dt * 12));
      const p = pointerRef.current;
      paths.forEach((node, index) => {
        const center = centers[index] || { x: 0.5, y: 0.5 };
        const isWelcome = node.dataset.welcomePart !== undefined;
        const welcomeIndex = Number(node.dataset.welcomePart || 0);
        const introDelay = isWelcome ? 1080 + welcomeIndex * 55 : index * 120;
        const intro = smooth((now - start - introDelay) / 1800);
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
        node.style.opacity = String(intro);
        node.style.filter = `blur(${((1 - intro) * 52).toFixed(3)}px)`;
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rotate.toFixed(2)}deg) skewX(${skew.toFixed(2)}deg) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
      });
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
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
                dangerouslySetInnerHTML={{ __html: heroTitleMarkup }}
              />
              <span className="hero-title-byline">Four Design</span>
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
function HomePage({ openWorks, paging, active = true }) {
  const [profileRef, profileSeen] = useRevealOnView();
  // 首屏视频是否已真正开始播放。尾屏预挂载必须等这个信号 —— 首屏视频优先级
  // 绝对最高，WebGL 编译绝不能抢在它前面（抢了会拖慢视频首帧）。
  const [heroVideoReady, setHeroVideoReady] = useState(false);
  const markHeroVideoReady = useCallback(() => setHeroVideoReady(true), []);
  // 首屏 Loading 遮罩只在首页出现（index.html 按 hash 判定），揭幕信号也只由
  // 首页给出：hero 真正播起来 = 首屏内容加载完毕。遮罩里的进度条另有真实来源
  // （preload 资源条目 + <video> buffered），这个事件只是"可以揭幕了"的终判。
  useEffect(() => {
    if (!heroVideoReady) return undefined;
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('app:ready')));
    return () => window.cancelAnimationFrame(frame);
  }, [heroVideoReady]);
  const [projectsRef, projectsSeen] = useRevealOnView();
  const [contactRef, contactSeen] = useRevealOnView({ threshold: 0.16 });
  const [contactPreload, setContactPreload] = useState(false);
  useEffect(() => {
    const el = contactRef.current;
    if (!el) return undefined;
    // 临近视口才预挂载尾屏 iframe：提前 ~1.5 屏触发，既留出 INTRO_BURN_MS(3.2s)
    // 烧录灯光 intro 的余量，又不会在用户停首屏看视频时白白占用一个 WebGL 上下文。
    const io = new IntersectionObserver(
      ([entry]) => setContactPreload(entry.isIntersecting),
      { root: null, rootMargin: '150% 0px 150% 0px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Mobile shows the three-card poker stack; desktop keeps the hover-fan deck.
  const isMobile = document.documentElement.getAttribute('data-device') === 'mobile';

  const worksItems = projectShowcases.map((project) => {
    const work = worksByCategory[project.category]?.[project.work];
    return { project, cover: work?.detailHero ?? work?.image };
  });

  // Mobile shows every real work (the placeholder Motion Space is excluded), so
  // the stack grows with the portfolio. Desktop keeps the curated 7-card set.
  const mobileWorksItems = Object.entries(worksByCategory).flatMap(([category, works]) =>
    works
      .filter((work) => work.id !== 'motion-space')
      .map((work) => ({
        project: { id: work.id, category, title: work.title, meta: work.subtitle },
        cover: work.detailHero ?? work.image
      }))
  );

  // Where the controller thinks it is. On a paged home the scroll position is
  // the only thing that can say: the browser may have restored one from an
  // earlier visit, and starting at 0 while the page sits on 3 would leave the
  // wheel and the view disagreeing for the rest of the session.
  const startIndexRef = useRef(null);
  if (startIndexRef.current === null) {
    // Always open a fresh page load on the hero (screen 0). The pager owns the
    // scroll position, so trusting window.scrollY here would let a browser-
    // restored offset (or an address-bar layout shift) become the starting
    // screen and get "aligned" to on mount — which read as the page opening
    // already scrolled down to the works showcase on phones. The component is
    // kept mounted (page-keep), so this branch only runs on the initial load;
    // returning from works/detail preserves the last index via state instead.
    startIndexRef.current = 0;
  }

  const [index, setIndex] = useState(startIndexRef.current);

  // The contact screen carries a WebGL ray burst. The same burst backs the
  // projects screen, and it lives in a viewport-fixed layer so a page turn
  // does not drag it along with the content.
  //
  // Two behaviours ride on top of that:
  //   * arriving on a lit screen should settle first, then fade the light in -
  //     switching straight on read as a hard pop;
  //   * scrolling back up out of a lit screen should let the light travel with
  //     the section it belongs to instead of being pinned to the viewport, so
  //     it slides away with the content.
  //
  // The sections are read as a list, not hard-coded by name: adding or
  // removing a lit screen here simply changes how far the shared burst
  // reaches.
  const [raysMounted, setRaysMounted] = useState(false);
  const raysLayerRef = useRef(null);
  const raysHitRef = useRef(false);
  const raysHideTimer = useRef(0);

  useEffect(() => {
    const RAYS_TEARDOWN_DELAY = 700;

    // Read as a list, and only from the live document, so a removed screen
    // simply shortens the list and the screens below keep the light and the
    // travel-on-the-way-up.
    // The contact screen is in here too - it used to own its own burst pinned
    // inside the section, which slid into view ahead of the content and stacked
    // on top of this one; one shared burst now covers the whole tail.
    const sections = () => [projectsRef.current, contactRef.current]
      .filter((el) => el && el.isConnected);

    const syncRays = () => {
      const elements = sections();
      if (!elements.length) return;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const rects = elements.map((element) => element.getBoundingClientRect());
      const hit = rects.some((rect) => rect.top < viewportHeight && rect.bottom > 0);

      // The uppermost lit section owns the offset. While it sits above the
      // viewport the offset clamps to 0 and the layer is pinned; once a scroll
      // back up pushes it down, the layer rides along with it.
      const lead = Math.min(...rects.map((rect) => rect.top));
      const follow = Math.max(0, Math.min(lead, viewportHeight));
      const layer = raysLayerRef.current;
      if (layer) layer.style.transform = `translate3d(0, ${Math.round(follow)}px, 0)`;

      if (hit === raysHitRef.current) return;
      raysHitRef.current = hit;
      window.clearTimeout(raysHideTimer.current);
      if (hit) {
        // Straight on, no settle delay and no fade: the layer rides in with the
        // section it belongs to, so the arrival is the content's own motion.
        setRaysMounted(true);
        if (layer) layer.classList.add('is-on');
      } else {
        if (layer) layer.classList.remove('is-on');
        // Keep the WebGL canvas alive through the dissolve so leaving a screen
        // is not a disappearance.
        raysHideTimer.current = window.setTimeout(() => setRaysMounted(false), RAYS_TEARDOWN_DELAY);
      }
    };

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        syncRays();
      });
    };

    syncRays();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(raysHideTimer.current);
    };
  }, []);

  // Unmounting always drops the lit class, so a remount cannot come back lit.
  useEffect(() => {
    if (raysMounted) return;
    const layer = raysLayerRef.current;
    if (layer) layer.classList.remove('is-on');
  }, [raysMounted]);

  // The first screen is already visible on the first paint. Later screens
  // reveal when their one-screen gesture arrives.
  const [hasEnteredPage, setHasEnteredPage] = useState(() => startIndexRef.current > 0);

  const indexRef = useRef(index);
  const lockedUntilRef = useRef(0);
  const scrollingRef = useRef(false);
  const reducedRef = useRef(false);

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
  const isLocked = () => performance.now() < lockedUntilRef.current;
  const lockFor = (ms) => { lockedUntilRef.current = performance.now() + ms; };

  const goToPage = (next, { instant = false } = {}) => {
    const clamped = Math.max(0, Math.min(HOME_PAGE_COUNT - 1, next));
    setHasEnteredPage(true);
    setIndex(clamped);
    const smooth = !instant && !reducedRef.current;
    if (smooth) {
      scrollingRef.current = true;
      window.setTimeout(() => { scrollingRef.current = false; }, 725);
    }
    window.scrollTo({ top: clamped * pageHeight(), behavior: smooth ? 'smooth' : 'auto' });
  };

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
      // whole-screen page flip. The same exemption covers the thumbnail strip:
      // it is an overflow-x scroller, and preventDefault() here would kill its
      // native horizontal pan. Page navigation still works from any touch that
      // begins outside the deck / strip (heading, dots, button, padding).
      deckGesture = !!(event.target && event.target.closest
        && (event.target.closest('.mob-deck') || event.target.closest('.mob-thumbs')));
      window.clearTimeout(touchEndTimer);
    };

    const onTouchMove = (event) => {
      if (deckGesture || !touchTracking || event.touches.length !== 1) return;
      event.preventDefault();
      if (touchConsumed || isLocked()) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.abs(deltaY) < HOME_TOUCH_THRESHOLD || Math.abs(deltaY) < Math.abs(deltaX)) return;
      touchConsumed = true;
      step(deltaY < 0 ? 1 : -1);
    };

    const onTouchEnd = () => {
      touchEndTimer = window.setTimeout(() => {
        touchTracking = false;
        touchConsumed = false;
        deckGesture = false;
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
  const profileVisible = paging ? hasEnteredPage && index === 1 : profileSeen;
  const projectsVisible = paging ? hasEnteredPage && index === 2 : projectsSeen;
  const contactVisible = paging ? hasEnteredPage && index === 3 : contactSeen;

  return (
    <>
      <div className="home-rays-layer" ref={raysLayerRef} aria-hidden="true">
        {raysMounted && (
          <SideRays
            className="home-rays"
            speed={2.5}
            rayColor1="#EAB308"
            rayColor2="#96c8ff"
            intensity={2}
            spread={2}
            origin="top-right"
            tilt={0}
            saturation={1.5}
            blend={0.75}
            falloff={1.6}
            opacity={1}
          />
        )}
      </div>

      <HeroSection active={active} onVideoReady={markHeroVideoReady} />

      <section ref={profileRef} className={`profile profile-shot motion-reveal-section${profileVisible ? ' is-visible' : ''}`} id="profile">
        {isMobile ? <ProfileContent /> : <ProfileContentPC />}
      </section>

      {/* The projects and contact screens sit on one continuous
          ground. The washes are painted once across all three instead of
          restarting at the top of each screen, so turning a page never reveals a
          fresh bright corner sliding in. */}
      <div className="home-ground">
      <section ref={projectsRef} className={`section projects motion-reveal-section${projectsVisible ? ' is-visible' : ''}`} id="projects">
        <div className="container">
          <div className="projects-heading">
            <h2 className="display-reveal-title rany-display-heading">SELECTED WORK</h2>
            <span className="display-reveal-subtitle">作品展示</span>
          </div>
        </div>
        <div className="project-list">
          {isMobile ? (
            <MobileShowcaseDeck items={mobileWorksItems} openWorks={openWorks} />
          ) : (
            <ShowcaseDeck items={worksItems} openWorks={openWorks} />
          )}
        </div>
      </section>

      <section ref={contactRef} className={`contact-page street-contact motion-reveal-section${contactVisible ? ' is-visible' : ''}`} id="contact">
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
          preload={active && heroVideoReady && contactPreload}
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

function WorksPage({ activeCategory, goDetail, workId = '', arriving = false }) {
  const works = worksByCategory[activeCategory.id] ?? [];
  const isMobile = isMobileDevice();
  const [activeIndex, setActiveIndex] = useState(() => {
    const i = works.findIndex((w) => w.id === workId);
    return i >= 0 ? i : 0;
  });
  const stageRef = useRef(null);
  const orbitRef = useRef(null);
  const railHoverRef = useRef(false);
  const timerRef = useRef(null);
  const index = works.length ? Math.min(activeIndex, works.length - 1) : 0;
  const current = works[index];

  const openDetail = (work) => {
    if (!work) return;
    // 2026-10-06 移动端:进详情改为「下滑翻页」,不再做卡片→hero 的图片 morph
    // (整页翻页动效取代之);PC 端保留原 morph。
    if (isMobile) {
      goDetail(activeCategory.id, work.id, null);
      return;
    }
    const image = document.querySelector(`[data-work-image="${work.id}"]`);
    const rect = image ? readNavRect(`[data-work-image="${work.id}"]`) : null;
    goDetail(activeCategory.id, work.id, {
      rect,
      radius: image ? readClippedRadius(image) : null,
      src: work.detailHero ?? work.image
    });
  };

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

  const step = (delta) => setActiveIndex((i) => (i + delta + works.length) % works.length);

  /* ---- 移动端单屏卡组手势(2026-10-06)----
     横滑 = 切换分类内项目(到位吸附,边缘有阻尼);下滑 = 进详情(整页翻页);
     点侧卡 = 切到该卡;点主卡 = 进详情。轴锁定:位移超过 10px 才判定主轴,
     之后本手势只沿主轴走。指针捕获挂在舞台上,用 elementFromPoint 还原
     点击命中的卡(pointer capture 会把 pointerup 重定向到舞台)。 */
  const trackRef = useRef(null);
  const mwDragRef = useRef({ down: false, axis: null, startX: 0, startY: 0, dx: 0, dy: 0, lastDX: 0, vel: 0, moved: false, pointerId: null });
  const mwIndexRef = useRef(index);
  mwIndexRef.current = index;
  const mwFirstPaintRef = useRef(true);

  const mwGeom = useCallback(() => {
    const stage = stageRef.current;
    const track = trackRef.current;
    const slide = track ? track.children[0] : null;
    if (!stage || !track || !slide) return null;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    // ⚠ 用布局尺寸 offsetWidth:getBoundingClientRect 会带上 .mw-slide 的
    // scale(0.94) —— 重挂载瞬间首卡是非当前态,量出来 273.4 而非 290.8,
    // 吸附基准整体偏 26px(探针实测 currentRect x=77.3,应为 51.1)。
    const slideW = slide.offsetWidth + gap;
    return { stageW: stage.clientWidth, slideW, cardW: slideW - gap };
  }, []);

  const mwApply = useCallback((dx, dy, animate) => {
    const track = trackRef.current;
    if (!track) return;
    const g = mwGeom();
    const base = g ? (g.stageW - g.cardW) / 2 - mwIndexRef.current * g.slideW : 0;
    track.style.transition = animate ? 'transform 560ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    track.style.transform = `translate3d(${base + dx}px, ${dy * 0.3}px, 0)`;
  }, [mwGeom]);

  useLayoutEffect(() => {
    if (!isMobile) return;
    mwApply(0, 0, !mwFirstPaintRef.current);
    mwFirstPaintRef.current = false;
  }, [index, works.length, isMobile, mwApply]);

  // ⚠ 首帧吸附可能跑在样式/字体就绪之前(--mw-card-* 还没生效,量出 auto 宽),
  //   之后没人再写 transform 就一直停在错位上(探针实测卡片偏出右缘 73px)。
  //   落定后按 80/300/700ms 各重吸一次 + 字体就绪 + resize,无过渡直接归位。
  useEffect(() => {
    if (!isMobile) return undefined;
    const reapply = () => mwApply(0, 0, false);
    const timers = [80, 300, 700].map((t) => window.setTimeout(reapply, t));
    if (document.fonts?.ready) document.fonts.ready.then(reapply).catch(() => {});
    window.addEventListener('resize', reapply);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', reapply);
    };
  }, [isMobile, mwApply, activeCategory.id, arriving]);

  const mwDown = (e) => {
    const d = mwDragRef.current;
    d.down = true; d.axis = null; d.moved = false;
    d.startX = e.clientX; d.startY = e.clientY;
    d.dx = 0; d.dy = 0; d.lastDX = 0; d.vel = 0; d.pointerId = e.pointerId;
    const stage = stageRef.current;
    if (stage?.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
  };
  const mwMove = (e) => {
    const d = mwDragRef.current;
    if (!d.down) return;
    const rawDx = e.clientX - d.startX;
    const rawDy = e.clientY - d.startY;
    if (!d.axis) {
      if (Math.abs(rawDx) < 10 && Math.abs(rawDy) < 10) return;
      d.axis = Math.abs(rawDx) > Math.abs(rawDy) ? 'x' : 'y';
    }
    if (d.axis === 'x') {
      let dx = rawDx;
      // 两端阻尼:第一张往右/最后一张往左,拖出 35% 手感
      if ((mwIndexRef.current === 0 && dx > 0) || (mwIndexRef.current === works.length - 1 && dx < 0)) dx *= 0.35;
      d.vel = dx - d.lastDX; d.lastDX = dx; d.dx = dx;
      if (Math.abs(dx) > 8) d.moved = true;
      mwApply(dx, 0, false);
    } else if (rawDy > 0) {
      d.dy = rawDy;
      if (rawDy > 8) d.moved = true;
      mwApply(0, rawDy, false);
    }
  };
  const mwUp = (e) => {
    const d = mwDragRef.current;
    if (!d.down) return;
    d.down = false;
    const stage = stageRef.current;
    if (stage?.releasePointerCapture) { try { stage.releasePointerCapture(d.pointerId); } catch (_) {} }
    if (!d.moved) {
      // 点击:命中侧卡 → 切到它;命中主卡 → 进详情
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slide = el ? el.closest('.mw-slide') : null;
      const idx = slide && trackRef.current ? Array.prototype.indexOf.call(trackRef.current.children, slide) : -1;
      if (idx >= 0 && idx !== mwIndexRef.current) setActiveIndex(idx);
      else openDetail(works[mwIndexRef.current]);
      return;
    }
    if (d.axis === 'x' && (Math.abs(d.dx) > 62 || Math.abs(d.vel) > 0.45)) {
      setActiveIndex((i) => Math.min(works.length - 1, Math.max(0, i + (d.dx < 0 ? 1 : -1))));
    } else if (d.axis === 'y' && d.dy > 72) {
      openDetail(works[mwIndexRef.current]);
    } else {
      mwApply(0, 0, true);
    }
    d.dx = 0; d.dy = 0; d.axis = null;
  };
  const mwCancel = () => {
    const d = mwDragRef.current;
    if (!d.down) return;
    d.down = false; d.dx = 0; d.dy = 0; d.axis = null;
    mwApply(0, 0, true);
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
    // 2026-10-06 单屏卡组:一屏展示、横滑切项目、下滑/点卡进详情。
    // 环境光(SideRays)保留;卡片 3:5 + 20px 圆角与首页卡组同形,
    // 首页点卡进来的放大动效(SharedImageTransition)落点即当前主卡。
    return (
      <section className={`works-index-page${arriving ? ' mw-is-arriving' : ''}`}>
        <SideRays
          className="works-side-rays"
          speed={2.5}
          rayColor1="#EAB308"
          rayColor2="#96c8ff"
          intensity={2}
          spread={2}
          origin="top-right"
          tilt={0}
          saturation={1.5}
          blend={0.75}
          falloff={1.6}
          opacity={1}
        />
        <div
          className="mw-stage"
          ref={stageRef}
          onPointerDown={mwDown}
          onPointerMove={mwMove}
          onPointerUp={mwUp}
          onPointerCancel={mwCancel}
        >
          <div className="mw-track" ref={trackRef}>
            {works.map((work, i) => (
              <div className={`mw-slide${i === index ? ' is-current' : ''}`} key={work.id}>
                <button
                  type="button"
                  className="mw-card"
                  aria-label={`${work.title} — 下滑或点按查看设计详情`}
                >
                  <LazyImage className="mw-card-img" data-work-image={work.id} src={work.detailHero ?? work.image} alt={work.title} />
                  <span className="mw-card-veil" aria-hidden="true" />
                  <span className="mw-card-copy" aria-hidden="true">
                    <strong>{work.title}</strong>
                    <b>{work.subtitle}</b>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="mw-hint" aria-label="下滑查看设计详情" onClick={() => openDetail(works[index])}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6.5l6 6 6-6" />
            <path d="M6 12.5l6 6 6-6" />
          </svg>
        </button>
      </section>
    );
  }

  return (
    <section className="works-index-page works-index-page--orbit">
      <SideRays
        className="works-side-rays"
        speed={2.5}
        rayColor1="#EAB308"
        rayColor2="#96c8ff"
        intensity={2}
        spread={2}
        origin="top-right"
        tilt={0}
        saturation={1.5}
        blend={0.75}
        falloff={1.6}
        opacity={1}
      />
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
                  <LazyImage data-work-image={current.id} src={current.detailHero ?? current.image} alt={current.title} />
                  <span className="works-orbit-peek"><span>OPEN PROJECT</span>{orbitArrow}</span>
                </div>
              </button>
            ) : null}
            </div>
            {current ? (
              <div className="works-orbit-floor" aria-hidden="true">
                {/* 真实 DOM 镜像:img 与卡片 cover 同宽高同 object-fit,
                    间距与卡片 1:1 对齐;超出地面的部分由 floor overflow 裁掉 */}
                <div className="works-orbit-floor-mirror">
                  <img className="works-orbit-floor-mirror-far" src={current.detailHero ?? current.image} alt="" />
                  <img className="works-orbit-floor-mirror-near" src={current.detailHero ?? current.image} alt="" />
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
            {works.map((work, i) => (
              <button
                key={work.id}
                type="button"
                className={`works-orbit-rail-card${i === index ? ' is-selected' : ''}`}
                aria-pressed={i === index}
                aria-label={`选择 ${work.title}`}
                style={{ '--i': i }}
                onPointerEnter={() => setActiveIndex(i)}
                onClick={() => setActiveIndex(i)}
              >
                <span className="works-orbit-clip" aria-hidden="true">
                  <span className="works-orbit-sheen" />
                  <span className="works-orbit-glow" />
                </span>
                <div className="works-orbit-cover"><img src={work.image} alt={work.subtitle} /></div>
                <div className="works-orbit-rail-copy">
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{work.title}</h3>
                    <p>{work.subtitle}</p>
                  </div>
                  <span className="works-orbit-rail-arrow">{orbitArrow}</span>
                </div>
              </button>
            ))}
          </div>
          </div>
        </div>

        {/* stage 底部信息行 + 页脚点缀（自 demo 移入，纯装饰） */}
        <div className="works-orbit-stage-meta">
          <div className="works-orbit-collection-label">
            <span className="works-orbit-dot" />
            <span>{activeCategory.cn}</span>
            <span className="works-orbit-divider">/</span>
            <span>{String(works.length).padStart(2, '0')} PROJECTS</span>
          </div>
          <span className="works-orbit-hint">HOVER TO FOCUS<span className="works-orbit-hint-line" /></span>
        </div>
        <footer className="works-orbit-footer">
          <span>移入右侧索引切换作品，移入主卡探索光与视角。方向键同样可切换。</span>
          <span className="works-orbit-footer-right">
            16:9 <span className="works-orbit-divider">/</span> SINGLE SCREEN
            <span className="works-orbit-version-tag">V2.0.0</span>
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
        <div className="detail-scroll" key={scroll.slug}>
          {scroll.tiles.map((tile, index) => (
            <ScrollTile
              key={tile.i}
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

function WorkDetailPage({ activeCategory, work, imageTransitionActive = false, flip = '', onSwipeProject = null }) {
  const pageRef = useRef(null);
  const swipeRef = useRef({ down: false, startX: 0, dx: 0, lastDX: 0, vel: 0, moved: false });

  // 内滚归位:每次切换作品(Last/Next、分类下拉、二级页进入)都回到顶部。
  // ⚠ 返回翻页期间组件**不重挂**、work.id 不变,这个 effect 不会跑 ——
  // 用户停在 50% 的滚动位置得以保持,上滑翻页直接在原地执行(业主明确要求)。
  useEffect(() => {
    const el = pageRef.current;
    if (el) el.scrollTop = 0;
  }, [work?.id]);

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
      <div className="detail-hero">
        <LazyImage className={imageTransitionActive ? 'is-transitioning' : ''} data-detail-hero-image="true" src={work.detailHero} alt={work.title} />
        {work.detailOverlay && (
          <div className="detail-hero-copy" aria-label={`${work.detailOverlay.title} project information`}>
            <div className="detail-hero-main">
              <h1>{work.detailOverlay.title}</h1>
              <p>{work.detailOverlay.project}</p>
              <span>{work.detailOverlay.slogan}</span>
            </div>
            <div className="detail-hero-meta">
              <div>
                <b>{work.detailOverlay.styleTitle}</b>
                <span>{work.detailOverlay.styleText}</span>
              </div>
              <div>
                <b>{work.detailOverlay.toolTitle}</b>
                <span>{work.detailOverlay.toolText}</span>
              </div>
            </div>
            <div className="detail-hero-footer">
              <span>{work.detailOverlay.footerLeft}</span>
              <span>{work.detailOverlay.footerRight}</span>
            </div>
          </div>
        )}
      </div>
      <div className="detail-content">
        <div className="detail-title">
          <span>{activeCategory.label}</span>
          <h1>{work.title}</h1>
          <p>{work.subtitle}</p>
        </div>
        <DetailScroll workId={work.id} fallbackImages={detailImages} />
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);




