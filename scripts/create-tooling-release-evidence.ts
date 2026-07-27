import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(file: string, label: string): Record<string, unknown> {
  const decoded: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert(isRecord(decoded), `${label} must contain one JSON object`);
  return decoded;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string
): string {
  const field = value[key];
  assert(typeof field === "string", `${label}.${key} must be a string`);
  return field;
}

function parseArguments(
  args: readonly string[]
): { tarball: string; packJson: string; output: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(
      key !== undefined &&
        value !== undefined &&
        ["--tarball", "--pack-json", "--output"].includes(key),
      "usage: create-tooling-release-evidence --tarball <tgz> --pack-json <json> --output <directory>"
    );
    values.set(key, value);
  }
  const tarball = values.get("--tarball");
  const packJson = values.get("--pack-json");
  const output = values.get("--output");
  assert(tarball !== undefined, "--tarball is required");
  assert(packJson !== undefined, "--pack-json is required");
  assert(output !== undefined, "--output is required");
  return {
    tarball: path.resolve(tarball),
    packJson: path.resolve(packJson),
    output: path.resolve(output),
  };
}

function digest(bytes: Buffer, algorithm: "sha256" | "sha512"): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

/**
 * Encodes npm's scoped-package identity in the Package URL form used by SPDX.
 *
 * npm scopes are Package URL namespaces, so the slash between a scope and
 * package name remains a path separator. Encoding the whole npm name would
 * incorrectly turn `@genes-ts/tooling` into one `%2F`-containing name.
 */
function npmPackageUrl(name: string, version: string): string {
  if (!name.startsWith("@")) {
    return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  }
  const match = /^(@[^/]+)\/([^/]+)$/.exec(name);
  assert(match !== null, `invalid scoped npm package name: ${name}`);
  return `pkg:npm/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}@${encodeURIComponent(version)}`;
}

const options = parseArguments(process.argv.slice(2));
const packageJson = readJsonObject(
  path.join(repoRoot, "tooling", "package.json"),
  "tooling/package.json"
);
const name = requiredString(packageJson, "name", "tooling/package.json");
const version = requiredString(packageJson, "version", "tooling/package.json");
assert(
  packageJson.dependencies === undefined,
  "@genes-ts/tooling release unexpectedly has production dependencies"
);
const packDecoded: unknown = JSON.parse(readFileSync(options.packJson, "utf8"));
assert(
  Array.isArray(packDecoded) && packDecoded.length === 1,
  "pack JSON must describe exactly one package"
);
const packResult = packDecoded[0];
assert(isRecord(packResult), "pack JSON result must be an object");
assert(
  requiredString(packResult, "name", "pack result") === name &&
    requiredString(packResult, "version", "pack result") === version,
  "pack JSON identity differs from tooling/package.json"
);
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
const commit = process.env.GENES_RELEASE_COMMIT;
assert(
  sourceDateEpoch !== undefined && /^\d+$/.test(sourceDateEpoch),
  "SOURCE_DATE_EPOCH must be the reviewed commit timestamp"
);
assert(
  commit !== undefined && /^[0-9a-f]{40}$/.test(commit),
  "GENES_RELEASE_COMMIT must be the exact forty-character source commit"
);
const created = new Date(Number(sourceDateEpoch) * 1000).toISOString();
const tarballBytes = readFileSync(options.tarball);
const sha256 = digest(tarballBytes, "sha256");
const sha512 = digest(tarballBytes, "sha512");
const integrity = `sha512-${Buffer.from(sha512, "hex").toString("base64")}`;
assert(
  requiredString(packResult, "integrity", "pack result") === integrity,
  "pack JSON integrity differs from the release tarball"
);
const files = packResult.files;
assert(Array.isArray(files), "pack result.files must be an array");
const inventory = files
  .map((entry, index) => {
    assert(isRecord(entry), `pack result.files[${index}] must be an object`);
    const filePath = requiredString(entry, "path", `pack result.files[${index}]`);
    const size = entry.size;
    assert(
      typeof size === "number",
      `pack result.files[${index}].size must be a number`
    );
    return { path: filePath, size };
  })
  .sort((left, right) => left.path.localeCompare(right.path));

const receipt = {
  schemaVersion: 1,
  package: { name, version },
  source: {
    repository: "https://github.com/fullofcaffeine/genes-ts",
    commit,
  },
  artifact: {
    filename: path.basename(options.tarball),
    integrity,
    sha256,
    sha512,
    files: inventory,
  },
};

const spdx = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${name}-${version}`,
  documentNamespace: `https://github.com/fullofcaffeine/genes-ts/spdx/${encodeURIComponent(name)}/${version}/${sha256}`,
  creationInfo: {
    created,
    creators: ["Tool: genes-ts-create-tooling-release-evidence"],
  },
  packages: [
    {
      SPDXID: "SPDXRef-Package",
      name,
      versionInfo: version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "MIT",
      licenseDeclared: "MIT",
      copyrightText: "NOASSERTION",
      checksums: [{ algorithm: "SHA512", checksumValue: sha512 }],
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: npmPackageUrl(name, version),
        },
      ],
    },
  ],
  relationships: [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: "SPDXRef-Package",
    },
  ],
};

mkdirSync(options.output, { recursive: true });
writeFileSync(
  path.join(options.output, "release-receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  "utf8"
);
writeFileSync(
  path.join(options.output, "sbom.spdx.json"),
  `${JSON.stringify(spdx, null, 2)}\n`,
  "utf8"
);
console.log(
  `tooling-release-evidence:ok (${name}@${version}; ${inventory.length} files; ${integrity})`
);
