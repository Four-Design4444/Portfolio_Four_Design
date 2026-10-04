// V3.1.12「联系我们」demo（雨夜街角 3D 场景）原封不动嵌入首页尾屏。
// 整包构建产物放在 public/contact-street/（index.html + assets + logo.svg +
// site-config.json；相对路径由 demo 的 base:'./' 保证），这里只用一个全屏
// iframe 加载它 —— demo 字节级不变、不进 React 构建图、不重移植。
// 懒挂载：进入尾屏(active 为真)才把 src 挂上，避免提前 boot 重型 Three.js 场景。
import { useEffect, useState } from 'react';

const DEMO_URL = `${import.meta.env.BASE_URL}contact-street/index.html`;

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
    />
  );
}
