import { mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildMix } from './audio.ts';
import { openStage } from './browser.ts';
import { checkMedia, validateDecode } from './check.ts';
import { runFfmpeg } from './media.ts';
import type { Project } from './project.ts';

function frameIndex(seconds: number, fps: number): number {
  const frame = seconds * fps;
  const nearest = Math.round(frame);
  return Math.abs(frame - nearest) <= Number.EPSILON * Math.max(1, frame) * 4
    ? nearest
    : Math.ceil(frame);
}

export async function render(project: Project, target: string, range?: { start: number; end: number }): Promise<void> {
  const findings = await checkMedia(project);
  if (findings.length) throw new Error(findings.map((finding) => `${finding.clipId}: ${finding.message}`).join('\n'));
  const stage = await openStage(project);
  let root: string | undefined;
  try {
    const { fps, duration } = stage.output;
    const { start, end } = range ?? { start: 0, end: duration };
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > duration) {
      throw new Error('Render range is outside the project');
    }
    const first = frameIndex(start, fps);
    const stop = frameIndex(end, fps);
    if (first >= stop) throw new Error('Render range contains no frames');
    await validateDecode(stage);
    root = await mkdtemp(join(dirname(resolve(target)), '.agentframe-'));
    const mix = join(root, 'mix.wav');
    await buildMix(project, stage, mix);
    stage.assertHealthy();
    async function* frames() {
      for (let index = first; index < stop; index++) {
        await stage.seek(index / fps);
        yield await stage.page.screenshot({ timeout: 10000 });
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
    await rename(output, target);
  } finally {
    try { await stage.close(); } finally {
      if (root) await rm(root, { recursive: true, force: true });
    }
  }
}
