import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AcceptanceInterruptedError,
  AcceptanceProcessOwner
} from "./acceptance-process-owner.js";

const script = fileURLToPath(import.meta.url);
const mode = process.argv[2];

function stayAlive(): void {
  setInterval(() => {}, 60_000);
}

function resistGracefulTermination(): void {
  process.on("SIGTERM", () => {
    // Keep the tree alive until the owner proves its SIGKILL escalation.
  });
}

function spawnOwnedDescendant(mode: "child" | "grandchild"): void {
  spawn(process.execPath, [script, mode], {
    stdio: "inherit",
    // The acceptance owner marks gates that already have a private process
    // group. Nested repository processes must remain in that owned group.
    detached: process.platform !== "win32"
      && process.env.GENES_ACCEPTANCE_PROCESS_OWNER !== "1"
  });
}

switch (mode) {
  case "healthy":
    process.stdout.write("probe:healthy\n");
    break;
  case "failure":
    process.stderr.write("probe:failure\n");
    process.exitCode = 7;
    break;
  case "grandchild":
    process.stdout.write(`probe:grandchild:${String(process.pid)}\n`);
    resistGracefulTermination();
    stayAlive();
    break;
  case "child":
    process.stdout.write(`probe:child:${String(process.pid)}\n`);
    resistGracefulTermination();
    spawnOwnedDescendant("grandchild");
    stayAlive();
    break;
  case "parent":
    process.stdout.write(`probe:parent:${String(process.pid)}\n`);
    resistGracefulTermination();
    spawnOwnedDescendant("child");
    stayAlive();
    break;
  case "bystander":
    stayAlive();
    break;
  case "owner": {
    const reportRoot = process.argv[3];
    if (reportRoot === undefined) throw new Error("Owner probe requires a report root");
    const owner = new AcceptanceProcessOwner({
      cwd: process.cwd(),
      reportRoot,
      timeoutMs: 60_000,
      terminationGraceMs: 500
    });
    try {
      await owner.run({
        id: "signal-tree",
        command: process.execPath,
        args: [script, "parent"]
      });
    } catch (error) {
      if (!(error instanceof AcceptanceInterruptedError)) throw error;
      process.exitCode = error.exitCode;
    }
    break;
  }
  default:
    throw new Error(`Unknown acceptance owner probe mode: ${String(mode)}`);
}
