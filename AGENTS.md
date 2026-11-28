# AgentFrame

## Develop and verify

- On Nix, enter `nix develop` for Node.js 26, pnpm, FFmpeg/FFprobe, and Chromium. It sets `AGENTFRAME_BROWSER_PATH`. `nix flake check` runs the tests on Node.js 22, 24, and 26. Elsewhere, use Node.js 22.18.0 or newer, FFmpeg with `libx264`, `ffprobe`, and Chromium with H.264 decoding. Playwright uses the explicit browser path first, then a system browser on `PATH`, then its managed Chromium.
- Install with `pnpm install --frozen-lockfile`. Run the local CLI with `node src/cli.ts --help`. `pnpm typecheck` and `pnpm test` do not need a build; tests import or invoke the TypeScript source directly. Keep `.ts` on relative source imports and use erasable TypeScript syntax.
- For a focused test, run `node --test test/project.test.mjs` or `node --test --test-name-pattern="decimal cut" test/project.test.mjs`. The project tests need neither a browser nor FFmpeg. The full suite launches Chromium and generates media fixtures with FFmpeg in temporary directories.
- For packaging changes, run `pnpm build` and smoke-test `node dist/cli.js --help`. npm's `prepack` builds `dist/cli.js` and copies the injected `page.js` beside it. The Nix wrapper runs `src/cli.ts` directly; lockfile changes can also require updating the `fetchPnpmDeps` hash in `nix/package.nix`.

## Runtime boundaries

- `src/project.ts` loads `timeline.json` before Chromium opens, so timeline dimensions apply on the first page load. The timeline takes precedence over HTML metadata and works without `index.html`. HTML-only projects supply `window.duration` and `window.seek`.
- `src/browser.ts` serves the composition on loopback and injects `src/page.js` for clip binding and frame seeking. Browser video is muted; `src/audio.ts` builds the export mix separately. `src/render.ts` streams PNG frames to FFmpeg and aligns range audio to the full project's frame grid.
- `skills/agentframe/SKILL.md` is the shipped composition guide. Check it when changing CLI flags or page hooks. Use snapshot contact sheets and short range renders for visual review; the CLI has no `preview` command.
