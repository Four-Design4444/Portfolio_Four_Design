// Ported verbatim from the 联系我们demo v2.03 (src/ui.js). The only changes are
// mechanical: every query is scoped to the street root instead of the document,
// and `document.body.dataset.mode` / `body.reduce-motion` moved onto the root
// element, because the demo here lives inside one section of the home page.
const chapters = [['01 / ARRIVAL', '在街角，遇见新的可能。'], ['02 / THE STUDIO', '把想法，变成看得见的美好。'], ['03 / A CONVERSATION', '有些好主意，始于一句你好。'], ['04 / DEAR FOUR', '写下来，让故事从这里开始。'], ['05 / STILL AWAKE', '灯还亮着，随时欢迎你。']];
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function initUI({ root, config, getProgress, onSelect, onClose, onHome, onRain, onSound, onQuality, onMotion }) {
  const $ = selector => root.querySelector(selector);
  const panel = $('#detail'), content = $('#detail-content');
  let current = 'overview', previousFocus, toastTimer, sound = false, rain = true, quality = 0;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toast = text => { const el = $('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); };
  root.querySelectorAll('[data-mode]').forEach(el => { if (el.tagName === 'BUTTON') el.addEventListener('click', () => onSelect(el.dataset.mode)); });
  $('.brand').addEventListener('click', e => { e.preventDefault(); onClose(); onHome(); });
  $('#back').addEventListener('click', onClose);
  const onKey = e => {
    if (current === 'overview') return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Tab') { const items = [...panel.querySelectorAll('button,a[href]')].filter(el => !el.disabled); const first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  };
  document.addEventListener('keydown', onKey);
  $('#rain').addEventListener('click', e => { rain = !rain; onRain(rain); e.currentTarget.setAttribute('aria-pressed', rain); e.currentTarget.setAttribute('aria-label', rain ? '关闭雨景' : '开启雨景'); toast(rain ? '细雨继续' : '让雨停一会儿'); });
  $('#sound').addEventListener('click', async e => { const button = e.currentTarget; try { const next = !sound; await onSound(next); sound = next; button.setAttribute('aria-pressed', sound); button.setAttribute('aria-label', sound ? '关闭环境声音' : '开启环境声音'); toast(sound ? '雨声已开启' : '回到安静'); } catch { toast('暂时无法开启声音，请重试'); } });
  const motionButton = $('#motion');
  const updateMotion = () => { root.classList.toggle('reduce-motion', reduced); motionButton.setAttribute('aria-pressed', reduced); motionButton.setAttribute('aria-label', reduced ? '恢复动画' : '减少动画'); onMotion(reduced); };
  motionButton.addEventListener('click', () => { reduced = !reduced; updateMotion(); toast(reduced ? '已减少动态效果' : '动态效果已恢复'); });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const onMotionQueryChange = e => { reduced = e.matches; updateMotion(); };
  motionQuery.addEventListener('change', onMotionQueryChange);
  updateMotion();
  $('#quality').addEventListener('click', e => { quality = (quality + 1) % 3; const values = ['auto', 'high', 'low']; e.currentTarget.textContent = ['AUTO', 'HIGH', 'ECO'][quality]; e.currentTarget.setAttribute('aria-label', `画质：${['自动', '高', '节能'][quality]}，点击切换`); onQuality(values[quality]); toast(['自动画质', '高画质', '节能画质'][quality]); });
  function tickClock() { $('#clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  tickClock(); const clockTimer = setInterval(tickClock, 60000);
  content.addEventListener('click', async e => {
    const copy = e.target.closest('[data-copy]');
    if (copy) { const text = current === 'phone' ? config.phone : config.email; try { await navigator.clipboard.writeText(text); toast('已复制，期待你的消息'); } catch { const range = document.createRange(); range.selectNodeContents(content.querySelector('.contact-value')); const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); toast('请复制已选中的联系方式'); } }
    const link = e.target.closest('[data-switch]'); if (link) onSelect(link.dataset.switch);
  });
  return {
    toast,
    dispose() { document.removeEventListener('keydown', onKey); motionQuery.removeEventListener('change', onMotionQueryChange); clearInterval(clockTimer); clearTimeout(toastTimer); },
    setReady() { $('#loading').classList.add('loaded'); },
    setChapter(index) { const [code, text] = chapters[Math.min(4, index)]; const el = $('#scene-caption'); el.querySelector('span').textContent = code; el.querySelector('p').textContent = text; },
    setProgress(p) { $('#progress').style.width = `${p * 100}%`; $('.intro').style.opacity = current === 'overview' ? Math.max(0, 1 - p * 5) : 0; },
    setMode(mode) {
      if (current === 'overview' && mode !== 'overview') previousFocus = document.activeElement;
      current = mode; root.dataset.mode = mode;
      $('.intro').style.opacity = mode === 'overview' ? Math.max(0, 1 - getProgress() * 5) : 0;
      root.querySelectorAll('#navigation button').forEach(el => el.setAttribute('aria-current', el.dataset.mode === mode));
      const dialogOpen = mode !== 'overview';
      for (const selector of ['.header', '.hud', '#intro', '#scene-caption']) { const el = $(selector); el.inert = dialogOpen; }
      panel.hidden = !dialogOpen;
      if (!dialogOpen) { previousFocus?.focus?.({ preventScroll: true }); return; }
      if (mode === 'studio') content.innerHTML = `<p class="detail-kicker">01 / FOUR DESIGN</p><h2 id="detail-title" class="detail-title">让想法，<br>有自己的样子。</h2><p class="detail-en">Thoughtfully made. Beautifully different.</p><p class="detail-copy">${escape(config.intro)}</p><div class="services">${config.services.map(s => `<span>${escape(s)}</span>`).join('')}</div><div class="detail-rule"></div><p class="detail-copy">从第一张草图，到最后一个像素。<br>我们为有想法的人，做有性格的设计。</p><div class="actions"><button class="primary-action" data-switch="mail">聊聊你的想法 <span>↗</span></button></div>`;
      if (mode === 'phone') content.innerHTML = `<p class="detail-kicker">02 / LET'S TALK</p><h2 id="detail-title" class="detail-title">一句你好，<br>就是好的开始。</h2><p class="detail-en">Good things start with a conversation.</p><p class="detail-copy">一个还没成形的想法，一个准备出发的品牌，<br>或者只是想认识一下。我们都愿意听。</p><div class="detail-rule"></div><div class="contact-label">GIVE US A CALL</div><a class="contact-value" href="tel:${escape(config.phone)}">${escape(config.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3'))}</a><div class="actions"><a class="primary-action" href="tel:${escape(config.phone)}">拨打电话 <span>↗</span></a><button class="copy" data-copy>复制号码 ↗</button></div><p class="small-note">点击拨打将唤起设备的电话应用。<br>不方便通话？你也可以给我们写封信。</p>`;
      if (mode === 'mail') content.innerHTML = `<p class="detail-kicker">03 / DEAR FOUR</p><h2 id="detail-title" class="detail-title">把你的想法，<br>寄到这里。</h2><p class="detail-en">Every great project begins with a little note.</p><p class="detail-copy">关于一个新项目，一次创意合作，<br>或某个值得一起实现的念头。期待你的来信。</p><div class="detail-rule"></div><div class="contact-label">A LETTER TO FOUR</div><a class="contact-value email" href="mailto:${escape(config.email)}">${escape(config.email)}</a><div class="actions"><a class="primary-action" href="mailto:${escape(config.email)}?subject=${encodeURIComponent('你好 Four Design，聊聊一个新想法')}">写一封邮件 <span>↗</span></a><button class="copy" data-copy>复制邮箱 ↗</button></div><p class="small-note">点击将打开你的邮件应用。<br>也可以复制地址，使用你习惯的方式联系。</p>`;
      content.insertAdjacentHTML('beforeend', '<p class="gesture-note">单击画面返回街角 · 拖动换个角度</p>');
      requestAnimationFrame(() => { panel.scrollTop = 0; $('#back').focus({ preventScroll: true }); });
    },
  };
}
