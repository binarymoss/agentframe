# AgentFrame

- Before handing off changes, run `nix fmt` and `nix flake check`. `nix fmt` formats Nix files; the flake check also runs Biome and checks Node.js 22, 24, and 26.
- Use `nix develop` and `pnpm install --frozen-lockfile` for local development. Run the CLI with `node src/cli.ts`; for a browser-free test, use `node --test test/project.test.mjs`. Keep `.ts` imports and erasable TypeScript syntax: Nix runs the source directly, while npm ships `dist/`.
- Without Nix, use Node.js 22.18.0+, pnpm, Biome, FFmpeg with `libx264`, FFprobe, and Chromium with H.264 decoding. Set `AGENTFRAME_BROWSER_PATH` if Chromium is not on `PATH`. After installing dependencies, run `biome format .`, `biome lint .`, `pnpm typecheck`, and `pnpm test`.
- Compositions require `index.html`, even when they have a timeline. For CLI flags and page hooks, see `skills/agentframe/SKILL.md`.
