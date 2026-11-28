(() => {
  const videos = new Map();

  function bind(clips) {
    for (const video of document.querySelectorAll('video[data-clip]')) {
      const clip = clips.find(({ id, kind }) => id === video.dataset.clip && kind === 'video');
      if (!clip || videos.has(clip.id)) throw new Error(`Invalid video binding: ${video.dataset.clip}`);
      video.muted = true;
      video.playsInline = true;
      video.style.visibility = 'hidden';
      video.src = '/' + clip.src.split('/').map(encodeURIComponent).join('/');
      videos.set(clip.id, video);
    }
  }

  async function readyVideo(video) {
    if (video.error) throw new Error(`Cannot decode ${video.src}; convert it to H.264 MP4`);
    if (video.readyState >= 2) return;
    await waitFor(video, 'loadeddata');
  }

  function waitFor(video, event) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const options = { signal: controller.signal };
      video.addEventListener(event, () => {
        controller.abort();
        resolve();
      }, options);
      video.addEventListener('error', () => {
        controller.abort();
        reject(new Error(`Cannot decode ${video.src}; convert it to H.264 MP4`));
      }, options);
    });
  }

  async function seek(seconds, states, waitForPaint) {
    await Promise.all([...videos].map(async ([id, video]) => {
      const state = states[id];
      video.style.visibility = state.active ? '' : 'hidden';
      video.pause();
      if (!state.active) return;
      await readyVideo(video);
      if (video.currentTime !== state.sourceTime) {
        const done = waitFor(video, 'seeked');
        video.currentTime = state.sourceTime;
        await done;
      }
    }));
    await window.seek?.(seconds, states);
    if (waitForPaint) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  }

  window.__agentframe = { bind, seek, validate: () => Promise.all([...videos.values()].map(readyVideo)) };
})();
