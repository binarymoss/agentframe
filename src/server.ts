import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { inside } from "./project.ts";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export async function serve(dir: string) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      const path = await realpath(
        resolve(dir, `.${pathname === "/" ? "/index.html" : pathname}`),
      );
      if (!inside(dir, path)) throw new Error("Outside project");
      const file = await stat(path);
      if (!file.isFile()) throw new Error("Not a file");
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2]
        ? Math.min(Number(match[2]), file.size - 1)
        : file.size - 1;
      if (req.headers.range && (!match || start > end)) {
        res.writeHead(416, { "Content-Range": `bytes */${file.size}` }).end();
        return;
      }
      res.writeHead(match ? 206 : 200, {
        "Content-Type":
          mime[extname(path).toLowerCase()] ?? "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        ...(match && { "Content-Range": `bytes ${start}-${end}/${file.size}` }),
      });
      if (req.method === "HEAD" || file.size === 0) res.end();
      else
        createReadStream(path, { start, end })
          .on("error", () => res.destroy())
          .pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot determine local server address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
