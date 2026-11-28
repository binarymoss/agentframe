import { mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildMix } from './audio.ts';
import { openStage, timed } from './browser.ts';
import type { Stage } from './browser.ts';
import { checkMedia, validateDecode } from './check.ts';
import { runFfmpeg } from './media.ts';
import type { Project } from './project.ts';

const minParallelFrames = 120;

function frameIndex(seconds: number, fps: number): number {
  const frame = seconds * fps;
  const nearest = Math.round(frame);
  return Math.abs(frame - nearest) <= Number.EPSILON * Math.max(1, frame) * 4
    ? nearest
    : Math.ceil(frame);
}

async function openCapture(stage: Stage, fps: number, waitForPaint: boolean): Promise<(index: number) => Promise<Buffer>> {
  const cdp = await stage.page.context().newCDPSession(stage.page);
  return async (index) => {
    const time = index / fps;
    await stage.seek(time, waitForPaint);
    const { data } = await timed(`Capture at ${time}s`, (async () => {
      await stage.page.evaluate(() => document.fonts.ready.then(() => undefined));
      return cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    })());
    stage.assertHealthy();
    return Buffer.from(data, 'base64');
  };
}

export async function render(project: Project, target: string, range?: { start: number; end: number }): Promise<void> {
  const findings = await checkMedia(project);
  if (findings.length) throw new Error(findings.map((finding) => `${finding.clipId}: ${finding.message}`).join('\n'));
  const stage = await openStage(project);
  let secondStage: Stage | undefined;
  let root: string | undefined;
  try {
    const { width, height, fps, duration } = stage.output;
    const { start, end } = range ?? { start: 0, end: duration };
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > duration) {
      throw new Error('Render range is outside the project');
    }
    const first = frameIndex(start, fps);
    const stop = frameIndex(end, fps);
    if (first >= stop) throw new Error('Render range contains no frames');
    await validateDecode(stage);
    const hasVideo = project.clips.some((clip) => clip.kind === 'video');
    const parallel = stop - first >= minParallelFrames && !hasVideo
      && await stage.page.evaluate(() => !window.buildAudio);
    root = await mkdtemp(join(dirname(resolve(target)), '.agentframe-'));
    const mix = join(root, 'mix.wav');
    await buildMix(project, stage, mix);
    stage.assertHealthy();
    // A video can fire seeked before the compositor presents its frame.
    const capture = await openCapture(stage, fps, hasVideo);
    if (parallel) secondStage = await openStage(project);
    const secondOutput = secondStage?.output;
    const captureSecond = secondStage && secondOutput?.width === width && secondOutput.height === height
      && secondOutput.fps === fps && secondOutput.duration === duration
      ? await openCapture(secondStage, fps, false)
      : undefined;
    async function* frames() {
      for (let index = first; index < stop; index++) {
        if (captureSecond && index + 1 < stop) {
          // Capture adjacent frames together to keep at most two buffers ahead of the encoder.
          yield* await Promise.all([capture(index), captureSecond(index + 1)]);
          index++;
        } else {
          yield await capture(index);
        }
      }
    }
    const output = join(root, 'out.mp4');
    const audioStart = Math.round(first / fps * 48000);
    const audioEnd = Math.round(stop / fps * 48000);
    await runFfmpeg([
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0', '-i', mix,
      '-af', `atrim=start_sample=${audioStart}:end_sample=${audioEnd},asetpts=PTS-STARTPTS,apad=whole_len=${audioEnd - audioStart}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output,
    ], frames());
    stage.assertHealthy();
    if (captureSecond) secondStage?.assertHealthy();
    await rename(output, target);
  } finally {
    try { await Promise.all([stage.close(), secondStage?.close()]); } finally {
      if (root) await rm(root, { recursive: true, force: true });
    }
  }
}
