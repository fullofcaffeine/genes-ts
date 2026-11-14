#!/usr/bin/env node
// Measures how fast a warm Haxe compilation server can answer a one-file edit
// when Genes does little or no generation work.
//
// Why: incremental generation (docs/INCREMENTAL_GENERATION_DESIGN.md) can
// remove Genes work for unchanged modules, but it cannot remove Haxe's own
// work: finding changed files, typing them again, running filters and
// dead-code elimination, and calling the generator. This script measures that
// lower limit ("the floor") on any project, so a design can state the best
// time it can reach before anybody writes the cache.
//
// What it does: for each mode it starts one private `haxe --wait` server,
// sends one cold request, then repeats: change one string in one source file,
// send the request, record the time. Modes:
//
//   typing    --no-output. Haxe types, filters and runs dead-code
//             elimination. The generator is not called.
//   callback  Genes' generator is called and returns immediately
//             (GenerationFloorProbe mode `callback-noop`).
//   scan      Genes visits each typed declaration once and writes nothing
//             (GenerationFloorProbe mode `structure-scan`).
//   full      Ordinary Genes generation, as today.
//
// Each sample also records how many type declarations Haxe typed again. A
// small macro that this script writes into a temporary folder counts them: it
// marks each declaration the first time it sees it, and a declaration that
// Haxe typed again arrives without the mark.
//
// Limits: wall time depends on other work on the machine. The record keeps
// the load average for each sample and the server's own CPU time, which
// depends less on load. The script labels the run `diagnostic` when the
// 1-minute load is above 2.0 at any sample. It never edits a file outside
// `--project`, and it restores the edited file when it stops.
//
// Example:
//   node scripts/measure-warm-edit-floor.mjs \
//     --project /tmp/app-copy --haxe ~/haxe/versions/4.3.7/haxe \
//     --edit src/app/Label.hx --from '"device"' --to '"device2"' \
//     --modes typing,callback --samples 5 --out /tmp/floor.json \
//     --label 'genes a6f8a9d4, unchanged' \
//     -- resolved.hxml

import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync} from 'node:fs';
import {createServer, connect} from 'node:net';
import {loadavg, tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

const QUIET_LOAD = 2.0;
const FORBIDDEN_PORTS = new Set([5174]);

const PROBE_SOURCE = `
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;

/** Counts declarations that Haxe typed again since the previous request. */
class WarmEditRetypeProbe {
  public static function install(report: String) {
    Context.onGenerate(types -> {
      var total = 0;
      var fresh = 0;
      final freshModules = new Map<String, Bool>();
      final allModules = new Map<String, Bool>();
      final pos = Context.currentPos();
      for (type in types) {
        final base: Null<BaseType> = switch type {
          case TInst(r, _): r.get();
          case TEnum(r, _): r.get();
          case TType(r, _): r.get();
          case TAbstract(r, _): r.get();
          default: null;
        }
        if (base == null)
          continue;
        total++;
        allModules.set(base.module, true);
        if (!base.meta.has(':warmEditFloor.seen')) {
          fresh++;
          freshModules.set(base.module, true);
          base.meta.add(':warmEditFloor.seen', [], pos);
        }
      }
      sys.io.File.saveContent(report, haxe.Json.stringify({
        declarations: total,
        retypedDeclarations: fresh,
        modules: Lambda.count(allModules),
        retypedModules: Lambda.count(freshModules),
        // Names help to find why Haxe typed a module again. A cold request
        // types every module, so the list would say nothing there.
        retypedModuleNames: fresh == total ? [] : {
          final names = [for (name in freshModules.keys()) name];
          names.sort(Reflect.compare);
          names;
        }
      }));
    });
  }
}
`;

function parseArguments(argv) {
  const options = {modes: 'typing,callback', samples: '5', nice: '10'};
  const haxeArguments = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--') {
      haxeArguments.push(...argv.slice(index + 1));
      break;
    }
    if (!argument.startsWith('--') || index + 1 >= argv.length)
      throw new Error(`Unexpected argument: ${argument}`);
    options[argument.slice(2)] = argv[++index];
  }
  for (const name of ['project', 'haxe', 'edit', 'from', 'to', 'out'])
    if (options[name] == null)
      throw new Error(`Missing --${name}`);
  if (haxeArguments.length === 0)
    throw new Error('Give the Haxe arguments after `--`.');
  return {options, haxeArguments};
}

function unusedPort() {
  return new Promise((accept, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => FORBIDDEN_PORTS.has(port) ? unusedPort().then(accept, reject) : accept(port));
    });
  });
}

