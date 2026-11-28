import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type Output = {
  width: number;
  height: number;
  fps: number;
  duration: number;
};
export type PageMetadata = Partial<Output>;
export type Clip = {
  id: string;
  kind: "video" | "audio";
  src: string;
  start: number;
  sourceStart: number;
  duration: number;
  speed: number;
  muted: boolean;
  gain: number;
  fadeIn: number;
  fadeOut: number;
};
export type ClipState =
  | { active: false }
  | { active: true; localTime: number; sourceTime: number };
export type Project = { dir: string; output?: Output; clips: Clip[] };

export const defaultViewport = { width: 1920, height: 1080 };

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string, positive = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (positive && value === 0)
  ) {
    throw new Error(
      `${label} must be a finite ${positive ? "positive" : "non-negative"} number`,
    );
  }
  return value;
}

function fallback(value: unknown, defaultValue: number): unknown {
  return value === undefined ? defaultValue : value;
}

function dimension(value: unknown, label: string): number {
  const size = number(value, label, true);
  if (!Number.isSafeInteger(size) || size % 2 !== 0)
    throw new Error(`${label} must be an even integer`);
  return size;
}

function output(settings: Record<string, unknown>): Output {
  return {
    width: dimension(
      fallback(settings.width, defaultViewport.width),
      "Output width",
    ),
    height: dimension(
      fallback(settings.height, defaultViewport.height),
      "Output height",
    ),
    fps: number(fallback(settings.fps, 30), "Output fps", true),
    duration: number(settings.duration, "Project duration", true),
  };
}

export function inside(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return (
    suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
  );
}

function normalizeClip(
  value: unknown,
  index: number,
  dir: string,
  duration: number,
): Clip {
  const label = `Clip ${index + 1}`;
  const clip = object(value, label);
  const { id, kind, src, muted = false } = clip;
  if (typeof id !== "string" || !id.trim())
    throw new Error(`${label} needs an ID`);
  if (kind !== "video" && kind !== "audio")
    throw new Error(`${label} has invalid kind`);
  if (
    typeof src !== "string" ||
    !src ||
    isAbsolute(src) ||
    /^[a-z][a-z\d+.-]*:/i.test(src) ||
    !inside(dir, resolve(dir, src))
  ) {
    throw new Error(`${label} source must be a local path inside the project`);
  }
  if (typeof muted !== "boolean")
    throw new Error(`${label} muted must be a boolean`);
  const start = number(clip.start, `${label} start`);
  const length = number(clip.duration, `${label} duration`, true);
  if (length > duration - start + Number.EPSILON * duration) {
    throw new Error(`${label} extends past the project duration`);
  }
  return {
    id,
    kind,
    src,
    muted,
    start,
    duration: length,
    sourceStart: number(fallback(clip.sourceStart, 0), `${label} sourceStart`),
    speed: number(fallback(clip.speed, 1), `${label} speed`, true),
    gain: number(fallback(clip.gain, 1), `${label} gain`),
    fadeIn: number(fallback(clip.fadeIn, 0), `${label} fadeIn`),
    fadeOut: number(fallback(clip.fadeOut, 0), `${label} fadeOut`),
  };
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function loadProject(path: string): Promise<Project> {
  const dir = await realpath(path);
  const hasHtml = await stat(resolve(dir, "index.html")).then(
    (file) => file.isFile(),
    (error) => {
      if (missing(error)) return false;
      throw error;
    },
  );
  if (!hasHtml) throw new Error("Project requires index.html");
  const json = await readFile(resolve(dir, "timeline.json"), "utf8").catch(
    (error: unknown) => {
      if (missing(error)) return undefined;
      throw error;
    },
  );
  if (json === undefined) return { dir, clips: [] };
  const timeline = object(JSON.parse(json), "Timeline");
  const settings = output(timeline);
  if (!Array.isArray(timeline.clips))
    throw new Error("Timeline clips must be an array");
  const clips = timeline.clips.map((value, index) =>
    normalizeClip(value, index, dir, settings.duration),
  );
  if (new Set(clips.map(({ id }) => id)).size !== clips.length)
    throw new Error("Duplicate clip ID");
  return { dir, output: settings, clips };
}

export function resolveOutput(
  project: Project,
  page: PageMetadata = {},
): Output {
  return project.output ?? output(page);
}

export function clipStates(
  clips: Clip[],
  seconds: number,
): Record<string, ClipState> {
  return Object.fromEntries(
    clips.map((clip) => {
      const end = clip.start + clip.duration;
      // Treat rounding noise around a cut as the boundary itself.
      const tolerance = Math.min(
        clip.duration / 4,
        Number.EPSILON * Math.max(end, seconds),
      );
      const offset = seconds - clip.start;
      if (offset < -tolerance || end - seconds <= tolerance)
        return [clip.id, { active: false }];
      const localTime = Math.abs(offset) <= tolerance ? 0 : offset;
      return [
        clip.id,
        {
          active: true,
          localTime,
          sourceTime: clip.sourceStart + localTime * clip.speed,
        },
      ];
    }),
  );
}
