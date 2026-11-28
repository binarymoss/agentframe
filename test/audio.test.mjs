import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMix } from "../src/audio.ts";
import { openStage } from "../src/browser.ts";
import { loadProject } from "../src/project.ts";

test("mix places a sped-up tone on the project clock with pitch and fades intact", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "agentframe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    join(dir, "tone.wav"),
  ]);
  await writeFile(
    join(dir, "timeline.json"),
    JSON.stringify({
      duration: 3,
      clips: [
        {
          id: "tone",
          kind: "audio",
          src: "tone.wav",
          start: 0.5,
          sourceStart: 1,
          duration: 1,
          speed: 2,
          gain: 0.5,
          fadeIn: 0.2,
          fadeOut: 0.2,
        },
      ],
    }),
  );
  await writeFile(join(dir, "index.html"), "<!doctype html>");
  const project = await loadProject(dir);
  const stage = await openStage(project);
  t.after(() => stage.close());
  const path = join(dir, "mix.wav");
  await buildMix(project, stage, path);
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    path,
    "-f",
    "s16le",
    "-",
  ]);
  const sample = (index) => pcm.readInt16LE(index * 4);
  const span = (start, end) =>
    Array.from({ length: Math.round((end - start) * 48000) }, (_, index) =>
      sample(Math.round(start * 48000) + index),
    );
  assert.equal(pcm.length, 3 * 48000 * 4);
  assert.ok(span(0.1, 0.4).every((value) => value === 0));
  const steady = span(0.8, 1);
  const crossings = steady.filter(
    (value, index) => index > 0 && steady[index - 1] <= 0 && value > 0,
  );
  assert.ok(Math.abs(crossings.length - 88) <= 1);
  const peak = (values) => Math.max(...values.map(Math.abs));
  assert.ok(peak(steady) > 1000);
  assert.ok(peak(span(0.51, 0.55)) < peak(steady) / 2);
  assert.ok(peak(span(1.45, 1.48)) < peak(steady) / 2);
  assert.ok(span(1.6, 1.8).every((value) => value === 0));
});

test("a 20ms source stays audible at double speed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "agentframe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=0.02",
    join(dir, "short.wav"),
  ]);
  await writeFile(
    join(dir, "timeline.json"),
    JSON.stringify({
      duration: 0.1,
      clips: [
        {
          id: "blip",
          kind: "audio",
          src: "short.wav",
          start: 0,
          duration: 0.01,
          speed: 2,
        },
      ],
    }),
  );
  await writeFile(join(dir, "index.html"), "<!doctype html>");
  const project = await loadProject(dir);
  const stage = await openStage(project);
  t.after(() => stage.close());
  const path = join(dir, "mix.wav");
  await buildMix(project, stage, path);
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    path,
    "-f",
    "s16le",
    "-",
  ]);
  assert.ok(pcm.subarray(0, 480 * 4).some(Boolean));
});
