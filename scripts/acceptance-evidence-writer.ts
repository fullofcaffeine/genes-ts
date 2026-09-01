import { strict as assert } from "node:assert";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import path from "node:path";

const maxStateBytes = 192 * 1024;
const maxLogBytes = 8 * 1024 * 1024;
const keyPattern = /^[a-z0-9][a-z0-9-]*$/u;

function fsyncDirectory(directory: string): void {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function publishDurably(temporary: string, target: string, bytes: Buffer): void {
  rmSync(temporary, { force: true });
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, target);
  fsyncDirectory(path.dirname(target));
}

async function readInput(limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    assert(size <= limit, `Evidence input exceeds ${String(limit)} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  assert(value !== undefined && value.length > 0, `Missing ${label}`);
  return value;
}

const operation = requiredArgument(2, "operation");
const reportRoot = path.resolve(requiredArgument(3, "report root"));
const temporaryRoot = path.resolve(process.cwd(), ".tmp");
const reportRelative = path.relative(temporaryRoot, reportRoot);
assert(
  reportRelative.length > 0
    && reportRelative !== ".."
    && !reportRelative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(reportRelative),
  `Evidence report root must be below ${temporaryRoot}`
);

switch (operation) {
  case "reset-report":
    rmSync(reportRoot, { recursive: true, force: true });
    mkdirSync(reportRoot, { recursive: true });
    fsyncDirectory(path.dirname(reportRoot));
    break;
  case "publish-state": {
    mkdirSync(reportRoot, { recursive: true });
    const bytes = await readInput(maxStateBytes);
    assert(bytes.length > 0, "State publication requires JSON bytes");
    JSON.parse(bytes.toString("utf8"));
    publishDurably(
      path.join(reportRoot, ".state.json.tmp"),
      path.join(reportRoot, "state.json"),
      bytes
    );
    break;
  }
  case "publish-log": {
    mkdirSync(reportRoot, { recursive: true });
    const gateId = requiredArgument(4, "gate id");
    assert(keyPattern.test(gateId), `Invalid gate id: ${gateId}`);
    const bytes = await readInput(maxLogBytes);
    const temporary = path.join(reportRoot, `.${gateId}.log.tmp`);
    const target = path.join(reportRoot, `${gateId}.log`);
    publishDurably(temporary, target, bytes);
    break;
  }
  default:
    throw new Error(`Unknown evidence operation: ${operation}`);
}
