import { renderGeneratedAudio } from "./audio.ts";
import { openStage, timed } from "./browser.ts";
import type { Stage } from "./browser.ts";
import { assetPath, probeMedia } from "./media.ts";
import type { Project } from "./project.ts";

type Finding = {
  code: string;
  message: string;
  path?: string;
  clipId?: string;
  time?: number;
};
export type CheckReport = {
  ok: boolean;
  sampledTimes: number[];
  findings: Finding[];
};

export async function checkMedia(project: Project): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const clip of project.clips) {
    const details = { path: clip.src, clipId: clip.id };
    try {
      const media = await probeMedia(await assetPath(project.dir, clip.src));
      if (media[clip.kind] === undefined)
        throw new Error(`Missing ${clip.kind} stream`);
      const streams =
        clip.kind === "video" &&
        !clip.muted &&
        clip.gain > 0 &&
        media.audio !== undefined
          ? (["video", "audio"] as const)
          : [clip.kind];
      const end = clip.sourceStart + clip.duration * clip.speed;
      for (const stream of streams) {
        const duration = media[stream];
        if (
          duration !== undefined &&
          Number.isFinite(duration) &&
          end > duration + 1e-6
        ) {
          findings.push({
            code: "clip_range",
            message: `Source end ${end}s exceeds ${stream} stream duration ${duration}s`,
            ...details,
          });
        }
      }
    } catch (error) {
      findings.push({
        code: "asset",
        message: `Cannot read asset: ${String(error)}`,
        ...details,
      });
    }
  }
  return findings;
}

export async function check(project: Project): Promise<CheckReport> {
  const findings = await checkMedia(project);
  const sampledTimes: number[] = [];
  let time: number | undefined;
  let stage: Stage | undefined;
  try {
    stage = await openStage(project, {
      onPageError: (error) =>
        findings.push({ code: "javascript", message: error.message, time }),
      observe: (page) => {
        page.on("requestfailed", (request) => {
          if (request.failure()?.errorText !== "net::ERR_ABORTED") {
            findings.push({
              code: "asset",
              message: "Resource request failed",
              path: request.url(),
              time,
            });
          }
        });
        page.on("response", (response) => {
          if (response.status() >= 400) {
            findings.push({
              code: "asset",
              message: `HTTP ${response.status()}`,
              path: response.url(),
              time,
            });
          }
        });
      },
    });
    try {
      await renderGeneratedAudio(stage);
    } catch (error) {
      findings.push({ code: "audio", message: String(error) });
    }
    const { duration } = stage.output;
    const boundaries = project.clips.flatMap(({ start, duration }) => [
      start,
      start + duration,
    ]);
    const samples = Array.from(
      { length: 9 },
      (_, index) => (duration * (index + 0.5)) / 9,
    );
    const times = [...new Set([0, ...boundaries, ...samples])].filter(
      (value) => value < duration,
    );
    for (time of times.sort((a, b) => a - b)) {
      sampledTimes.push(time);
      try {
        await stage.seek(time);
      } catch (error) {
        findings.push({ code: "seek", message: String(error), time });
        if (String(error).includes("timed out")) break;
      }
    }
  } catch (error) {
    findings.push({ code: "browser", message: String(error), time });
  } finally {
    await stage?.close();
  }
  return { ok: findings.length === 0, sampledTimes, findings };
}

export async function validateDecode(stage: Stage): Promise<void> {
  await timed(
    "Video decode",
    stage.page.evaluate(() => window.__agentframe.validate()),
  );
}
