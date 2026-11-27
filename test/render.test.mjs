import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { loadProject } from '../src/project.ts';
import { render } from '../src/render.ts';

test('range export uses the full frame grid and includes generated audio', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.html'), `
    <style>body {margin:0}</style><script>
    window.duration = 1;
    window.output = {width:64,height:64,fps:10};
    const initializedWidth = innerWidth;
    window.seek = t => {
      if (initializedWidth !== 64) throw new Error('wrong viewport at startup');
      document.body.style.background = t < 0.1 ? 'red' : 'blue';
      window.hasSought = true;
    };
    window.buildAudio = ctx => {
      if (window.hasSought) throw new Error('audio started after first seek');
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, 0);
      gain.gain.linearRampToValueAtTime(0.5, 0.5);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(0);
    };
    </script>`);
  const output = join(dir, 'out.mp4');
  execFileSync(process.execPath, ['src/cli.ts', 'render', dir, '--range', '0.01,0.51', '-o', output]);
  const video = execFileSync('ffmpeg', [
    '-v', 'error', '-i', output, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  assert.equal(video.length, 5 * 3);
  assert.ok(video[2] > 200);
  const full = join(dir, 'full.mp4');
  execFileSync(process.execPath, ['src/cli.ts', 'render', dir, '-o', full]);
  const decodeAudio = (path) => execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a', '-f', 's16le', '-']);
  const audio = decodeAudio(output);
  const fullAudio = decodeAudio(full);
  const rms = (buffer, start) => {
    let squares = 0;
    for (let index = start; index < start + 1200; index++) squares += buffer.readInt16LE(index * 4) ** 2;
    return Math.sqrt(squares / 1200);
  };
  const original = rms(fullAudio, 6000);
  assert.ok(original > 2000);
  assert.ok(Math.abs(rms(audio, 1200) - original) / original < 0.1);
});

test('two render workers preserve frame order and the last frame of an odd-length range', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.html'), `
    <!doctype html><style>body {margin:0}</style><script>
    window.duration = 13;
    window.output = {width:64,height:64,fps:10};
    window.seek = async time => {
      const frame = Math.round(time * 10);
      if (frame % 2 === 0) await new Promise(resolve => setTimeout(resolve, 5));
      document.body.style.background = ['red', 'lime', 'blue'][frame % 3];
    };
    </script>`);
  const launch = t.mock.method(chromium, 'launch');
  const output = join(dir, 'out.mp4');
  await render(await loadProject(dir), output, { start: 0.2, end: 12.3 });
  assert.equal(launch.mock.callCount(), 2);
  const pixels = execFileSync('ffmpeg', [
    '-v', 'error', '-i', output, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  assert.equal(pixels.length, 121 * 3);
  for (let frame = 0; frame < 121; frame++) {
    const pixel = pixels.subarray(frame * 3, frame * 3 + 3);
    assert.equal(pixel.findIndex(value => value > 200), (frame + 2) % 3, `frame ${frame}`);
  }
});

test('a failed parallel capture closes both browsers and preserves the target', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'existing.mp4');
  await writeFile(output, 'original');
  await writeFile(join(dir, 'index.html'), `
    <script>
    window.duration = 12;
    window.output = {width:64,height:64,fps:10};
    window.seek = time => { if (time === 0.1) throw new Error('failed parallel frame'); };
    </script>`);
  const launch = t.mock.method(chromium, 'launch');
  await assert.rejects(render(await loadProject(dir), output), /failed parallel frame/);
  const browsers = await Promise.all(launch.mock.calls.map(({ result }) => result));
  assert.equal(browsers.length, 2);
  assert.ok(browsers.every(browser => !browser.isConnected()));
  assert.equal(await readFile(output, 'utf8'), 'original');
  assert.deepEqual((await readdir(dir)).sort(), ['existing.mp4', 'index.html']);
});

test('a long render with generated audio uses the same page for audio and frames', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.html'), `
    <script>
    window.duration = 1;
    window.output = {width:64,height:64,fps:120};
    window.buildAudio = () => { window.audioInitialized = true; };
    window.seek = () => {
      if (!window.audioInitialized) throw new Error('Audio was initialized on another page');
    };
    </script>`);
  const launch = t.mock.method(chromium, 'launch');
  await render(await loadProject(dir), join(dir, 'out.mp4'));
  assert.equal(launch.mock.callCount(), 1);
});

test('uses timeline dimensions before loading HTML and in the exported MP4', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'timeline.json'), JSON.stringify({
    width: 320, height: 180, fps: 10, duration: 0.2, clips: [],
  }));
  await writeFile(join(dir, 'index.html'), `<script>
    const initializedSize = [innerWidth, innerHeight];
    window.output = {width:64,height:64};
    window.seek = () => {
      if (initializedSize.join(',') !== '320,180') throw new Error('wrong viewport at startup');
    };
  </script>`);
  const output = join(dir, 'out.mp4');
  execFileSync(process.execPath, ['src/cli.ts', 'render', dir, '-o', output]);
  const size = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', output,
  ], { encoding: 'utf8' });
  assert.equal(size.trim(), '320,180');
});

test('a timeline-only range waits for decoding only the clips in that range', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, color, codec] of [['red.mp4', 'red', 'libx264'], ['blue.mp4', 'blue', 'libx264'], ['unsupported.avi', 'lime', 'ffv1']]) {
    execFileSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=64x64:r=10:d=1`,
      '-c:v', codec, join(dir, name),
    ]);
  }
  await writeFile(join(dir, 'timeline.json'), JSON.stringify({
    width: 64, height: 64, fps: 10, duration: 3,
    clips: ['red.mp4', 'blue.mp4', 'unsupported.avi'].map((src, start) => ({
      id: src, kind: 'video', src, start, duration: 1,
    })),
  }));
  const output = join(dir, 'out.mp4');
  const render = (range) => ['src/cli.ts', 'render', dir, '--range', range, '-o', output];
  execFileSync(process.execPath, render('0.9,1.1'), { timeout: 15000 });
  const pixels = execFileSync('ffmpeg', [
    '-v', 'error', '-i', output, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  assert.equal(pixels.length, 6);
  assert.ok(pixels[0] > 200 && pixels[2] < 20);
  assert.ok(pixels[3] < 20 && pixels[5] > 200);
  const unsupported = spawnSync(process.execPath, render('2,2.1'), { encoding: 'utf8', timeout: 15000 });
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /Cannot decode.*unsupported\.avi/);
});

