---

name: agentframe
description: Use when making motion graphics, animated titles, or overlays in HTML, CSS, and JavaScript with AgentFrame, or when checking, inspecting, or exporting an AgentFrame composition to MP4.
compatibility: Requires the AgentFrame CLI, Node.js 22.18.0 or newer, FFmpeg, FFprobe, and Chromium with H.264 decoding.
---

# AgentFrame

AgentFrame is for motion design. Every composition needs `index.html`. Use HTML, CSS, and JavaScript for layout and animation. Add `timeline.json` if the scene needs timed footage or audio. Use local assets. Compositions need no build step. For cuts, trims, or concatenation without graphics, use FFmpeg directly.

Keep short single-scene projects in one HTML file if that is clearer. For long videos, keep `index.html` short and split markup, styles, and animation by scene and reusable component. Load them using local files.

Set `width`, `height`, and `fps` in `timeline.json` when it exists. It takes precedence over `window.output` and can use `clips: []` for graphics-only projects. An HTML-only project sets `window.duration` and can override the default 1920 × 1080 at 30 fps with `window.output`. Use positive even widths and heights.

## Check and export

Run these from the composition folder. Adjust the example times to fit the project.

1. Run `agentframe check . --json`. Fix the reported findings before exporting. `check` samples frames and tests generated audio; it does not render every frame.
2. Run `agentframe snapshot . --at 0.5,1.2 --sheet -o shots`. Inspect `shots/contact-sheet.png`, then open individual PNGs as needed. Include the frame before and the frame at a cut to check both sides. For detail, use `--zoom '.card'` if the selector exists, or `--zoom x,y,w,h` in output pixels.
3. To review motion or sound at an edit, run `agentframe render . --range 0.5,2.5 -o review.mp4`. The range uses project time. Export the full video with `agentframe render . -o final.mp4` once the checks pass.

## Standalone composition

```html
<!doctype html>
<style>body { margin: 0; display: grid; place-items: center; height: 100vh; background: #191c2c; color: white; font: 80px system-ui }</style>
<main>AgentFrame</main>
<script>
  window.duration = 3;
  window.output = { width: 1280, height: 720, fps: 30 };
  const title = document.querySelector('main');
  window.seek = (t) => { title.style.opacity = Math.min(1, t * 2); };
  window.buildAudio = (ctx) => {
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    tone.connect(gain).connect(ctx.destination);
    tone.start(0.5);
    tone.stop(0.7);
  };
</script>
```

Make `window.seek(time)` set visual state directly from the requested time. Frames can be visited out of order. Finish every update that affects the frame before `seek` returns or its promise resolves. Use the requested time instead of `requestAnimationFrame` or timers as the animation clock. Set `window.ready` to a promise for one-time setup, such as decoding images. Schedule generated sound in `window.buildAudio(context)` using the supplied offline context so it reaches the export.

If the user asks you to make music and supplies neither an audio file nor another way to generate it, compose and synthesize the music in `window.buildAudio(ctx)` using Web Audio. Schedule the notes and volume envelopes on the project clock.

## Add footage and audio to a composition

Place `timeline.json` next to `index.html` to time media used by the scene:

```json
{
  "duration": 6,
  "width": 1280,
  "height": 720,
  "fps": 30,
  "clips": [
    {
      "id": "take",
      "kind": "video",
      "src": "assets/take.mp4",
      "start": 0,
      "sourceStart": 2,
      "duration": 4,
      "speed": 1.5,
      "fadeIn": 0.2,
      "fadeOut": 0.4
    }
  ]
}
```

All times are in seconds. Give each clip a unique `id` and a `src` relative to the project folder. `start` and `duration` refer to the finished edit; `sourceStart` is the offset in the asset. Check `sourceStart + duration × speed` against the source duration. The sample consumes source seconds 2–8. A clip is active at `start` and inactive at `start + duration`.

Use `kind: "audio"` for separate sound. Video contributes its audio if present. Set `muted: true` to silence a clip and `gain` for linear volume (`1` is unchanged). `fadeIn` and `fadeOut` are in output seconds. Overlapping clips do not fade automatically.

## Put footage in a custom layout

Keep the timeline and add an `index.html` with one `<video data-clip="…">` per video clip you want to show. Use the clip ID from the timeline:

```html
<style>
  body { margin: 0; background: #191c2c; color: white }
  .card { position: absolute; inset: 15% 10% auto auto; width: 42%; border-radius: 24px; overflow: hidden }
  video { display: block; width: 100%; background: black }
</style>
<div class="card"><video data-clip="take"></video></div>
<script>
  const card = document.querySelector('.card');
  window.seek = (time, clips) => {
    const take = clips.take;
    card.style.opacity = take.active ? Math.min(1, take.localTime / 0.4) : 0;
  };
</script>
```

AgentFrame sets the video source and seeks it. CSS controls layout and layering. In `window.seek(time, clips)`, read `localTime` (time since the clip started) and `sourceTime` (time in the source asset) only when the clip is active.
