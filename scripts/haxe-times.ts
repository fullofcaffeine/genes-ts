export interface HaxeTimingRow {
  readonly name: string;
  readonly id: string;
  readonly path: string;
  readonly depth: number;
  readonly seconds: number;
  readonly percentOfTotal: number;
  readonly percentOfParent: number;
  readonly count: number;
  readonly info: string | null;
}

const timingRow = /^(\s*)([^|]*?\S)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+)\s*\|\s*([0-9]+)\s*\|\s*([0-9]+)\s*\|\s*(.*?)\s*$/;

/**
 * Converts Haxe's `--times` table into exact, machine-readable rows.
 *
 * Why: Haxe owns parsing, typing, DCE, macro execution, and the outer custom
 * generator timer. Genes adds request-local child timers through
 * `Context.timer`. Parsing that one authoritative table avoids a second clock
 * inside the compiler and keeps ordinary builds free of profiling output.
 *
 * What/How: indentation reconstructs Haxe's timer tree. Haxe prints dotted
 * custom timer IDs as a leaf name plus an `info` namespace, so `id` joins those
 * fields back into the original stable identifier. Unknown rows remain in the
 * result instead of being silently discarded when Haxe adds a phase.
 */
export function parseHaxeTimes(output: string): ReadonlyArray<HaxeTimingRow> {
  const parents: string[] = [];
  const rows: HaxeTimingRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = timingRow.exec(line);
    if (match === null) continue;
    const leading = match[1] ?? "";
    if (leading.length % 2 !== 0) {
      throw new Error(
        `Haxe timing row has unsupported indentation: ${JSON.stringify(line)}`
      );
    }
    const name = match[2] ?? "";
    const depth = leading.length / 2;
    const info = (match[7] ?? "").trim();
    const id = info.length === 0 ? name : `${info}.${name}`;
    parents.length = depth;
    const path = [...parents, id].join("/");
    parents[depth] = id;
    rows.push({
      name,
      id,
      path,
      depth,
      seconds: Number(match[3]),
      percentOfTotal: Number(match[4]),
      percentOfParent: Number(match[5]),
      count: Number(match[6]),
      info: info.length === 0 ? null : info
    });
  }
  if (!rows.some((row) => row.id === "total" && row.depth === 0)) {
    throw new Error("Haxe --times output did not contain a total row");
  }
  return rows;
}
