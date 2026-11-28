import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

export async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "agentframe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function command(dir, ...args) {
  return execFileSync(
    process.execPath,
    ["src/cli.ts", "snapshot", dir, ...args],
    {
      encoding: "utf8",
      timeout: 20000,
    },
  )
    .trim()
    .split("\n");
}

function pixel(path, x = 0, y = 0) {
  return [
    ...execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `crop=1:1:${x}:${y}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ]),
  ];
}

test("the CLI no longer offers the preview command", () => {
  const help = execFileSync(process.execPath, ["src/cli.ts", "--help"], {
    encoding: "utf8",
  });
  assert.match(help, /^Usage: agentframe/m);
  assert.match(help, /^Commands:/m);
  assert.match(help, /^\s+snapshot\s+\S/m);
  assert.match(help, /^\s+check\s+\S/m);
  assert.match(help, /^\s+render\s+\S/m);
  assert.doesNotMatch(help, /\bpreview\b/);
  const result = spawnSync(process.execPath, ["src/cli.ts", "preview", "."], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: preview/);
});

test("each command shows its flags with --help or -h before loading the project", () => {
  const globalHelp = execFileSync(process.execPath, ["src/cli.ts", "-h"], {
    encoding: "utf8",
  });
  assert.match(globalHelp, /^Commands:/m);
  for (const [command, expectedFlag] of [
    ["snapshot", "--sheet"],
    ["check", "--json"],
    ["render", "--range"],
  ]) {
    for (const helpFlag of ["--help", "-h"]) {
      const help = execFileSync(
        process.execPath,
        ["src/cli.ts", command, helpFlag],
        { encoding: "utf8" },
      );
      assert.ok(help.includes(`Usage: agentframe ${command}`));
      assert.ok(help.includes(expectedFlag));
    }
  }
});

test("snapshot finds Chromium on PATH when no browser path is configured", async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, "index.html"),
    "<script>window.duration = 1; window.seek = () => {};</script>",
  );
  await writeFile(
    join(dir, "chromium"),
    `#!${process.execPath}
process.stderr.write('Chromium found on PATH\\n');
process.exit(1);
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    process.execPath,
    ["src/cli.ts", "snapshot", dir, "--at", "0"],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: dir,
        AGENTFRAME_BROWSER_PATH: "",
        PLAYWRIGHT_BROWSERS_PATH: join(dir, "browsers"),
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Chromium found on PATH/);
});

test("snapshot explains how to install a browser when none is available", async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, "index.html"),
    "<script>window.duration = 1; window.seek = () => {};</script>",
  );
  const result = spawnSync(
    process.execPath,
    ["src/cli.ts", "snapshot", dir, "--at", "0"],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: dir,
        AGENTFRAME_BROWSER_PATH: "",
        PLAYWRIGHT_BROWSERS_PATH: join(dir, "browsers"),
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Install Chromium on PATH/);
  assert.match(result.stderr, /playwright install chromium/);
});

test("captures a standalone async animation and crops a selector without reflow", async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, "index.html"),
    `
    <style>body{margin:0} div{position:absolute;left:10px;width:20px;height:30px}</style>
    <div id="card"></div><script>
      window.duration = 2;
      window.output = {width: 100, height: 100};
      window.ready = Promise.resolve().then(() => window.card = document.querySelector('div'));
      window.seek = async (t) => { await Promise.resolve(); card.style.background = t ? 'blue' : 'red'; };
    </script>`,
  );
  const paths = command(
    dir,
    "--at",
    "0,1",
    "--zoom",
    "#card",
    "--sheet",
    "-o",
    join(dir, "shots"),
  );
  assert.equal(paths.length, 3);
  assert.equal(paths[2], join(dir, "shots", "contact-sheet.png"));
  const png = await readFile(paths[0]);
  assert.equal(png.readUInt32BE(16), 20);
  assert.equal(png.readUInt32BE(20), 30);
  assert.deepEqual(pixel(paths[0]), [255, 0, 0]);
  assert.deepEqual(pixel(paths[1]), [0, 0, 255]);
  assert.deepEqual(pixel(paths[2], 180, 100), [255, 0, 0]);
  assert.deepEqual(pixel(paths[2], 500, 100), [0, 0, 255]);
  const [rectangle] = command(
    dir,
    "--at",
    "0",
    "--zoom",
    "10,0,10,10",
    "-o",
    join(dir, "rect"),
  );
  assert.equal((await readFile(rectangle)).readUInt32BE(16), 10);
});

test("decodes H.264 and seeks a sped-up clip forward and backward", async (t) => {
  const dir = await fixture(t);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=64x64:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=64x64:r=30:d=1",
    "-filter_complex",
    "concat=n=2:v=1:a=0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    join(dir, "clip.mp4"),
  ]);
  await writeFile(
    join(dir, "timeline.json"),
    JSON.stringify({
      duration: 1,
      width: 64,
      height: 64,
      clips: [
        {
          id: "__proto__",
          kind: "video",
          src: "clip.mp4",
          start: 0,
          duration: 1,
          speed: 2,
        },
      ],
    }),
  );
  await writeFile(
    join(dir, "index.html"),
    `
    <style>body{margin:0;background:lime} video{width:32px;height:32px;margin:8px}</style>
    <video data-clip="__proto__"></video>
  `,
  );
  const paths = command(
    dir,
    "--at",
    "0.8,0.2",
    "--zoom",
    "8,8,1,1",
    "-o",
    join(dir, "shots"),
  );
  assert.ok(pixel(paths[0])[2] > 200);
  assert.ok(pixel(paths[1])[0] > 200);
  const [full] = command(dir, "--at", "0.2", "-o", join(dir, "full"));
  assert.deepEqual(pixel(full), [0, 255, 0]);
});
