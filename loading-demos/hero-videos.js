(function () {
  'use strict';
  // muted autoplay 偶尔会被宿主环境拦截（无手势策略）：加载后、每次交互、
  // 页面重新可见时都尝试补一次 play()，保证 hero 视频一定在转。
  function ensureVideos() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      if (v.paused) {
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
    }
  }
  ensureVideos();
  window.addEventListener('pointerdown', ensureVideos);
  window.addEventListener('keydown', ensureVideos);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) ensureVideos();
  });
  window.__ensureHeroVideos = ensureVideos;
})();
