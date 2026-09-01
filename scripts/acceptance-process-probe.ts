import { readdirSync, readFileSync } from "node:fs";

const operation = process.argv[2];
const rawPid = process.argv[3];
const pid = Number(rawPid);

if (process.env.GENES_ACCEPTANCE_PROBE_STALL === "1") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 60_000);
} else if ((operation !== "--group" && operation !== "--pid")
  || !Number.isSafeInteger(pid)
  || pid <= 0) {
  process.exitCode = 2;
} else if (process.platform === "linux") {
  const stateAndGroup = (candidate: number): {
    readonly state: string;
    readonly group: number;
  } | null => {
    try {
      const stat = readFileSync(`/proc/${String(candidate)}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) return null;
      const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u);
      const state = fields[0];
      const group = Number(fields[2]);
      return state === undefined || !Number.isSafeInteger(group)
        ? null
        : { state, group };
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error
        && (error.code === "ENOENT" || error.code === "ESRCH")) return null;
      throw error;
    }
  };

  try {
    if (operation === "--pid") {
      const processState = stateAndGroup(pid);
      process.exitCode = processState !== null && processState.state !== "Z" ? 1 : 0;
    } else {
      let live = false;
      let member = false;
      for (const entry of readdirSync("/proc", { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
        const processState = stateAndGroup(Number(entry.name));
        if (processState?.group === pid) {
          member = true;
          if (processState.state !== "Z") {
            live = true;
            break;
          }
        }
      }
      process.exitCode = live ? 1 : member ? 3 : 0;
    }
  } catch {
    process.exitCode = 2;
  }
} else if (process.platform === "win32") {
  process.exitCode = 2;
} else {
  try {
    process.kill(operation === "--group" ? -pid : pid, 0);
    process.exitCode = 1;
  } catch (error: unknown) {
    process.exitCode = error instanceof Error && "code" in error && error.code === "ESRCH"
      ? 0
      : 2;
  }
}
