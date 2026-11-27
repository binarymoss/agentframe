import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Stage } from './browser.ts';

async function writeContactSheet(stage: Stage, frames: string[], times: number[], path: string): Promise<void> {
  const columns = Math.min(frames.length, 4);
  const width = 320 * columns + 12 * (columns + 1);
  const page = await stage.page.context().newPage();
  try {
    await page.setViewportSize({ width, height: 1 });
    const origin = 'http://contact-sheet.invalid';
    await page.route(`${origin}/*`, (route) => {
      const index = Number(new URL(route.request().url()).pathname.slice(1));
      return route.fulfill({ path: frames[index] });
    });
    const tiles = times.map((time, index) => `
      <figure><img src="${origin}/${index}"><figcaption>${time} s</figcaption></figure>`);
    await page.setContent(`<!doctype html>
      <style>
        body { margin: 0; padding: 12px; background: #171717; color: white; font: 14px monospace }
        main { display: grid; grid-template-columns: repeat(${columns}, 320px); gap: 12px }
        figure { margin: 0; background: black; text-align: center }
        img { display: block; width: 320px; height: 180px; object-fit: contain }
        figcaption { padding: 6px }
      </style>
      <main>${tiles.join('')}</main>`, { timeout: 10000 });
    await page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode())));
    await page.screenshot({ path, fullPage: true, timeout: 10000 });
  } finally {
    await page.close();
  }
}

export async function snapshot(
  stage: Stage, times: number[], outputDir: string, zoom?: string, sheet = false,
): Promise<string[]> {
  for (const time of times) {
    if (!Number.isFinite(time) || time < 0 || time >= stage.output.duration) {
      throw new Error(`Snapshot time ${time} is outside the project`);
    }
  }
  await mkdir(outputDir, { recursive: true });
  const coordinates = zoom?.match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
  const paths: string[] = [];
  for (const [index, time] of times.entries()) {
    await stage.seek(time);
    const path = resolve(outputDir, `frame-${index}-at-${time}s.png`);
    if (zoom && !coordinates) {
      const box = await stage.page.locator(zoom).boundingBox({ timeout: 10000 });
      if (!box) throw new Error(`No visible element matches ${zoom}`);
      await stage.page.screenshot({ path, clip: box, timeout: 10000 });
    } else {
      const clip = coordinates ? {
        x: Number(coordinates[1]), y: Number(coordinates[2]),
        width: Number(coordinates[3]), height: Number(coordinates[4]),
      } : undefined;
      await stage.page.screenshot({ path, clip, timeout: 10000 });
    }
    paths.push(path);
  }
  if (sheet && paths.length) {
    const sheetPath = resolve(outputDir, 'contact-sheet.png');
    await writeContactSheet(stage, paths, times, sheetPath);
    paths.push(sheetPath);
  }
  return paths;
}
