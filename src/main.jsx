import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Copy, House, Mail, Phone } from 'lucide-react';
import './styles.css';
import './mobile.css';
import fourLogo from './assets/four-logo.svg';
import group10Markup from './assets/group-10.svg?raw';
import { createWebCodecsPlayer } from './heroWebCodecs';

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
    return { page: 'works', category: params.get('category') ?? 'ui', workId: '' };
  }
  return { page: 'home', category: 'ui', workId: '' };
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
      startTracking();
    } else {
      startTracking();
    }
    const handleResize = () => startTracking(900);
    const handleScroll = () => startTracking(900);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, { passive: true });
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

  const restoreScroll = (key, fallback) => {
    const saved = Number(window.sessionStorage.getItem(key) ?? fallback);
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo(0, saved)));
  };

  const goHome = () => {
    setNavMotion('');
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

  const goWorks = (category = route.category, restore = false) => {
    if (route.page === 'home') {
      setNavMotion('home-to-works');
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
    window.location.hash = `/works?category=${category}`;
    setRoute({ page: 'works', category, workId: '' });
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
    if (transitionImage?.rect && transitionImage?.src) {
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
            {route.page === 'works' ? (
              <WorksPage activeCategory={activeCategory} goDetail={goDetail} />
            ) : route.page === 'detail' ? (
              <WorkDetailPage activeCategory={activeCategory} work={activeWork} imageTransitionActive={Boolean(sharedImage && sharedImage.workId === activeWork?.id)} />
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
  return {
    x: rect.left,
    y: rect.top,
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
          {/* Mobile: the four text links are folded away entirely; this burger
              is the only nav affordance. The lines morph into an X while the
              fullscreen panel fades in underneath the bar. */}
          <button
            type="button"
            className={`mobile-menu-toggle${mobileMenuOpen ? ' is-open' : ''}`}
            aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu-panel"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <line className="hm-line hm-top" x1="6" y1="10.5" x2="26" y2="10.5" />
              <line className="hm-line hm-mid" x1="6" y1="16" x2="26" y2="16" />
              <line className="hm-line hm-bot" x1="6" y1="21.5" x2="26" y2="21.5" />
            </svg>
          </button>
          {/* The panel portals to <body>: .morph-nav has transform + contain:paint,
              which would trap a fixed-position child inside the 78px bar. */}
          {createPortal(
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
        </>
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
      {isHome ? null : isDetail ? (
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
        <button type="button" className="morph-home-pill" onClick={goHome}><House size={15} strokeWidth={2} />Home</button>
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
  const SIDE_OFFSET = 72;
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
        if (item) ctxRef.current.openWorks(item.project.category);
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
  return <img ref={ref} className={className} alt={alt} {...rest} />;
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
function ProfileContent() {
  const [activeStat, setActiveStat] = useState(null);
  const [activeSkill, setActiveSkill] = useState(null);

  const toggleStat = (id) => {
    setActiveStat((prev) => (prev === id ? null : id));
    setActiveSkill(null);
  };

  const toggleSkill = (id) => {
    setActiveSkill((prev) => (prev === id ? null : id));
    setActiveStat(null);
  };

  const activeStatData = activeStat ? PC_STATS.find((s) => s.id === activeStat) : null;
  const activeSkillData = activeSkill ? PC_SKILLS.find((s) => s.id === activeSkill) : null;

  return (
    <div className="profile-shot-inner">
      <LazyImage className="mob-profile-bg" src={pcPortraitBg} alt="" />
      <div className="mob-profile-info">
        <h2 className="mob-profile-title">
          <span className="mob-profile-title-en rany-display-heading">Hi， I Am Four</span>
          <span className="mob-profile-title-cn">邱锋江</span>
        </h2>

        <div className="mob-profile-contact">
          <CopyContactLine icon={Phone} label="手机号" value="18219315597" />
          <CopyContactLine icon={Mail} label="邮箱" value="Four4444.Design@gmail.com" />
        </div>

        <div className="mob-profile-stats">
          {PC_STATS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`mob-profile-stat${activeStat === s.id ? ' is-active' : ''}`}
              onClick={() => toggleStat(s.id)}
              aria-pressed={activeStat === s.id}
            >
              <strong>{s.value}</strong>
              <span className="mob-profile-stat-label">{s.label}</span>
            </button>
          ))}
        </div>

        <div className={`mob-profile-exp-card${activeStat ? ' is-visible' : ''}`} aria-live="polite">
          {activeStatData && (
            <div className="mob-profile-card-body" key={activeStatData.id}>
              <p>{activeStatData.text}</p>
            </div>
          )}
        </div>

        <div className="mob-profile-skills">
          {PC_SKILLS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`mob-profile-skill${activeSkill === s.id ? ' is-active' : ''}`}
              onClick={() => toggleSkill(s.id)}
              aria-pressed={activeSkill === s.id}
            >
              <LazyImage className="mob-profile-skill-icon" src={s.icon} alt={s.name} />
              <span className="mob-profile-skill-name">{s.name}</span>
            </button>
          ))}
        </div>

        <div className={`mob-profile-skill-card${activeSkill ? ' is-visible' : ''}`} aria-live="polite">
          {activeSkillData && (
            <div className="mob-profile-card-body" key={activeSkillData.id}>
              <p className="mob-profile-card-title">{activeSkillData.title}</p>
              <p>{activeSkillData.text}</p>
            </div>
          )}
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
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    return () => clearTimeout(timerRef.current);
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
    }, 2600);
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
      const lift = MAX * Math.exp(-(dist / R) ** 2);
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
    const ZONE_PAD = 12;
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
      // 坐标完全未变 = 布局位移补发的事件(光标没动):拦掉,既不偷选也不误判移出。
      if (lastX !== null && e.clientX === lastX && e.clientY === lastY) return;
      lastX = e.clientX;
      lastY = e.clientY;
      const intent = buttonIntent(e.target);
      // 命中即生效:零阈值,切换不同卡片无延迟。
      if (intent) { applyIntent(intent); return; }
      if (!hoverRef.current || !zone) return;
      const r = zone.getBoundingClientRect();
      const outside = e.clientX < r.left - ZONE_PAD || e.clientX > r.right + ZONE_PAD
        || e.clientY < r.top - ZONE_PAD || e.clientY > r.bottom + ZONE_PAD;
      // 移出立即复位,不加任何锁定/延迟。
      if (outside) {
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

function HeroSection({ active = true }) {
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
    const checkForStall = () => {
      if (disposed) return;
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

    if (!active) {
      // The home layer is kept mounted but hidden while another page is open.
      // Pause the clocks and drop the frame pairing so the decoder and the
      // stall watchdog stop; the watchdog would otherwise read the pause as a
      // stall and restart playback nobody can see.
      try { base.pause(); } catch {}
      try { alpha.pause(); } catch {}
      cancelVideoFrameCallbacks();
    } else if (typeof base.requestVideoFrameCallback === 'function' && typeof alpha.requestVideoFrameCallback === 'function') {
      startBothVideoFrameCallbacks();
    } else {
      fallbackRaf = window.requestAnimationFrame(fallbackTick);
    }
    if (active) {
      safePlay(base);
      safePlay(alpha);
      stallTimer = window.setTimeout(checkForStall, STALL_CHECK_MS);
    }

    return () => {
      disposed = true;
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
  const [projectsRef, projectsSeen] = useRevealOnView();
  const [contactRef, contactSeen] = useRevealOnView({ threshold: 0.16 });

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

      <HeroSection active={active} />

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

      <section ref={contactRef} className={`contact-page motion-reveal-section${contactVisible ? ' is-visible' : ''}`} id="contact">
        <div className="container">
          <Reveal as="div" className="contact-head" threshold={0.14} rootMargin="0px 0px -8% 0px">
            <p className="section-kicker display-reveal-title rany-display-heading">CONTACT</p>
            <h2 className="display-reveal-subtitle">联系合作</h2>
          </Reveal>
          <Reveal as="p" className="contact-sentence" threshold={0.14} rootMargin="0px 0px -8% 0px">从像素到多边形，从代码到创意<br />设计是一种看得见的思考</Reveal>
          <Reveal as="div" className="contact-actions" threshold={0.14} rootMargin="0px 0px -8% 0px">
            <a className="contact-mail" href="mailto:Four4444.Design@gmail.com"><Mail size={17} strokeWidth={1.8} />发送邮件</a>
            <a className="contact-phone" href="tel:18219315597"><Phone size={15} strokeWidth={1.8} />18219315597</a>
          </Reveal>
          <Reveal as="div" className="contact-bottom" threshold={0.14} rootMargin="0px 0px -8% 0px"><span>FOUR / Personal website</span><span>Thank you for watching</span></Reveal>
        </div>
      </section>
      </div>

    </>
  );
}

function WorksPage({ activeCategory, goDetail }) {
  const works = worksByCategory[activeCategory.id] ?? [];
  const openDetail = (work) => {
    const image = document.querySelector(`[data-work-image="${work.id}"]`);
    const rect = image ? readNavRect(`[data-work-image="${work.id}"]`) : null;
    goDetail(activeCategory.id, work.id, {
      rect,
      radius: image ? readClippedRadius(image) : null,
      src: work.detailHero ?? work.image
    });
  };

  return (
    <section className="works-index-page">
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
      <div className="works-container">
        <div className="works-title-row">
          <div className="works-title-block">
            <h1>{activeCategory.title}</h1>
          </div>
          <p className="works-intro">在数字产品层出不穷的今天，{activeCategory.title} 是连接用户与技术的最后一道桥梁，在纷繁复杂的数字世界中，为用户带来清晰、愉悦且富有温度的浏览体验。</p>
        </div>
        <div className="works-divider" />
        <div className="works-showcase-list">
          {works.map((work) => (
            <article className="showcase-item" key={work.id}>
              <button className="showcase-main-img" type="button" onClick={() => openDetail(work)}>
                <LazyImage data-work-image={work.id} src={work.detailHero ?? work.image} alt={work.title} />
              </button>
              <div className="showcase-copy">
                <h2>{work.title}</h2>
                <p>{work.subtitle}</p>
                <button type="button" onClick={() => openDetail(work)}>查看设计详情</button>
              </div>
            </article>
          ))}
        </div>
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

function WorkDetailPage({ activeCategory, work, imageTransitionActive = false }) {
  if (!work) return null;

  const detailImages = work.detailImages ?? [
    { id: `${work.id}-fallback-01`, src: work.detailHero, title: `${work.title} detail visual 01` },
    { id: `${work.id}-fallback-02`, src: work.detailHero, title: `${work.title} detail visual 02` },
    { id: `${work.id}-fallback-03`, src: work.detailHero, title: `${work.title} detail visual 03` },
    { id: `${work.id}-fallback-04`, src: work.detailHero, title: `${work.title} detail visual 04` }
  ];

  return (
    <section className="work-detail-page">
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




