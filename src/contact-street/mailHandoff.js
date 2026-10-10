// 移动端「写一封信」→ **直接唤起系统邮件列表**（2026-10-13）。
//
// 业主口径：「用户点击『写一封信 ↗』后，就应该直接唤起用户的系统列表」——
// 所以这里不再有任何中间选择层，点一下就是一次 `mailto:`。
//
// 为什么在**顶层窗口**发起：
//   `mailto:` 是外部协议。从子 iframe 发起时，iOS Safari 与各家 WebView 都可能
//   直接拒绝（页面里连报错都看不到，用户只感觉"点了没反应"）；顶层框架发起才是
//   各端都认的路径。所以 iframe 只上报点击（postMessage），真正发起在这里。
//
// 为什么 `mailto:` 就等于"优先展示本机拥有的邮件类产品"：
//   Web 侧拿不到"本机装了哪些邮件应用"的清单。而 `mailto:` 交给系统后，安卓弹的
//   正是系统级「打开方式」列表 —— 那份列表**本身**只包含本机装了/配了的邮件应用；
//   iOS 14 起走用户自选的默认邮件 App。系统列表就是"本地优先"的权威版本。
//
// 交付判据：页面真的让出前台（visibilitychange→hidden / blur / pagehide）。
// ⚠ 超时**只报告、不自动跳转** —— 系统选择器弹出时页面未必会隐藏，自动跳转
//   会和它抢屏幕（宁可多一行说明，也不抢用户的屏幕）。
export const MAIL_PROBE_MS = 1800;

// 用**真实 anchor** 触发，而不是 location.href：
// ① 保留用户手势上下文（外部协议在各端都要求这一点）；
// ② location.href 在部分 WebView 里会被当成"离开当前文档"，把 SPA 状态搅乱。
// 节点同步插入/点击、下一轮任务里移除，不参与布局。
function clickAnchor(href, target) {
  try {
    const a = document.createElement('a');
    a.href = href;
    if (target) {
      a.target = target;
      a.rel = 'noopener noreferrer';
    }
    a.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => { try { a.remove(); } catch (_) { /* noop */ } }, 0);
    return true;
  } catch (_) { return false; }
}

// 同一时刻只允许一个交付探测在跑（连点两次时，旧探测必须先把监听器与定时器
// 撤掉，否则旧定时器到点会把新一轮已经成功的状态报成"没人接住"）。
let pendingCleanup = null;

export function cancelMailto() {
  if (!pendingCleanup) return;
  const c = pendingCleanup;
  pendingCleanup = null;
  c();
}

export function launchMailto(href, onNoApp) {
  cancelMailto();
  let settled = false;
  let timer = 0;
  const cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pagehide', onVis);
    if (pendingCleanup === cleanup) pendingCleanup = null;
  };
  function settle(ok) {
    if (settled) return;
    settled = true;
    cleanup();
    if (!ok && onNoApp) onNoApp();
  }
  function onVis() { if (document.hidden) settle(true); }
  function onBlur() { settle(true); }
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onVis);
  pendingCleanup = cleanup;
  timer = window.setTimeout(() => settle(false), MAIL_PROBE_MS);
  clickAnchor(href);
}
