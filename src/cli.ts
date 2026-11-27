#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { openStage } from './browser.ts';
import { check } from './check.ts';
import type { CheckReport } from './check.ts';
import { loadProject } from './project.ts';
import { render } from './render.ts';
import { snapshot } from './snapshot.ts';

const helpOption = { type: 'boolean', short: 'h' } as const;
const help = {
  main: `Usage: agentframe <command> [options]

Commands:
  check     Check a project for errors
  snapshot  Capture frames as PNG images
  render    Export a project to MP4

Options:
  -h, --help  Show this help

Run \`agentframe <command> --help\` for command options.`,
  check: `Usage: agentframe check [dir] [options]

Options:
      --json  Print findings as JSON
  -h, --help  Show this help

If omitted, dir defaults to the current directory.`,
  snapshot: `Usage: agentframe snapshot [dir] --at <seconds[,seconds]> [options]

Options:
      --at <seconds[,seconds]>    Frame times in seconds (required)
      --zoom <selector|x,y,w,h>   Crop to a CSS selector or a rectangle in pixels
      --sheet                     Also write a labeled contact sheet
  -o, --output <dir>              Output directory (default: snapshots)
  -h, --help                      Show this help

Example: agentframe snapshot . --at 0.5,1.2 --sheet`,
  render: `Usage: agentframe render [dir] -o <file.mp4> [options]

Options:
  -o, --output <file.mp4>  Output path (required)
      --range <start,end>  Export a range in project seconds
  -h, --help               Show this help

Example: agentframe render . --range 0.5,2.5 -o review.mp4`,
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(help.main);
    return;
  }
  if (command === 'render') {
    const { positionals, values } = parseArgs({
      args, allowPositionals: true,
      options: { range: { type: 'string' }, output: { type: 'string', short: 'o' }, help: helpOption },
    });
    if (values.help) {
      console.log(help.render);
      return;
    }
    if (positionals.length > 1 || !values.output) throw new Error('Specify an output path with -o');
    let range;
    if (values.range !== undefined) {
      const parts = values.range.split(',');
      if (parts.length !== 2 || parts.some((value) => !value.trim())) throw new Error('Use --range start,end');
      range = { start: Number(parts[0]), end: Number(parts[1]) };
    }
    await render(await loadProject(positionals[0] ?? '.'), values.output, range);
    return;
  }
  if (command === 'check') {
    const { positionals, values } = parseArgs({
      args, allowPositionals: true, options: { json: { type: 'boolean' }, help: helpOption },
    });
    if (values.help) {
      console.log(help.check);
      return;
    }
    if (positionals.length > 1) throw new Error('Expected one project directory');
    const report = await loadProject(positionals[0] ?? '.').then(check, (error: unknown): CheckReport => ({
      ok: false,
      sampledTimes: [],
      findings: [{ code: 'project', message: error instanceof Error ? error.message : String(error) }],
    }));
    if (values.json) console.log(JSON.stringify(report));
    else if (report.ok) console.log('Project check passed');
    else for (const finding of report.findings) console.error(
      `${finding.clipId ?? finding.path ?? finding.code}: ${finding.message}${finding.time === undefined ? '' : ` at ${finding.time}s`}`,
    );
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  if (command !== 'snapshot') throw new Error(`Unknown command: ${command}`);
  const { positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: {
      at: { type: 'string' }, zoom: { type: 'string' },
      sheet: { type: 'boolean' },
      output: { type: 'string', short: 'o', default: 'snapshots' },
      help: helpOption,
    },
  });
  if (values.help) {
    console.log(help.snapshot);
    return;
  }
  if (positionals.length > 1 || !values.at || values.at.split(',').some((value) => !value.trim())) {
    throw new Error('Specify snapshot timestamps with --at');
  }
  const project = await loadProject(positionals[0] ?? '.');
  const stage = await openStage(project);
  try {
    const paths = await snapshot(stage, values.at.split(',').map(Number), values.output, values.zoom, values.sheet);
    console.log(paths.join('\n'));
  } finally {
    await stage.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
