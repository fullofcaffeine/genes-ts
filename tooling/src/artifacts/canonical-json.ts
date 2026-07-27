import { createHash } from "node:crypto";

import { artifactFailure } from "./error.js";
import type { Sha256 } from "./types.js";

type JsonPrimitive = null | boolean | number | string;
export type CanonicalJson =
  | JsonPrimitive
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function encodeString(value: string): string {
  return JSON.stringify(value);
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    artifactFailure("invalid-plan", "canonical JSON contains a non-finite number");
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  return JSON.stringify(value);
}

export function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return encodeNumber(value);
  }
  if (typeof value === "string") {
    return encodeString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const object = value as { readonly [key: string]: CanonicalJson };
  const keys = Object.keys(object).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${keys
    .map((key) => `${encodeString(key)}:${canonicalJson(object[key]!)}`)
    .join(",")}}`;
}

export function sha256Bytes(value: string | Uint8Array): Sha256 {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalDigest(value: CanonicalJson): Sha256 {
  return sha256Bytes(canonicalJson(value));
}
