import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clipStates, loadProject, resolveOutput } from '../src/project.ts';

const clip = {
  id: '__proto__', kind: 'video', src: 'assets/clip.mp4',
  start: 2, sourceStart: 12, duration: 4, speed: 2,
};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agentframe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('resolves standalone, edit-only and mixed output settings', async (t) => {
  const dir = await fixture(t);
  await assert.rejects(loadProject(dir), /index.html or timeline.json/);
  await writeFile(join(dir, 'timeline.json'), JSON.stringify({ duration: 8, width: 640, clips: [clip] }));
  const edit = await loadProject(dir);
  assert.equal(edit.hasHtml, false);
  assert.deepEqual(resolveOutput(edit), { width: 640, height: 1080, fps: 30, duration: 8 });
  await writeFile(join(dir, 'index.html'), '<!doctype html>');
  const mixed = await loadProject(dir);
  assert.equal(mixed.hasHtml, true);
  assert.deepEqual(resolveOutput(mixed, { duration: 1, width: 320 }), resolveOutput(edit));
  await rm(join(dir, 'timeline.json'));
  const html = await loadProject(dir);
  assert.deepEqual(resolveOutput(html, { duration: 3 }), {
    width: 1920, height: 1080, fps: 30, duration: 3,
  });
});

test('projects seconds to clip and source time at half-open boundaries', () => {
  assert.deepEqual(clipStates([clip], 3).__proto__, {
    active: true, localTime: 1, sourceTime: 14,
  });
  assert.deepEqual(clipStates([clip], 6).__proto__, { active: false });
});

test('switches clips at a decimal cut without keeping the outgoing clip active', () => {
  const outgoing = { ...clip, id: 'outgoing', start: 0.1, duration: 0.2 };
  const incoming = { ...clip, id: 'incoming', start: 0.3 };
  assert.equal(clipStates([outgoing], 0.299999).outgoing.active, true);
  const atCut = clipStates([outgoing, incoming], 0.3);
  assert.deepEqual(atCut.outgoing, { active: false });
  assert.deepEqual(atCut.incoming, { active: true, localTime: 0, sourceTime: 12 });
});

test('rejects odd output dimensions instead of silently changing them during export', () => {
  assert.throws(
    () => resolveOutput({ hasHtml: true, clips: [] }, { width: 321, height: 180, duration: 1 }),
    /width.*even/i,
  );
});

test('rejects invalid clips and sources outside the project', async (t) => {
  const dir = await fixture(t);
  for (const clips of [
    [clip, clip], [{ ...clip, kind: 'text' }], [{ ...clip, sourceStart: -1 }],
    [{ ...clip, sourceStart: null }], [{ ...clip, duration: 0 }],
    [{ ...clip, speed: 0 }], [{ ...clip, start: 6 }],
    [{ ...clip, src: '../clip.mp4' }], [{ ...clip, src: 'https://example.com/a.mp4' }],
  ]) {
    await writeFile(join(dir, 'timeline.json'), JSON.stringify({ duration: 8, clips }));
    await assert.rejects(loadProject(dir), /clip/i, JSON.stringify(clips));
  }
});
