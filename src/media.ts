import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { inside } from './project.ts';

const exec = promisify(execFile);
export type MediaInfo = { video?: number; audio?: number };

export async function assetPath(dir: string, src: string): Promise<string> {
  const path = await realpath(resolve(dir, src));
  if (!inside(dir, path)) throw new Error('Asset resolves outside the project');
  return path;
}

export async function probeMedia(path: string): Promise<MediaInfo> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], {
    timeout: 10000,
  });
  const { streams, format } = JSON.parse(stdout);
  const result: MediaInfo = {};
  for (const kind of ['video', 'audio'] as const) {
    const stream = streams.find((entry: { codec_type: string }) => entry.codec_type === kind);
    if (stream) result[kind] = Number(stream.duration || format?.duration);
  }
  return result;
}

export async function runFfmpeg(args: string[], frames?: AsyncIterable<Buffer>): Promise<void> {
  const encoding = exec('ffmpeg', ['-nostdin', '-v', 'error', ...args]);
  if (!frames) {
    await encoding;
    return;
  }

  const stdin = encoding.child.stdin!;
  const write = promisify((frame: Buffer, callback: (error?: Error | null) => void) => {
    stdin.write(frame, callback);
  });
  // The write callback handles pipe errors. Keep the process result for FFmpeg's stderr.
  stdin.on('error', () => {});
  const result = encoding.then(() => undefined, (error: unknown) => ({ error }));
  try {
    for await (const frame of frames) {
      await write(frame).catch(async (error: unknown) => {
        const failure = await result;
        throw failure ? failure.error : error;
      });
    }
    stdin.end();
  } catch (error) {
    stdin.destroy();
    encoding.child.kill();
    await result;
    throw error;
  }
  await encoding;
}
