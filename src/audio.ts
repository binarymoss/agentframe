import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timed } from './browser.ts';
import type { Stage } from './browser.ts';
import { assetPath, probeMedia, runFfmpeg } from './media.ts';
import type { Project } from './project.ts';

declare global {
  interface Window {
    buildAudio?: (context: OfflineAudioContext) => void | Promise<void>;
    __agentframeAudio?: AudioBuffer;
  }
}

const sampleRate = 48000;

export async function renderGeneratedAudio(stage: Stage, keepBuffer = false): Promise<number> {
  return timed('Generated audio', stage.page.evaluate(async ({ duration, sampleRate, keepBuffer }) => {
    if (!window.buildAudio) return 0;
    const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    await window.buildAudio(context);
    const buffer = await context.startRendering();
    if (keepBuffer) window.__agentframeAudio = buffer;
    return buffer.length;
  }, { duration: stage.output.duration, sampleRate, keepBuffer }));
}

async function generatedAudio(stage: Stage, path: string): Promise<boolean> {
  const length = await renderGeneratedAudio(stage, true);
  if (!length) return false;
  const file = await open(path, 'w');
  try {
    for (let offset = 0; offset < length; offset += 16384) {
      const samples = await stage.page.evaluate(({ offset, length }) => {
        const audio = window.__agentframeAudio!;
        const left = audio.getChannelData(0);
        const right = audio.getChannelData(1);
        const samples = [];
        for (let index = offset; index < Math.min(length, offset + 16384); index++) {
          samples.push(left[index], right[index]);
        }
        return samples;
      }, { offset, length });
      const bytes = Buffer.allocUnsafe(samples.length * 4);
      samples.forEach((sample, index) => bytes.writeFloatLE(sample, index * 4));
      await file.writeFile(bytes);
    }
  } finally {
    await file.close();
    await stage.page.evaluate(() => { delete window.__agentframeAudio; });
  }
  return true;
}

function tempo(speed: number): string[] {
  const filters: string[] = [];
  while (speed > 2 || speed < 0.5) {
    const stage = speed > 2 ? 2 : 0.5;
    filters.push(`atempo=${stage}`);
    speed /= stage;
  }
  if (speed !== 1) filters.push(`atempo=${speed}`);
  return filters;
}

export async function buildMix(project: Project, stage: Stage, outputPath: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'agentframe-audio-'));
  const inputs: string[] = [];
  const filters: string[] = [];
  try {
    for (const clip of project.clips) {
      if (clip.muted || clip.gain === 0) continue;
      const path = await assetPath(project.dir, clip.src);
      if ((await probeMedia(path)).audio === undefined) continue;
      const index = filters.length;
      inputs.push('-ss', String(clip.sourceStart), '-t', String(clip.duration * clip.speed), '-i', path);
      const fadeScale = Math.min(1, clip.duration / (clip.fadeIn + clip.fadeOut));
      const fadeIn = clip.fadeIn * fadeScale;
      const fadeOut = clip.fadeOut * fadeScale;
      const chain = [
        ...(clip.speed !== 1 ? ['apad=pad_dur=0.1', ...tempo(clip.speed)] : []),
        'aresample=48000', 'aformat=channel_layouts=stereo',
        'apad', `atrim=duration=${clip.duration}`, `volume=${clip.gain}`,
        ...(fadeIn ? [`afade=t=in:d=${fadeIn}`] : []),
        ...(fadeOut ? [`afade=t=out:st=${clip.duration - fadeOut}:d=${fadeOut}`] : []),
        `adelay=${Math.round(clip.start * sampleRate)}S:all=1`,
      ];
      filters.push(`[${index}:a]${chain.join(',')}[a${index}]`);
    }
    const generated = join(root, 'generated.f32');
    if (await generatedAudio(stage, generated)) {
      const index = filters.length;
      inputs.push('-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', generated);
      filters.push(`[${index}:a]anull[a${index}]`);
    }
    const duration = stage.output.duration;
    const labels = filters.map((_, index) => `[a${index}]`).join('');
    const mix = filters.length
      ? ['-filter_complex', [...filters, `${labels}amix=inputs=${filters.length}:normalize=0:dropout_transition=0,apad[mix]`].join(';'), '-map', '[mix]']
      : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
    await runFfmpeg(['-y', ...inputs, ...mix, '-t', String(duration), '-c:a', 'pcm_s16le', outputPath]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