function waitForPort(port, deadline) {
  return new Promise((accept, reject) => {
    const attempt = () => {
      const socket = connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        accept();
      });
      socket.on('error', () => {
        if (Date.now() > deadline)
          reject(new Error('The Haxe server did not open its port.'));
        else
          setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

/** Reads CPU seconds and resident memory of one process from `ps`. */
function processUsage(pid) {
  const result = spawnSync('ps', ['-o', 'time=,rss=', '-p', String(pid)], {encoding: 'utf8'});
  const match = /(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+(\d+)/u.exec(result.stdout);
  if (match == null)
    return {cpuSeconds: null, rssMegabytes: null};
  const cpuSeconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return {cpuSeconds, rssMegabytes: Math.round(Number(match[4]) / 1024)};
}

function modeArguments(mode, floorReport) {
  switch (mode) {
    case 'typing':
      return ['--no-output'];
    case 'callback':
    case 'scan':
      return [
        '-D', 'genes_generation_floor',
        '-D', `genes_generation_floor_mode=${mode === 'scan' ? 'structure-scan' : 'callback-noop'}`,
        '-D', `genes_generation_floor_report=${floorReport}`
      ];
    case 'full':
      return [];
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}

/** Returns the median of the numeric values, or null when there is none. */
function median(values) {
  const sorted = values.filter(value => typeof value === 'number').sort((a, b) => a - b);
  if (sorted.length === 0)
    return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function measureMode(mode, context) {
  const {options, haxeArguments, project, haxe, scratch, original, edited} = context;
  const editPath = join(project, options.edit);
  const retypeReport = join(scratch, `retype-${mode}.json`);
  const requestArguments = [
    ...haxeArguments,
    '-cp', scratch,
    '--macro', `WarmEditRetypeProbe.install('${retypeReport}')`,
    ...modeArguments(mode, join(scratch, `floor-${mode}.json`))
  ];
  const port = await unusedPort();
  const server = spawn('nice', ['-n', options.nice, haxe, '--wait', String(port)],
    {cwd: project, stdio: ['ignore', 'ignore', 'inherit']});
  // `nice` replaces itself with haxe, so this pid is the server.
  const samples = [];
  let fileTime = Math.floor(Date.now() / 1000) + 10;
  const put = text => {
    writeFileSync(editPath, text);
    // Haxe 4.3.7 compares file times at one-second precision. Each edit gets
    // its own second, so the server cannot miss one.
    fileTime += 2;
    utimesSync(editPath, fileTime, fileTime);
  };
  const request = phase => {
    // Remove the last report, so a request that does not reach the probe
    // cannot be counted with the numbers of the request before it.
    rmSync(retypeReport, {force: true});
    const before = processUsage(server.pid);
    const start = performance.now();
    const result = spawnSync(haxe, ['--connect', String(port), ...requestArguments],
      {cwd: project, encoding: 'utf8'});
    const wallMs = Math.round(performance.now() - start);
    const after = processUsage(server.pid);
    if (result.status !== 0)
      throw new Error(`Haxe failed in mode ${mode} (${phase}):\n${result.stderr}`);
    const retype = existsSync(retypeReport) ? JSON.parse(readFileSync(retypeReport, 'utf8')) : null;
    const sample = {
      mode, phase, wallMs,
      serverCpuMs: before.cpuSeconds == null || after.cpuSeconds == null
        ? null : Math.round((after.cpuSeconds - before.cpuSeconds) * 1000),
      serverRssMegabytes: after.rssMegabytes,
      load1: Number(loadavg()[0].toFixed(2)),
      ...retype
    };
    samples.push(sample);
    console.error(JSON.stringify({...sample, retypedModuleNames: undefined}));
    return sample;
  };
  try {
    await waitForPort(port, Date.now() + 30_000);
    put(original);
    request('cold');
    request('no-edit');
    for (let index = 0; index < Number(options.samples); index++) {
      put(index % 2 === 0 ? edited : original);
      request('edit');
    }
  } finally {
    server.kill('SIGTERM');
    writeFileSync(editPath, original);
  }
  return samples;
}

async function main() {
  const {options, haxeArguments} = parseArguments(process.argv.slice(2));
  const project = resolve(options.project);
  const haxe = resolve(options.haxe);
  const original = readFileSync(join(project, options.edit), 'utf8');
  if (original.split(options.from).length !== 2)
    throw new Error('--from must occur exactly once in the edited file.');
  const edited = original.replace(options.from, options.to);
  const scratch = mkdtempSync(join(tmpdir(), 'genes-warm-edit-floor-'));
  writeFileSync(join(scratch, 'WarmEditRetypeProbe.hx'), PROBE_SOURCE);
  const context = {options, haxeArguments, project, haxe, scratch, original, edited};
  const samples = [];
  try {
    for (const mode of options.modes.split(','))
      samples.push(...await measureMode(mode, context));
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
  const summary = {};
  for (const mode of options.modes.split(',')) {
    const edits = samples.filter(sample => sample.mode === mode && sample.phase === 'edit');
    const cold = samples.find(sample => sample.mode === mode && sample.phase === 'cold');
    summary[mode] = {
      coldWallMs: cold.wallMs,
      coldServerCpuMs: cold.serverCpuMs,
      editWallMsMedian: median(edits.map(sample => sample.wallMs)),
      editWallMsMin: Math.min(...edits.map(sample => sample.wallMs)),
      editWallMsMax: Math.max(...edits.map(sample => sample.wallMs)),
      editServerCpuMsMedian: median(edits.map(sample => sample.serverCpuMs)),
      retypedModulesMedian: median(edits.map(sample => sample.retypedModules)),
      modules: edits[0].modules,
      serverRssMegabytesMax: Math.max(...samples.filter(sample => sample.mode === mode)
        .map(sample => sample.serverRssMegabytes))
    };
  }
  const maxLoad = Math.max(...samples.map(sample => sample.load1));
  const report = {
    schemaVersion: 1,
    evidence: maxLoad > QUIET_LOAD ? 'diagnostic' : 'quiet',
    quietLoadLimit: QUIET_LOAD,
    maxLoad1: maxLoad,
    haxeVersion: spawnSync(haxe, ['--version'], {encoding: 'utf8'}).stdout.trim(),
    edit: {path: options.edit, from: options.from, to: options.to},
    nice: Number(options.nice),
    // Free text that says what was measured, for example the Genes revision
    // and whether a scratch copy of the compiler was used.
    label: options.label ?? null,
    haxeArguments,
    summary,
    samples
  };
  writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({evidence: report.evidence, maxLoad1: maxLoad, summary}, null, 2));
}

main().catch(error => {
  console.error(error.stack ?? String(error));
  process.exit(1);
});
