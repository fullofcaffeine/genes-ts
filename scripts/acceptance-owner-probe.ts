import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const mode = process.argv[2];

function stayAlive(): void {
  setInterval(() => {}, 60_000);
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
    stayAlive();
    break;
  case "child":
    process.stdout.write(`probe:child:${String(process.pid)}\n`);
    spawn(process.execPath, [script, "grandchild"], { stdio: "inherit" });
    stayAlive();
    break;
  case "parent":
    process.stdout.write(`probe:parent:${String(process.pid)}\n`);
    spawn(process.execPath, [script, "child"], { stdio: "inherit" });
    stayAlive();
    break;
  case "bystander":
    stayAlive();
    break;
  default:
    throw new Error(`Unknown acceptance owner probe mode: ${String(mode)}`);
}
