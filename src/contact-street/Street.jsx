// Ported from the 联系我们demo v2.03 (index.html). The static markup is the
// demo's own, verbatim, minus the standalone-page furniture that has no meaning
// here (#journey scroll spacer, noscript block). The #detail/#fallback `hidden`
// attributes and the root's data-mode are set by street.js on mount instead of
// in JSX so React re-renders can never reset state the demo code mutates.
import { useEffect, useRef, useState } from 'react';
import { mountStreet } from './street.js';
import './street.css';

const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`;

export default function ContactStreet({ active }) {
  const rootRef = useRef(null);
  const streetRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [everActive, setEverActive] = useState(false);

  useEffect(() => { if (active) setEverActive(true); }, [active]);

  useEffect(() => {
    if (!everActive) return undefined;
    let instance = null;
    let cancelled = false;
    mountStreet(rootRef.current).then(api => {
      if (cancelled) { api.destroy(); return; }
      instance = api;
      streetRef.current = api;
      api.setActive(activeRef.current);
    });
    return () => {
      cancelled = true;
      streetRef.current = null;
      if (instance) instance.destroy();
    };
  }, [everActive]);

  useEffect(() => { streetRef.current?.setActive(active); }, [active, everActive]);

  return (
    <div ref={rootRef} className="street-app">
      <a className="skip" href="#navigation" onClick={event => { event.preventDefault(); rootRef.current?.querySelector('#navigation')?.focus(); }}>跳到探索导航</a>
      <div id="scene" role="img" aria-label="雨夜设计工作室三维街角。也可使用下方按钮探索工作室、电话亭和邮箱。"></div>
      <div className="vignette" aria-hidden="true"></div>
      <div id="loading">
        <img src={LOGO_SRC} alt="Four" />
        <p>A LITTLE WORLD IS COMING TO LIFE</p>
        <div className="load-line"></div>
        <span>正在点亮街角</span>
      </div>
      <header className="header">
        <a className="brand" href="#" aria-label="Four Design，返回街角"><img src={LOGO_SRC} alt="Four" /><span>DESIGN<br />STUDIO</span></a>
        <div className="weather">
          <span className="weather-dot"></span>
          <span>细雨 · 秋夜</span>
          <i></i>
          <time id="clock">22:47</time>
          <span className="weather-note">A GOOD TIME FOR IDEAS</span>
        </div>
      </header>
      <div className="intro" id="intro">
        <div className="eyebrow"><span className="tiny-line"></span> SOMEWHERE, AN IDEA IS STILL AWAKE.</div>
        <h1>夜深了，<br />灵感还亮着<span className="amber">。</span></h1>
        <p>一间小工作室，一些不小的想法。</p>
        <div className="intro-foot"><span>FOUR DESIGN</span><span>INDEPENDENT CREATIVE STUDIO</span></div>
      </div>
      <div id="scene-caption" aria-live="polite"><span>01 / ARRIVAL</span><p>在街角，遇见新的可能。</p></div>
      <aside id="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <button className="back" id="back" aria-label="关闭详情，返回街角"><span>↖</span> 返回街角 <kbd>ESC</kbd></button>
        <div id="detail-content"></div>
        <div className="panel-signature"><span className="status-dot"></span> THE LIGHT IS ON. COME SAY HELLO.</div>
      </aside>
      <div id="fallback">
        <h2>灯还亮着。</h2>
        <p>当前设备暂时无法开启三维场景，你仍然可以通过下方入口了解我们或取得联系。</p>
      </div>
      <footer className="hud">
        <div className="explore-note"><span className="mouse-icon"></span><span>滚动探索 <i>·</i> 拖动观察</span></div>
        <nav id="navigation" aria-label="探索街角" tabIndex={-1}>
          <button data-mode="studio"><span className="nav-number">01</span> 工作室 <span className="nav-arrow">↗</span></button>
          <span className="nav-divider"></span>
          <button data-mode="phone"><span className="nav-number">02</span> 打个电话 <span className="nav-arrow">↗</span></button>
          <span className="nav-divider"></span>
          <button data-mode="mail"><span className="nav-number">03</span> 写封信 <span className="nav-arrow">↗</span></button>
        </nav>
        <div className="controls">
          <button id="rain" aria-label="关闭雨景" aria-pressed="true" title="雨景"><svg viewBox="0 0 24 24"><path d="M6 13a4 4 0 1 1 1-7 5 5 0 0 1 9 1 3 3 0 1 1 1 6M8 16l-1 3m5-3-1 3m5-3-1 3" /></svg></button>
          <button id="sound" aria-label="开启环境声音" aria-pressed="false" title="环境声音"><svg viewBox="0 0 24 24"><path d="M3 10h4l5-4v12l-5-4H3zm13-1v6m4-8v10" /></svg></button>
          <button id="motion" aria-label="减少动画" aria-pressed="false" title="减少动画"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg></button>
          <button id="quality" aria-label="画质：自动，点击切换" title="画质">AUTO</button>
        </div>
      </footer>
      <div className="progress-track" aria-hidden="true"><div id="progress"></div></div>
      <div id="toast" role="status" aria-live="polite"></div>
      <div id="hover-label" aria-hidden="true"></div>
    </div>
  );
}
