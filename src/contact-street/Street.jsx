// V3.1.12「联系我们」demo（雨夜街角 3D 场景）原封不动嵌入首页尾屏。
// 整包构建产物放在 public/contact-street/（index.html + assets + logo.svg +
// site-config.json；相对路径由 demo 的 base:'./' 保证），这里只用一个全屏
// iframe 加载它 —— demo 字节级不变、不进 React 构建图、不重移植。
// 懒挂载：进入尾屏(active 为真)才把 src 挂上，避免提前 boot 重型 Three.js 场景。
import { useEffect, useState } from 'react';

const DEMO_URL = `${import.meta.env.BASE_URL}contact-street/index.html`;

// 尾屏只保留 3D 场景与底部导航栏（#navigation）。demo 顶部那一栏品牌 / 天气 /
// 时钟文字信息（.header，position:fixed;top）在 iframe 加载后注入样式隐藏。
// 注意：不改动 V3.1.12 的构建产物本身，只在本屏展示时叠加隐藏，底部导航栏保留。
function hideDemoTopChrome(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (!doc || !doc.head) return;
    if (doc.getElementById('contact-hide-top')) return;
    const style = doc.createElement('style');
    style.id = 'contact-hide-top';
    style.textContent = '.header{display:none!important}';
    doc.head.appendChild(style);
  } catch (_) {
    /* 同源 public 资源可读；跨域时静默跳过 */
  }
}

export default function ContactStreet({ active }) {
  const [everActive, setEverActive] = useState(false);
  useEffect(() => { if (active) setEverActive(true); }, [active]);

  if (!everActive) return null;
  return (
    <iframe
      className="street-contact-frame"
      src={DEMO_URL}
      title="Four Design · 夜深了，灵感还亮着"
      loading="lazy"
      allow="autoplay; fullscreen"
      onLoad={(e) => hideDemoTopChrome(e.currentTarget)}
    />
  );
}
