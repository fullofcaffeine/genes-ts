import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  INSTALLED_PACKAGE_RESOLUTION_PROFILE,
  InstalledPackageClosureError,
  type InstalledPackageClosureLimits,
} from "./installed-package-closure.js";
import {
  executeAdmittedProcessor,
  ProcessorExecutionAdmissionError,
  type AdmittedProcessorExecutionResult,
  type ProcessorExecutionData,
  type ProcessorExecutionLimits,
} from "./processor-execution-admission.js";
import { cssModuleFailure } from "./error.js";

const CLOSURE_LIMITS: InstalledPackageClosureLimits = Object.freeze({
  maxPackages: 64,
  maxEdges: 256,
  maxEntries: 8192,
  maxFiles: 2048,
  maxBytes: 32 * 1024 * 1024,
  maxPathBytes: 4096,
});
const EXECUTION_LIMITS: ProcessorExecutionLimits = Object.freeze({
  maxRequestBytes: 16 * 1024 * 1024,
  maxResultBytes: 8 * 1024 * 1024,
  timeoutMs: 60_000,
});

interface PackagedAdapterRequest {
  readonly adapterDirectory: URL;
  readonly adapterPackageName: string;
  readonly adapterVersion: string;
  readonly input: ProcessorExecutionData;
  readonly providerKind: string;
  readonly subject: string;
}

function executionFailure(message: string, subject: string): never {
  return cssModuleFailure("GENES-CSS-MODULE-PROVIDER-016", message, subject);
}

function packageLink(root: string, packageName: string): string {
  return path.join(root, "node_modules", ...packageName.split("/"));
}

/** Executes a package-owned fixed adapter and removes its temporary resolver anchor. */
export async function executePackagedProviderAdapter(
  request: PackagedAdapterRequest,
): Promise<AdmittedProcessorExecutionResult> {
  let anchorRoot: string | undefined;
  try {
    anchorRoot = realpathSync.native(
      mkdtempSync(path.join(realpathSync.native(tmpdir()), "genes-provider-adapter-")),
    );
    const link = packageLink(anchorRoot, request.adapterPackageName);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(
      realpathSync.native(fileURLToPath(request.adapterDirectory)),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    writeFileSync(path.join(anchorRoot, "anchor.mjs"), "export {};\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    if (anchorRoot !== undefined) {
      try {
        rmSync(anchorRoot, { recursive: true, force: true });
      } catch {
        // The stable setup failure below remains authoritative.
      }
    }
    return executionFailure(
      "The fixed CSS Module provider adapter could not be prepared.",
      request.subject,
    );
  }

  const preparedRoot = anchorRoot;

  try {
    return await executeAdmittedProcessor({
      adapterPackageName: request.adapterPackageName,
      closure: {
        providerKind: request.providerKind,
        resolutionProfile: INSTALLED_PACKAGE_RESOLUTION_PROFILE,
        resolutionBaseUrl: pathToFileURL(path.join(preparedRoot, "anchor.mjs")).href,
        roots: Object.freeze([
          Object.freeze({
            packageName: request.adapterPackageName,
            expectedVersion: request.adapterVersion,
          }),
        ]),
        limits: CLOSURE_LIMITS,
      },
      input: request.input,
      limits: EXECUTION_LIMITS,
    });
  } catch (error) {
    if (
      error instanceof ProcessorExecutionAdmissionError ||
      error instanceof InstalledPackageClosureError
    ) {
      if (
        error instanceof ProcessorExecutionAdmissionError &&
        error.code === "execution-runtime-unsupported"
      ) {
        return executionFailure(
          "Measured provider execution requires Node 22.22 or newer, or Node 24.10 or newer.",
          request.subject,
        );
      }
      return executionFailure(
        `The fixed provider package closure was not admitted (${error.code}).`,
        request.subject,
      );
    }
    return executionFailure(
      "The fixed CSS Module provider adapter failed.",
      request.subject,
    );
  } finally {
    try {
      rmSync(preparedRoot, { recursive: true, force: true });
    } catch {
      return executionFailure(
        "The fixed CSS Module provider adapter could not be cleaned up.",
        request.subject,
      );
    }
  }
}
