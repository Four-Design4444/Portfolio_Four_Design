import { useRef, useEffect, useState } from 'react';
import { Renderer, Program, Triangle, Mesh } from 'ogl';
import './SideRays.css';

const hexToRgb = (hex) => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255] : [1, 1, 1];
};

const originToFlip = (origin) => {
  switch (origin) {
    case 'top-left': return [1, 0];
    case 'bottom-right': return [0, 1];
    case 'bottom-left': return [1, 1];
    default: return [0, 0];
  }
};

/* 逐级向上判断是否真的被渲染。display:none 或 visibility:hidden 的祖先会让整棵
   子树不绘制,但 IntersectionObserver 依然报告 isIntersecting —— 容器仍在布局流里、
   rect 正常,observer 看不到"人看不见"这件事。
   ⚠ 这可能造成的空转(2026-10-07 实测):移动端进三级详情页后,二级页作为
     `.mw-under.is-covered`(visibility:hidden)保持挂载,其 SideRays 的 rAF 里照样
     每帧跑一次全屏片元着色器 —— 用户看不到却持续 30fps 吃 GPU。渲染循环靠它真正暂停。 */
const isRendered = (el) => {
  let node = el;
  while (node && node !== document.documentElement) {
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
};

function SideRays({
  speed = 2.5,
  rayColor1 = '#EAB308',
  rayColor2 = '#96c8ff',
  intensity = 2,
  spread = 2,
  origin = 'top-right',
  tilt = 0,
  saturation = 1.5,
  blend = 0.75,
  falloff = 1.6,
  opacity = 1,
  className = '',
  /* 页面级点亮开关(2026-10-07 统一环境光):环境光现在是 App 层**单例**,
     跨一级/二级复用同一个 WebGL 实例。路由不点亮它时(如详情页)传 false,
     渲染循环直接跳过 —— 保上下文但不空转,重新点亮当帧即续,无重建闪烁。 */
  active = true
}) {
  const containerRef = useRef(null);
  const uniformsRef = useRef(null);
  const rendererRef = useRef(null);
  const animationIdRef = useRef(null);
  const meshRef = useRef(null);
  const cleanupFunctionRef = useRef(null);
  const observerRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const checkVisibility = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setIsVisible(rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth);
    };

    observerRef.current = new IntersectionObserver(
      (entries) => setIsVisible(entries[0].isIntersecting),
      { threshold: 0.1 }
    );
    observerRef.current.observe(containerRef.current);
    checkVisibility();
    const frame = requestAnimationFrame(checkVisibility);

    return () => {
      cancelAnimationFrame(frame);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !containerRef.current) return undefined;

    if (cleanupFunctionRef.current) {
      cleanupFunctionRef.current();
      cleanupFunctionRef.current = null;
    }

    const initializeWebGL = async () => {
      if (!containerRef.current) return;

      await new Promise((resolve) => setTimeout(resolve, 10));
      if (!containerRef.current) return;

      // 全平台限 30fps：背景光线是慢效果，30fps 视觉无差，却能砍掉约一半 GPU
      // 预算；移动端 dpr 上限再从 2 降到 1.5，全屏片元着色器像素量再减约 44%。
      const isMobile = document.documentElement.dataset.device === 'mobile';
      const maxDpr = isMobile ? 1.5 : 2;
      const frameInterval = 33; // ms；30fps。iTime 用真实时间推进，动画速度不变

      const renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio, maxDpr),
        alpha: true
      });
      rendererRef.current = renderer;

      const gl = renderer.gl;
      gl.canvas.style.width = '100%';
      gl.canvas.style.height = '100%';

      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }
      containerRef.current.appendChild(gl.canvas);

      const vert = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

      const frag = `precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;

  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

  float halfSpread = iSpread * 0.275;
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));

  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);

  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;

  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;

  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);

  color.a = max(color.r, max(color.g, color.b)) * iOpacity;
  gl_FragColor = color;
}`;

      const [flipX, flipY] = originToFlip(origin);
      const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: [1, 1] },
        iSpeed: { value: speed },
        iRayColor1: { value: hexToRgb(rayColor1) },
        iRayColor2: { value: hexToRgb(rayColor2) },
        iIntensity: { value: intensity },
        iSpread: { value: spread },
        iFlipX: { value: flipX },
        iFlipY: { value: flipY },
        iTilt: { value: tilt },
        iSaturation: { value: saturation },
        iBlend: { value: blend },
        iFalloff: { value: falloff },
        iOpacity: { value: opacity }
      };
      uniformsRef.current = uniforms;

      const geometry = new Triangle(gl);
      const program = new Program(gl, { vertex: vert, fragment: frag, uniforms });
      const mesh = new Mesh(gl, { geometry, program });
      meshRef.current = mesh;

      const updateSize = () => {
        if (!containerRef.current || !renderer) return;
        renderer.dpr = Math.min(window.devicePixelRatio, maxDpr);
        const { clientWidth: w, clientHeight: h } = containerRef.current;
        renderer.setSize(w, h);
        uniforms.iResolution.value = [w * renderer.dpr, h * renderer.dpr];
      };

      let lastRender = 0;
      /* 遮挡判定(2026-10-10 改):原来靠"每 200ms 逐级 getComputedStyle 复查"。
         问题在于转场那 1 秒里页面正处于不断被写样式的状态,任何一次这种复查都会
         把浏览器拽去做一趟**同步布局 + 样式重算**(未压缩构建的 trace 里能看到
         isRendered ← loop 的布局栈落在跨级转场窗口内,一次转场 3 次),而这是
         常年每秒 5 次的固定税。遮挡只可能因为**页面级切换**发生 —— 也就是祖先的
         class/style 被改 —— 所以改成事件驱动:在容器到 <html> 这条祖先链上挂一个
         MutationObserver(只盯 class/style/hidden,不盯子树,所以不会被卡片逐帧
         写内联样式惊动),祖先一变立刻复查,比原来的 200ms 更及时。
         再留 2000ms 兜底,防止有观察不到的隐藏方式(最坏多渲不到 2 秒)。 */
      const VIS_OPTS = { attributes: true, attributeFilter: ['class', 'style', 'hidden'] };
      const ancestorChain = () => {
        const list = [];
        let node = containerRef.current;
        while (node && node !== document.documentElement) { list.push(node); node = node.parentElement; }
        return list;
      };
      let visDirty = true;
      let visObserver = null;
      if (typeof MutationObserver === 'function') {
        visObserver = new MutationObserver(() => { visDirty = true; });
        ancestorChain().forEach((node) => visObserver.observe(node, VIS_OPTS));
      }
      const VIS_FALLBACK_MS = 2000;
      /* 复查速率下限:事件驱动是"一变就查",万一哪天有人给祖先链逐帧写内联样式,
         就会退化成每帧一次强制布局。加一道 120ms 下限把它锁死(仍比原来的
         200ms 周期更快,只是不允许更密)。 */
      const VIS_MIN_MS = 120;
      let lastVisCheck = -Infinity;
      let rendered = true;   // 本帧是否真的该渲染（由复查更新）
      const loop = (time) => {
        if (!rendererRef.current || !uniformsRef.current || !meshRef.current) return;
        // 先排下一帧：即便本帧跳过重绘，循环也不中断（保 WebGL 上下文 / shader），
        // 也才能靠后续帧把"重新可见"检测回来。
        animationIdRef.current = requestAnimationFrame(loop);
        // 路由不点亮时（如详情页）不渲染，但循环不退出 —— 重新点亮当帧即续。
        if (!activeRef.current) return;
        // 标签页不可见时完全停渲，避免后台空转吃 CPU/GPU。
        if (document.hidden) return;
        // 容器被祖先 display:none / visibility:hidden 遮住时同样停渲：
        // IntersectionObserver 对这种"仍在布局流、rect 正常"的隐藏判不出来，
        // 移动端三级页下二级页(.mw-under.is-covered)会因此空转全屏着色。
        const byFallback = time - lastVisCheck >= VIS_FALLBACK_MS;
        if ((visDirty && time - lastVisCheck >= VIS_MIN_MS) || byFallback) {
          lastVisCheck = time;
          visDirty = false;
          rendered = isRendered(containerRef.current);
          /* 只有兜底那一趟才重挂观察:容器可能被 React 挪到了别处,祖先链会变。 */
          if (visObserver && byFallback) {
            visObserver.disconnect();
            ancestorChain().forEach((node) => visObserver.observe(node, VIS_OPTS));
          }
        }
        if (!rendered) return;
        // 移动端按 frameInterval 节流：iTime 用真实时间推进，动画速度不变。
        if (frameInterval && time - lastRender < frameInterval) return;
        lastRender = time;
        uniforms.iTime.value = time * 0.001;
        try {
          renderer.render({ scene: mesh });
        } catch (error) {
          // WebGL contexts can be lost when the page is hidden.
        }
      };

      window.addEventListener('resize', updateSize);
      updateSize();
      animationIdRef.current = requestAnimationFrame(loop);

      cleanupFunctionRef.current = () => {
        if (animationIdRef.current) {
          cancelAnimationFrame(animationIdRef.current);
          animationIdRef.current = null;
        }
        if (visObserver) {
          visObserver.disconnect();
          visObserver = null;
        }
        window.removeEventListener('resize', updateSize);
        if (renderer) {
          try {
            const loseContext = renderer.gl.getExtension('WEBGL_lose_context');
            if (loseContext) loseContext.loseContext();
            const canvas = renderer.gl.canvas;
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
          } catch (error) {
            // Ignore cleanup errors.
          }
        }
        rendererRef.current = null;
        uniformsRef.current = null;
        meshRef.current = null;
      };
    };

    initializeWebGL();

    return () => {
      if (cleanupFunctionRef.current) {
        cleanupFunctionRef.current();
        cleanupFunctionRef.current = null;
      }
    };
  }, [isVisible, speed, rayColor1, rayColor2, intensity, spread, origin, tilt, saturation, blend, falloff, opacity]);

  useEffect(() => {
    if (!uniformsRef.current) return;
    const uniforms = uniformsRef.current;
    uniforms.iSpeed.value = speed;
    uniforms.iRayColor1.value = hexToRgb(rayColor1);
    uniforms.iRayColor2.value = hexToRgb(rayColor2);
    uniforms.iIntensity.value = intensity;
    uniforms.iSpread.value = spread;
    const [flipX, flipY] = originToFlip(origin);
    uniforms.iFlipX.value = flipX;
    uniforms.iFlipY.value = flipY;
    uniforms.iTilt.value = tilt;
    uniforms.iSaturation.value = saturation;
    uniforms.iBlend.value = blend;
    uniforms.iFalloff.value = falloff;
    uniforms.iOpacity.value = opacity;
  }, [speed, rayColor1, rayColor2, intensity, spread, origin, tilt, saturation, blend, falloff, opacity]);

  return <div ref={containerRef} className={`side-rays-container ${className}`.trim()} />;
}

export default SideRays;
