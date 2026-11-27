import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('reports seek errors and speed-adjusted overruns, allowing exact EOF', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', join(dir, 'tone.wav')]);
  const clip = { kind: 'audio', src: 'tone.wav', start: 0, duration: 0.5, speed: 2 };
  await writeFile(join(dir, 'timeline.json'), JSON.stringify({
    duration: 2, clips: [
      { ...clip, id: 'exact' }, { ...clip, id: 'overrun', sourceStart: 0.2 },
      { ...clip, id: 'missing', src: 'missing.wav' },
    ],
  }));
  await writeFile(join(dir, 'index.html'), `<script>
    window.seek = (time) => { if (time === 0.5) throw new Error('broken scene'); };
  </script>`);
  const result = spawnSync(process.execPath, ['src/cli.ts', 'check', dir, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.sampledTimes.includes(0.5));
  assert.ok(report.findings.some(({ clipId, code }) => clipId === 'overrun' && code === 'clip_range'));
  assert.ok(report.findings.some(({ clipId }) => clipId === 'missing'));
  assert.ok(report.findings.some(({ time, message }) => time === 0.5 && message.includes('broken scene')));
  assert.ok(!report.findings.some(({ clipId }) => clipId === 'exact'));
});

test('reports an overrun of the audio stream in audible video', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:d=2',
    '-f', 'lavfi', '-i', 'sine=d=0.5', '-c:v', 'libx264', '-c:a', 'aac', join(dir, 'clip.mp4'),
  ]);
  const clip = { kind: 'video', src: 'clip.mp4', start: 0, duration: 1 };
  await writeFile(join(dir, 'timeline.json'), JSON.stringify({
    duration: 2, width: 64, height: 64, clips: [
      { ...clip, id: 'audible' }, { ...clip, id: 'muted', muted: true },
    ],
  }));
  const result = spawnSync(process.execPath, ['src/cli.ts', 'check', dir, '--json'], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);
  assert.ok(report.findings.some(({ clipId, message }) => clipId === 'audible' && message.includes('audio')));
  assert.ok(!report.findings.some(({ clipId }) => clipId === 'muted'));
});

test('check reports a failing buildAudio callback', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.html'), `<script>
    window.duration = 0.2;
    window.output = {width:64,height:64};
    window.seek = () => {};
    window.buildAudio = async () => { throw new Error('broken soundtrack'); };
  </script>`);
  const result = spawnSync(process.execPath, ['src/cli.ts', 'check', dir, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(({ code, message }) => code === 'audio' && message.includes('broken soundtrack')));
});

test('check --json reports project load failures on stdout', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  function assertLoadFailure() {
    const result = spawnSync(process.execPath, ['src/cli.ts', 'check', dir, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.sampledTimes, []);
    assert.ok(report.findings.some(({ code, message }) => code === 'project' && message.length));
  }
  assertLoadFailure();
  await writeFile(join(dir, 'timeline.json'), '{');
  assertLoadFailure();
});
