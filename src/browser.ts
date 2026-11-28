import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { clipStates, defaultViewport, resolveOutput } from './project.ts';
import type { Clip, ClipState, Output, PageMetadata, Project } from './project.ts';
import { serve } from './server.ts';

declare global {
  interface Window {
    duration?: number;
    output?: Partial<Output>;
    ready?: Promise<void>;
    seek?: (seconds: number, clips: Record<string, ClipState>) => void | Promise<void>;
    __agentframe: {
      bind(clips: Clip[]): void;
      seek(seconds: number, clips: Record<string, ClipState>, waitForPaint: boolean): Promise<void>;
      validate(): Promise<void>;
    };
  }
}

const pageScript = fileURLToPath(new URL('./page.js', import.meta.url));
export type Stage = {
  page: Page;
  output: Output;
  seek(seconds: number, waitForPaint?: boolean): Promise<void>;
  assertHealthy(): void;
  close(): Promise<void>;
};

type StageOptions = {
  observe?: (page: Page) => void;
  onPageError?: (error: Error) => void;
};

export async function timed<T>(label: string, operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function findSystemBrowser(): Promise<string | undefined> {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    for (const directory of directories) {
      const path = resolve(directory, name);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, constants.X_OK);
        return path;
      } catch {
        // Keep searching if this entry is missing or cannot be executed.
      }
    }
  }
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.AGENTFRAME_BROWSER_PATH || await findSystemBrowser();
  try {
    return await chromium.launch({ executablePath });
  } catch (error) {
    if (executablePath || !(error instanceof Error)) throw error;
    throw new Error(
      `Cannot launch Playwright Chromium. Install Chromium on PATH, run \`npx playwright install chromium\`, or set AGENTFRAME_BROWSER_PATH.\n${error.message}`,
      { cause: error },
    );
  }
}

export async function openStage(project: Project, { observe, onPageError }: StageOptions = {}): Promise<Stage> {
  const server = await serve(project.dir);
  let browser: Browser | undefined;
  const startupErrors: Error[] = [];
  let javascriptError: Error | undefined;
  const reportPageError = onPageError ?? ((error: Error) => { javascriptError ??= error; });
  const assertHealthy = () => { if (javascriptError) throw javascriptError; };
  const flushStartupErrors = () => startupErrors.splice(0).forEach(reportPageError);
  const close = async () => {
    try { await browser?.close(); } finally { await server.close(); }
  };
  try {
    browser = await launchBrowser();
    const { width, height } = project.output ?? defaultViewport;
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    observe?.(page);
    let initializing = true;
    page.on('pageerror', (error) => {
      if (initializing) startupErrors.push(error);
      else reportPageError(error);
    });
    const load = async (): Promise<PageMetadata> => {
      const response = await page.goto(server.url, { timeout: 10000 });
      if (!response?.ok()) throw new Error('Cannot load composition');
      await page.addScriptTag({ path: pageScript });
      return timed('Page initialization', page.evaluate(async (readMetadata) => {
        await window.ready;
        return readMetadata ? { ...window.output, duration: window.duration } : {};
      }, !project.output));
    };
    let output = resolveOutput(project, await load());
    if (output.width !== width || output.height !== height) {
      await page.setViewportSize({ width: output.width, height: output.height });
      startupErrors.length = 0;
      const reloadedOutput = resolveOutput(project, await load());
      if (reloadedOutput.width !== output.width || reloadedOutput.height !== output.height) {
        throw new Error('Output dimensions changed after loading at the requested size; set width and height in timeline.json');
      }
      output = reloadedOutput;
    }
    flushStartupErrors();
    initializing = false;
    assertHealthy();
    if (!project.output && !await page.evaluate(() => typeof window.seek === 'function')) {
      throw new Error('index.html must define window.seek');
    }
    await timed('Font loading', page.evaluate(() => document.fonts.ready.then(() => undefined)));
    await page.evaluate((clips) => window.__agentframe.bind(clips), project.clips);
    assertHealthy();
    return {
      page, output, close, assertHealthy,
      async seek(seconds, waitForPaint = true) {
        assertHealthy();
        await timed(`Seek at ${seconds}s`, page.evaluate(
          ({ seconds, states, waitForPaint }) => window.__agentframe.seek(seconds, JSON.parse(states), waitForPaint),
          { seconds, states: JSON.stringify(clipStates(project.clips, seconds)), waitForPaint },
        ));
        assertHealthy();
      },
    };
  } catch (error) {
    flushStartupErrors();
    await close();
    throw javascriptError ?? error;
  }
}
