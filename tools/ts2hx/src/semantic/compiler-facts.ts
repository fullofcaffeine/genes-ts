import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "../typescript-api.js";

type PackageIdentity = {
  readonly package: string;
  readonly version: string;
};

export type TypeScriptCompilerFacts = {
  readonly typescriptBridge: PackageIdentity;
  readonly typescriptEngine: PackageIdentity;
  readonly optionsHash: string;
};

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

const require = createRequire(import.meta.url);

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
  return value;
}

function bridgeIdentity(): PackageIdentity {
  // Package metadata is an inherently untyped Node boundary. Validate the two
  // scalar fields immediately and expose no unchecked JSON to compiler code.
  const parsed: unknown = JSON.parse(
    readFileSync(require.resolve("typescript/package.json"), "utf8")
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The TypeScript bridge package metadata must be an object");
  }
  const record = parsed as Record<string, unknown>;
  return {
    package: nonEmptyString(record.name, "TypeScript bridge package name"),
    version: nonEmptyString(record.version, "TypeScript bridge package version")
  };
}

function portableProjectPath(projectDir: string, value: string): string {
  if (!path.isAbsolute(value)) return value;
  const relative = path.relative(projectDir, value).split(path.sep).join("/");
  return relative.length === 0 ? "." : relative;
}

function canonicalize(
  value: unknown,
  projectDir: string,
  seen: WeakSet<object>
): CanonicalJson | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return portableProjectPath(projectDir, value);
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .map(entry => canonicalize(entry, projectDir, seen))
        .filter((entry): entry is CanonicalJson => entry !== undefined);
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
      // TypeScript stores its parsed tsconfig SourceFile here. It is a cyclic
      // implementation object, not an effective compiler option.
      if (key === "configFile") continue;
      const normalized = canonicalize(record[key], projectDir, seen);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/**
 * Captures the exact compiler identity behind one effective-request plan.
 *
 * Why: the installed TS6 wrapper and the JavaScript engine to which it
 * delegates have independent versions. Recording only the wrapper made a
 * manifest unable to explain which import-elision behavior it observed.
 *
 * What: manifests receive both package identities plus a deterministic hash of
 * effective compiler options. Absolute option paths become project-relative,
 * and the cyclic parsed-config SourceFile is excluded.
 *
 * How: the bridge identity comes from Node package metadata, while `ts.version`
 * names the engine actually executing the Program API. The hash covers the
 * original configured options, including output-control flags; an in-memory
 * evidence emit may disable those flags without rewriting this source fact.
 */
export function typeScriptCompilerFacts(
  program: ts.Program,
  projectDir: string
): TypeScriptCompilerFacts {
  const normalized = canonicalize(program.getCompilerOptions(), projectDir, new WeakSet());
  if (normalized === undefined) {
    throw new Error("Could not normalize effective TypeScript compiler options");
  }
  return {
    typescriptBridge: bridgeIdentity(),
    typescriptEngine: {
      package: "typescript",
      version: ts.version
    },
    optionsHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
  };
}
