// Ported from the 联系我们demo v2.03 (src/main.js). Everything the demo does is
// kept as-is; the mechanical differences are all integration glue:
//  - the demo travelled on window scroll; here the home pager owns the window,
//    so the 5-chapter journey is driven by a virtual progress value fed from
//    wheel/touch gestures captured inside the street screen (boundaries are
//    released back to the pager so leaving the screen still works),
//  - all queries/sizing are scoped to the street root instead of the document,
//  - the demo's body scroll-lock in select()/close() is dropped (the home
//    pager owns the window) and close() restores the virtual progress instead,
//  - init/dispose happens through mountStreet() so React owns the lifecycle.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { createWorld, LANDMARKS } from './world.js';
import { initUI } from './street-ui.js';

// The demo scrolled over a 500vh #journey spacer, i.e. 400vh of travel.
const JOURNEY_SCREENFULS = 4;
const PAGER_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Spacebar', 'Home', 'End']);
const demoDefaults = { studioName: 'Four Design', phone: '18219315597', email: 'Four4444.Design@gmail.com', intro: '我们把细微的观察，变成有温度的设计。从品牌的性格，到数字体验的细节，认真对待每一次相遇。', services: ['品牌设计', '数字体验', '视觉叙事'] };

export async function mountStreet(root) {
  const $ = selector => root.querySelector(selector);
  const mobile = () => innerWidth <= 700;
  let disposed = false;

  const state = { mode: 'overview', ready: false, frameMs: 0, drawCalls: 0, triangles: 0 };
  Object.defineProperty(window, '__four', { value: state, writable: false, configurable: true });

  let mode = 'overview', reduced = matchMedia('(prefers-reduced-motion: reduce)').matches, rain = true, quality = 'auto';
  let world, renderer, composer, bloom, fxaa, camera, scene, ui, raf = 0, running = false;
  let clockTime = 0, lastFrame = 0, introStart = 0, focusStart = 0;
  let vProgress = 0, screenActive = false, pageVisible = !document.hidden;
  const pointer = { x: 0, y: 0 };
  let dragYaw = 0, dragPitch = 0, detailYaw = 0, detailPitch = 0, dragging = false, down = null, hovered = null;
  let pendingSingle = 0, focusTransition = false, focusWallStart = 0;
  const focusFromPosition = new THREE.Vector3(), focusFromTarget = new THREE.Vector3();
  const currentTarget = new THREE.Vector3(-.5, 1.15, 0), desiredPosition = new THREE.Vector3(), desiredTarget = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), offset = new THREE.Vector3();
  const mouse = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  let audio, lastMobile = mobile(), renderDiagnostics;
  const renderQuery = new URLSearchParams(location.search);
  const probeRendering = renderQuery.has('renderProbe');
  const probeBloom = probeRendering ? renderQuery.get('probeBloom') : null;
  const probeDpr = probeRendering ? Number(renderQuery.get('probeDpr')) : 0;

  // ---- integration glue: virtual journey --------------------------------
  // The pager listens on window (bubble), so consuming an event down here
  // keeps it from flipping pages; releasing at a journey boundary hands the
  // gesture back so the user can still leave the screen.
  const journeyPixels = () => Math.max(1, root.clientHeight) * JOURNEY_SCREENFULS;
  function applyProgress(p) {
    vProgress = THREE.MathUtils.clamp(p, 0, 1);
    dragYaw *= .92; dragPitch *= .92;
    ui?.setChapter(Math.round(vProgress * 4));
    ui?.setProgress(vProgress);
  }
  function onWheel(event) {
    if (mode !== 'overview') { event.stopPropagation(); return; } // the detail panel scrolls itself
    const delta = event.deltaY;
    if ((delta > 0 && vProgress < 1) || (delta < 0 && vProgress > 0)) {
      event.preventDefault(); event.stopPropagation();
      applyProgress(vProgress + delta / journeyPixels());
    }
  }
  let touchX = 0, touchY = 0, touchOwned = false;
  function onTouchStart(event) {
    if (event.touches.length !== 1) return;
    touchX = event.touches[0].clientX; touchY = event.touches[0].clientY; touchOwned = false;
  }
  function onTouchMove(event) {
    if (mode !== 'overview') { event.stopPropagation(); return; }
    if (event.touches.length !== 1) return;
    const x = event.touches[0].clientX, y = event.touches[0].clientY;
    const delta = touchY - y;
    if (!touchOwned) {
      if (Math.abs(delta) < 12 || Math.abs(delta) < Math.abs(x - touchX)) return;
      if ((delta > 0 && vProgress >= 1) || (delta < 0 && vProgress <= 0)) return; // hand the gesture to the pager
      touchOwned = true;
    }
    event.preventDefault(); event.stopPropagation();
    touchX = x; touchY = y;
    applyProgress(vProgress + delta / journeyPixels());
  }
  // Keep the pager off the keyboard while a detail panel is open.
  function onKeyGuard(event) { if (mode !== 'overview' && PAGER_KEYS.has(event.key)) event.stopPropagation(); }

  function select(next) {
    if (!['studio', 'phone', 'mail'].includes(next)) return;
    clearTimeout(pendingSingle); pendingSingle = 0; detailYaw = 0; detailPitch = 0;
    if (camera) { focusFromPosition.copy(camera.position); focusFromTarget.copy(currentTarget); focusTransition = true; focusWallStart = performance.now(); }
    mode = next; state.mode = next; focusStart = clockTime; world?.setMode(next); ui.setMode(next); $('#hover-label').style.opacity = 0;
  }
  function close() {
    if (mode === 'overview') return;
    clearTimeout(pendingSingle); pendingSingle = 0; down = null; dragging = false; detailYaw = 0; detailPitch = 0;
    focusTransition = false;
    mode = 'overview'; state.mode = mode; world?.setMode(mode); ui.setMode(mode); ui.setProgress(vProgress);
  }
  function setQuality(next) {
    quality = next; if (!renderer) return;
    const low = next === 'low' || (next === 'auto' && mobile());
    renderer.setPixelRatio(probeDpr > 0 ? THREE.MathUtils.clamp(probeDpr, .5, 2) : low ? Math.min(devicePixelRatio, 1.1) : Math.min(Math.max(devicePixelRatio, 1.5), 2));
    renderer.toneMappingExposure = mobile() ? 1.42 : 1.30;
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      // 保留空间超采样与 FXAA；HDR 缓冲及默认画布均不启用 MSAA。
    }
    if (bloom) bloom.enabled = probeBloom === 'off' ? false : probeBloom === 'stock' || probeBloom === 'preserve' ? true : !low;
    world?.setQuality(next); resize();
  }
  function preserveBloomAlpha(pass) {
    // r186 仅滤波 RGB，再以 max(RGB) 重建 alpha；保留场景覆盖率，不再把辉光亮度加进 alpha。
    const material = pass.blendMaterial;
    material.blending = THREE.CustomBlending;
    material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
    // 透明区不能只留 RGB 不留 alpha；以目标覆盖率约束辉光，零 alpha 区不加光。
    material.blendSrc = THREE.DstAlphaFactor; material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.ZeroFactor; material.blendDstAlpha = THREE.OneFactor;
    // 实测局部 NaN/Inf 会经多级模糊污染全帧；在第一次降采样高通入口截断传播。
    pass.materialHighPassFilter.fragmentShader = pass.materialHighPassFilter.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv );\n if ( !all(lessThanEqual(abs(texel), vec4(65504.0))) ) { gl_FragColor = vec4(0.0); return; }');
  }
  function createRenderDiagnostics(renderPass, outputPass) {
    // 仅 query 诊断启用同步回读；所有阶段都来自同一次 composer.render，而不是后续 rAF。
    const width = 48, height = 36, target = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false });
    const sampler = new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: FXAAShader.vertexShader,
      fragmentShader: 'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){gl_FragColor=texture2D(tDiffuse,vUv);}' });
    sampler.material.blending = THREE.NoBlending; sampler.material.toneMapped = false;
    const pixels = new Float32Array(width * height * 4), gl = renderer.getContext();
    let screenPixels, active = null, previous = null, sequence = 0;
    const frames = new Array(3600), anomalies = [];
    state.renderProbe = { frames, anomalies, capacity: frames.length, total: 0, grid: [width, height], regionOrder: '从左下到右上，4列3行', context: gl.getContextAttributes() };
    function summarize(data, w, h, scale) {
      const regions = Array.from({ length: 12 }, () => ({ luma: 0, alpha: 0, covered: 0, maxAlpha: 0, overAlpha: 0, rgbOverAlpha: 0, nonFinite: 0, count: 0 }));
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = (Math.min(h - 1, Math.floor((y + .5) * h / height)) * w + Math.min(w - 1, Math.floor((x + .5) * w / width))) * 4;
        const r = data[index] / scale, g = data[index + 1] / scale, b = data[index + 2] / scale, a = data[index + 3] / scale;
        const region = regions[Math.floor(y / 12) * 4 + Math.floor(x / 12)];
        if (!Number.isFinite(r + g + b + a)) { region.nonFinite++; region.count++; continue; }
        region.luma += r * .2126 + g * .7152 + b * .0722; region.alpha += a; region.covered += a > 8 / 255 ? 1 : 0;
        region.maxAlpha = Math.max(region.maxAlpha, a); region.overAlpha += a > 1.001 ? 1 : 0; region.rgbOverAlpha += Math.max(r, g, b) > a + 2 / 255 ? 1 : 0; region.count++;
      }
      for (const r of regions) { r.luma /= r.count; r.alpha /= r.count; r.covered /= r.count; }
      return { regions, luma: regions.reduce((s, r) => s + r.luma, 0) / 12, alpha: regions.reduce((s, r) => s + r.alpha, 0) / 12 };
    }
    function readStage(name, buffer) {
      if (!active) return;
      const saved = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
      try { sampler.render(renderer, target, buffer); renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels); active[name] = summarize(pixels, width, height, 1); }
      finally { renderer.setRenderTarget(saved, face, level); }
    }
    for (const [pass, name, bufferName] of [[renderPass, 'scene', 'read'], [bloom, 'bloom', 'read'], [outputPass, 'output', 'write']]) {
      const original = pass.render;
      pass.render = function (r, write, read, ...args) { original.call(this, r, write, read, ...args); readStage(name, bufferName === 'read' ? read : write); };
    }
    return {
      begin(now) { active = { id: ++sequence, at: now, mode, position: camera.position.toArray(), bloomEnabled: bloom.enabled }; },
      end() {
        const c = renderer.domElement; if (!screenPixels || screenPixels.length !== c.width * c.height * 4) screenPixels = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, screenPixels);
        active.screen = summarize(screenPixels, c.width, c.height, 255); active.error = gl.getError(); active.contextLost = gl.isContextLost();
        active.alphaAdded = active.bloom ? active.bloom.alpha - active.scene.alpha : 0;
        active.widespreadLuma = 0; active.widespreadAlpha = 0;
        if (previous) for (let i = 0; i < 12; i++) {
          const a = active.screen.regions[i], b = previous.screen.regions[i];
          if (Math.abs(a.luma - b.luma) > .08) active.widespreadLuma++;
          if (Math.abs(a.alpha - b.alpha) > .20) active.widespreadAlpha++;
        }
        active.coverageCollapse = !!previous && previous.screen.alpha > .05 && active.screen.alpha < previous.screen.alpha * .2;
        active.lumaCollapse = !!previous && previous.screen.luma > .02 && active.screen.luma < previous.screen.luma * .2;
        active.nonFinite = [active.scene, active.bloom, active.output, active.screen].filter(Boolean).reduce((sum, stage) => sum + stage.regions.reduce((s, r) => s + r.nonFinite, 0), 0);
        active.candidate = active.widespreadLuma >= 6 || active.widespreadAlpha >= 6 || active.coverageCollapse || active.lumaCollapse || active.nonFinite > 0 || active.contextLost || !!active.error;
        if (active.candidate && anomalies.length < 200) {
          const canvasStyle = getComputedStyle(c); active.presentation = { canvasOpacity: canvasStyle.opacity, canvasVisibility: canvasStyle.visibility, htmlOpacity: getComputedStyle($('.brand')).opacity };
          anomalies.push(active);
        }
        frames[(sequence - 1) % frames.length] = active; state.renderProbe.total = sequence;
        state.coverage = { covered: Math.round(active.screen.regions.reduce((s, r) => s + r.covered, 0) * 144), luma: active.screen.luma * 255, error: active.error, at: active.at };
        previous = active; active = null;
      },
      dispose() { target.dispose(); sampler.dispose(); },
    };
  }
  async function setSound(enabled) {
    if (!audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Audio unavailable');
      const ctx = new AudioContext();
      const buffer = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) { const data = buffer.getChannelData(channel); let last = 0; for (let i = 0; i < data.length; i++) { last = (last + (Math.random() * 2 - 1) * .035) / 1.02; data[i] = last * 4; } }
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800;
      const gain = ctx.createGain(); gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(ctx.destination); source.start();
      audio = { ctx, gain, source, enabled: false };
    }
    await audio.ctx.resume(); audio.enabled = enabled;
    audio.gain.gain.setTargetAtTime(enabled ? .20 : 0, audio.ctx.currentTime, .5);
  }
  function ringChime() {
    world?.triggerChime(); ui?.toast('风经过，灵感也轻轻响了一下。');
    if (!audio?.enabled || reduced) return;
    for (const frequency of [1046.5, 1396.9, 1568]) {
      const tone = audio.ctx.createOscillator(), gain = audio.ctx.createGain(), now = audio.ctx.currentTime;
      tone.type = 'sine'; tone.frequency.value = frequency; gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.013, now + .018); gain.gain.exponentialRampToValueAtTime(.0001, now + 1.4);
      tone.connect(gain).connect(audio.ctx.destination); tone.start(now); tone.stop(now + 1.45); tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    }
  }

  const config = await fetch(`${import.meta.env.BASE_URL}site-config.json`)
    .then(r => { if (!r.ok) throw new Error('Content configuration unavailable'); return r.json(); })
    .catch(() => demoDefaults);
  if (disposed) return api;

  ui = initUI({ root, config, getProgress: () => vProgress, onSelect: select, onClose: close, onHome: () => applyProgress(0), onRain: value => { rain = value; world?.setRain(value); }, onSound: setSound, onQuality: setQuality, onMotion: value => { reduced = value; world?.setReduced(value); } });
  // React never renders these attributes so it cannot reset them on update.
  root.dataset.mode = 'overview';
  $('#detail').hidden = true;
  $('#fallback').hidden = true;

  function computeCamera() {
    const isMobile = mobile();
    if (mode === 'overview') {
      const p = vProgress * 4, index = Math.min(3, Math.floor(p)), t = p - index, s = t * t * (3 - 2 * t);
      const frames = [{ pos: [10.5, 8.4, 20.5], target: [-.85, 1.5, .55] }, { pos: [6.4, 5.7, 14.5], target: [-.95, 1.95, -.3] }, { pos: [10.8, 6.6, 15.8], target: [.65, 1.65, 1.35] }, { pos: [6.9, 6.2, 18.6], target: [-2.4, 1.45, 2.4] }, { pos: [10.3, 7.9, 20.5], target: [-.85, 1.55, .55] }];
      const a = frames[index], b = frames[index + 1]; desiredPosition.fromArray(a.pos).lerp(new THREE.Vector3(...b.pos), s); desiredTarget.fromArray(a.target).lerp(new THREE.Vector3(...b.target), s);
      if (reduced) { desiredPosition.fromArray(frames[0].pos); desiredTarget.fromArray(frames[0].target); }
      offset.copy(desiredPosition).sub(desiredTarget);
      const yaw = dragYaw + (reduced ? 0 : pointer.x * .024), pitch = dragPitch + (reduced ? 0 : pointer.y * .012);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); offset.y += pitch * 4;
      const entrance = reduced ? 0 : Math.max(0, 1 - (performance.now() - introStart) / 2400);
      offset.multiplyScalar((isMobile ? 1.85 : 1.08) * (1 + entrance * .16));
      desiredPosition.copy(desiredTarget).add(offset);
      right.set(offset.z, 0, -offset.x).normalize();
      // Offset the tableau away from the quiet editorial text at lower left.
      const shift = isMobile ? 0 : -1.00; desiredTarget.addScaledVector(right, shift); desiredPosition.addScaledVector(right, shift);
      if (isMobile) { desiredTarget.y -= 1.15; desiredPosition.y -= 1.15; }
    } else {
      // One finite camera move. The old studio path eased a moving target a second time.
      if (mode === 'studio') { desiredTarget.set(-.95, 1.83, -.55); offset.set(.04, .68, 3.60); }
      else if (mode === 'phone') { desiredTarget.fromArray(LANDMARKS.phone.position); offset.set(.48, 1.10, 5.65).applyAxisAngle(new THREE.Vector3(0, 1, 0), LANDMARKS.phone.yaw); }
      else if (mode === 'mail') { desiredTarget.fromArray(LANDMARKS.mail.position); offset.set(-.95, 1.09, 4.30).applyAxisAngle(new THREE.Vector3(0, 1, 0), LANDMARKS.mail.yaw); }
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), detailYaw);
      offset.y += detailPitch * 3;
      if (isMobile) offset.multiplyScalar(mode === 'mail' ? 1.5 : mode === 'phone' ? 2.1 : 1.65);
      right.set(offset.z, 0, -offset.x).normalize(); up.crossVectors(offset.clone().normalize(), right).normalize();
      const shift = isMobile ? 0 : (mode === 'studio' ? .90 : mode === 'phone' ? 1.21 : .88);
      desiredTarget.addScaledVector(right, shift);
      if (isMobile) desiredTarget.addScaledVector(up, -offset.length() * (mode === 'phone' ? .17 : .21));
      desiredPosition.copy(desiredTarget).add(offset);
      // Detail views move only on intentional drag; pointer hover must not shimmer thin decals/shadows.
    }
  }
  const qualityLow = () => quality === 'low' || (quality === 'auto' && mobile());
  function frame(now) {
    if (disposed || !running) return;
    const dt = Math.min((now - lastFrame) / 1000 || .016, .05); lastFrame = now; clockTime += dt;
    computeCamera();
    const speed = reduced ? 1 : 1 - Math.exp(-dt * (mode === 'overview' ? 3.0 : 2.7));
    if (mode !== 'overview' && focusTransition) {
      const duration = mode === 'studio' ? 2.15 : 1.40;
      const p = reduced ? 1 : THREE.MathUtils.clamp((now - focusWallStart) / (duration * 1000), 0, 1);
      const eased = p * p * p * (p * (p * 6 - 15) + 10);
      camera.position.lerpVectors(focusFromPosition, desiredPosition, eased); currentTarget.lerpVectors(focusFromTarget, desiredTarget, eased);
      if (p === 1) { focusTransition = false; camera.position.copy(desiredPosition); currentTarget.copy(desiredTarget); }
    } else {
      camera.position.lerp(desiredPosition, speed); currentTarget.lerp(desiredTarget, speed);
      // Settle deliberate orbit adjustments at a genuinely sub-pixel, finite threshold.
      if (camera.position.distanceToSquared(desiredPosition) < 2.5e-7) camera.position.copy(desiredPosition);
      if (currentTarget.distanceToSquared(desiredTarget) < 2.5e-7) currentTarget.copy(desiredTarget);
    }
    camera.lookAt(currentTarget);
    world.update(clockTime, dt);
    renderer.info.reset();
    world.prepareRender(camera); renderDiagnostics?.begin(now); composer.render(); renderDiagnostics?.end();
    state.frameMs = +(dt * 1000).toFixed(2); state.drawCalls = renderer.info.render.calls; state.triangles = renderer.info.render.triangles;
    if (now % 1100 < dt * 1000) { state.camera = camera.position.toArray().map(n => +n.toFixed(3)); state.target = currentTarget.toArray().map(n => +n.toFixed(3)); }
    raf = requestAnimationFrame(frame);
  }
  function pick(clientX, clientY) {
    const rect = root.getBoundingClientRect();
    mouse.set((clientX - rect.left) / root.clientWidth * 2 - 1, -(clientY - rect.top) / root.clientHeight * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(world.hitboxes, false);
    return (hits.find(h => h.object.userData.mode === 'chime') || hits[0])?.object.userData.mode;
  }
  // Gesture ownership remains with the scene, never the detail panel or its controls.
  const sceneSide = (x, y) => { const b = $('#detail').getBoundingClientRect(); return mobile() ? y < b.top : x < b.left; };
  const resetGesture = () => { down = null; dragging = false; $('#scene').style.cursor = 'grab'; };
  const onBlur = () => { resetGesture(); clearTimeout(pendingSingle); pendingSingle = 0; };

  try {
    const host = $('#scene');
    renderer = new THREE.WebGLRenderer({ antialias: probeRendering && renderQuery.get('probeContextAA') === '1', alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, mobile() ? 1.1 : 1.65)); renderer.setSize(w, h); renderer.setClearColor('#101c26', 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = mobile() ? 1.42 : 1.30;
    renderer.info.autoReset = false;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; host.append(renderer.domElement);
    scene = new THREE.Scene(); scene.fog = new THREE.FogExp2('#152630', .016);
    Object.defineProperty(state, 'hotspots', { get() { return world?.hitboxes.map(o => { const p = o.getWorldPosition(new THREE.Vector3()).project(camera); return { mode: o.userData.mode, x: Math.round((p.x + 1) * root.clientWidth / 2), y: Math.round((1 - p.y) * root.clientHeight / 2) }; }) || []; } });
    // Tight depth range improves precision on thin seams/decals without clipping any detail view.
    camera = new THREE.PerspectiveCamera(40, w / h, .18, 120); camera.position.set(14, 11, 19);
    world = createWorld(scene, renderer); world.setReduced(reduced); world.setQuality(quality);
    Object.defineProperty(state, 'layout', { get() { return world.getLayoutState(); } });
    Object.defineProperty(state, 'lighting', { get() { return world.getLightingState(); } });
    Object.defineProperty(state, 'ambient', { get() { return world.getAmbientState(); } });
    Object.defineProperty(state, 'transition', { get() { return { active: focusTransition, elapsed: (performance.now() - focusWallStart) / 1000, position: camera.position.toArray(), target: currentTarget.toArray(), remaining: camera.position.distanceTo(desiredPosition) }; } });
    composer = new EffectComposer(renderer); const renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), .10, .3, 1.8);
    if (probeBloom !== 'stock') preserveBloomAlpha(bloom);
    composer.addPass(bloom); const outputPass = new OutputPass(); composer.addPass(outputPass);
    fxaa = new ShaderPass(FXAAShader);
    if (!(probeRendering && renderQuery.get('probeOutput') === 'stock')) {
      // 色调映射/sRGB 非线性转换不保证 RGB<=alpha；在最终 FXAA 输出守住预乘画布契约。
      fxaa.material.fragmentShader = fxaa.material.fragmentShader.replace('gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );',
        'gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );\n if ( !all(lessThanEqual(abs(gl_FragColor), vec4(65504.0))) ) { gl_FragColor = vec4(0.0); return; }\n gl_FragColor.a = clamp(gl_FragColor.a, 0.0, 1.0);\n gl_FragColor.rgb = clamp(gl_FragColor.rgb, vec3(0.0), vec3(gl_FragColor.a));');
    }
    composer.addPass(fxaa);
    if (probeRendering) renderDiagnostics = createRenderDiagnostics(renderPass, outputPass);
    // Every device gets one linear-HDR -> ACES -> sRGB output. ECO disables bloom, not color management.
    setQuality(quality);
    Object.defineProperty(state, 'rendering', { get() { return { pipeline: 'linear-HDR / ACES / sRGB', exposure: renderer.toneMappingExposure, bloom: bloom.enabled, bloomAlpha: probeBloom === 'stock' ? 'r186-additive' : 'scene-preserved / coverage-weighted RGB', outputAlpha: probeRendering && renderQuery.get('probeOutput') === 'stock' ? 'stock' : 'premultiplied-bounded', samples: composer.renderTarget1.samples, contextAntialias: renderer.getContext().getContextAttributes().antialias, premultipliedAlpha: true, antialias: renderer.getPixelRatio() > devicePixelRatio ? 'SSAA + FXAA' : 'FXAA', pixelRatio: renderer.getPixelRatio(), reflectionSize: scene.getObjectByName('continuous-reflective-ground').getRenderTarget().width, near: camera.near, far: camera.far }; } });

    host.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.isPrimary === false) return;
      const isDetail = mode !== 'overview'; if (isDetail && !sceneSide(e.clientX, e.clientY)) return;
      const secondTap = !!pendingSingle; clearTimeout(pendingSingle); pendingSingle = 0;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now(), mode, yaw: isDetail ? detailYaw : dragYaw, pitch: isDetail ? detailPitch : dragPitch, moved: false, secondTap }; dragging = false;
      if (e.isTrusted && (e.pointerType === 'mouse' || isDetail)) host.setPointerCapture(e.pointerId);
    });
    host.addEventListener('pointermove', e => {
      const rect = root.getBoundingClientRect();
      pointer.x = (e.clientX - rect.left) / root.clientWidth * 2 - 1;
      pointer.y = (e.clientY - rect.top) / root.clientHeight * 2 - 1;
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 6) { down.moved = true; dragging = true; }
        if (dragging && (e.pointerType === 'mouse' || mode !== 'overview')) {
          const yaw = THREE.MathUtils.clamp(down.yaw - dx * .0035, -.45, .45), pitch = THREE.MathUtils.clamp(down.pitch + dy * .002, -.15, .18);
          if (mode === 'overview') { dragYaw = yaw; dragPitch = pitch; } else { detailYaw = yaw; detailPitch = pitch; }
        }
      }
      if (mode !== 'overview') { host.style.cursor = dragging ? 'grabbing' : 'grab'; return; }
      hovered = pick(e.clientX, e.clientY); host.style.cursor = dragging ? 'grabbing' : hovered ? 'pointer' : 'grab';
      const label = $('#hover-label');
      label.textContent = { studio: '走进工作室 ↗', phone: '打个电话 ↗', mail: '寄一封信 ↗', chime: '听风经过 ↗' }[hovered] || '';
      label.style.left = `${e.clientX - rect.left + 17}px`; label.style.top = `${e.clientY - rect.top + 12}px`;
      label.style.opacity = hovered && !dragging && e.pointerType === 'mouse' ? 1 : 0;
    });
    host.addEventListener('pointerup', e => {
      if (!down || e.pointerId !== down.id) return;
      const gesture = down;
      const single = !gesture.moved && !dragging && !gesture.secondTap && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) <= 6 && performance.now() - gesture.time < 320 && mode === gesture.mode;
      resetGesture();
      if (!single) return;
      if (mode === 'overview') { const hit = pick(e.clientX, e.clientY); if (hit === 'chime') ringChime(); else if (hit) select(hit); }
      else if (sceneSide(e.clientX, e.clientY)) {
        pendingSingle = setTimeout(() => { pendingSingle = 0; if (mode === gesture.mode) close(); }, 260);
      }
    });
    host.addEventListener('pointercancel', resetGesture);
    host.addEventListener('lostpointercapture', resetGesture);
    window.addEventListener('blur', onBlur);
    host.addEventListener('pointerleave', () => { pointer.x = 0; pointer.y = 0; $('#hover-label').style.opacity = 0; if (!host.hasPointerCapture(down?.id ?? -1)) resetGesture(); });
    renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); stopLoop(); ui.toast('三维画面已暂停，请刷新页面恢复。联系方式仍可使用。'); $('#fallback').hidden = false; });

    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('keydown', onKeyGuard);

    computeCamera(); camera.position.copy(desiredPosition); currentTarget.copy(desiredTarget); camera.lookAt(currentTarget);
    await world.logoReady;
    if (disposed) return api;
    // Warm material and shadow programs beneath the loading screen, not during the first close-up.
    renderer.setRenderTarget(composer.readBuffer);
    await renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(null);
    world.update(0, .016); world.prepareRender(camera); composer.render();
    introStart = performance.now(); lastFrame = introStart;
    syncLoop();
    requestAnimationFrame(() => { ui.setReady(); state.ready = true; });
  } catch (error) {
    console.error('Scene initialization:', error); ui.setReady(); $('#fallback').hidden = false; state.error = String(error);
  }

  applyProgress(0);

  function resize() {
    if (!renderer || !camera) return;
    const w = root.clientWidth, h = root.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer?.setSize(w, h);
    fxaa?.material.uniforms.resolution.value.set(1 / (w * renderer.getPixelRatio()), 1 / (h * renderer.getPixelRatio()));
  }
  function startLoop() { lastFrame = performance.now(); running = true; raf = requestAnimationFrame(frame); }
  function stopLoop() { running = false; cancelAnimationFrame(raf); }
  function syncLoop() {
    const shouldRun = screenActive && pageVisible && !disposed;
    if (shouldRun && !running) startLoop();
    else if (!shouldRun && running) stopLoop();
  }
  function onVisibilityChange() {
    pageVisible = !document.hidden;
    if (audio) { if (pageVisible) { if (audio.enabled) audio.ctx.resume(); } else audio.ctx.suspend(); }
    syncLoop();
  }
  function onResize() {
    const nextMobile = mobile();
    if (nextMobile !== lastMobile) { lastMobile = nextMobile; setQuality(quality); } else resize();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('resize', onResize, { passive: true });
  // The section can be mid-relayout when the scene mounts (viewport/--vh sync on
  // phones); follow the root's real box so the canvas is never left mis-sized.
  const ro = new ResizeObserver(() => resize());
  ro.observe(root);

  const api = {
    setActive(value) { screenActive = Boolean(value); syncLoop(); },
    destroy() {
      disposed = true;
      stopLoop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('keydown', onKeyGuard);
      ro.disconnect();
      try { world?.dispose(); } catch { /* scene may not exist yet */ }
      try { renderDiagnostics?.dispose(); } catch { /* probe only exists with ?renderProbe */ }
      try { composer?.dispose(); } catch { /* noop */ }
      try { renderer?.dispose(); } catch { /* noop */ }
      try { audio?.ctx.close(); } catch { /* noop */ }
      ui?.dispose();
    },
  };
  return api;
}