test('render reports uncaught page errors instead of replacing the target', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'existing.mp4');
  await writeFile(output, 'original');
  for (const script of [
    `window.seek = () => {}; throw new Error('uncaught frame error');`,
    `window.seek = () => requestAnimationFrame(() => { throw new Error('uncaught frame error'); });`,
  ]) {
    await writeFile(join(dir, 'index.html'), `<script>
      window.duration = 0.1;
      window.output = {width:64,height:64,fps:10};
      ${script}
    </script>`);
    const result = spawnSync(process.execPath, ['src/cli.ts', 'render', dir, '-o', output], {
      encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /uncaught frame error/);
    assert.equal(await readFile(output, 'utf8'), 'original');
  }
});

test('a failed capture leaves the existing target and removes the temporary export', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'existing.mp4');
  await writeFile(output, 'original');
  await writeFile(join(dir, 'index.html'), `<script>
    window.duration = 1;
    window.output = {width: 64, height: 64, fps: 10};
    window.seek = t => { if (t > 0) throw new Error('failed frame'); };
  </script>`);
  const result = spawnSync(process.execPath, ['src/cli.ts', 'render', dir, '-o', output], {
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed frame/);
  assert.equal(await readFile(output, 'utf8'), 'original');
  assert.deepEqual((await readdir(dir)).sort(), ['existing.mp4', 'index.html']);
});

test('render streams PNG frames to FFmpeg and preserves the target if the encoder exits early', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.html'), `<script>
    window.duration = 0.5;
    window.output = {width:64,height:64,fps:10};
    window.seek = () => {};
  </script>`);
  await writeFile(join(dir, 'ffmpeg'), `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    */%d.png) echo 'PNG files were used as input' >&2; exit 1 ;;
    image2pipe)
      if [[ "$TEST_ENCODER_FAIL" == 1 ]]; then
        head -c 8 > /dev/null
        echo 'test encoder failure' >&2
        exit 1
      fi
      ;;
  esac
done
export PATH="$TEST_ORIGINAL_PATH"
exec ffmpeg "$@"
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_ORIGINAL_PATH: process.env.PATH };
  const output = join(dir, 'out.mp4');
  const args = ['src/cli.ts', 'render', dir, '-o', output];
  execFileSync(process.execPath, args, { env, timeout: 15000 });
  const original = await readFile(output);
  const result = spawnSync(process.execPath, args, {
    env: { ...env, TEST_ENCODER_FAIL: '1' }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test encoder failure/);
  assert.deepEqual(await readFile(output), original);
  assert.deepEqual((await readdir(dir)).sort(), ['ffmpeg', 'index.html', 'out.mp4']);
});
