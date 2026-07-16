import {
  Service,
  acceptShape,
  booleanResult,
  callback,
  contextual,
  enabled,
  generic,
  literal,
  maybe,
  merged,
  mutable,
  notify,
  optional,
  record,
  rest,
  text
} from "planpkg";
import type { Shape } from "planpkg";

export function localImplementation(value: string): string {
  return value;
}

export type ImportedShape = Shape;

// These references make the declaration inventory obvious to readers while
// the focused test remains the sole owner of the shadow plan.
export const importedValues = {
  Service,
  acceptShape,
  booleanResult,
  callback,
  contextual,
  enabled,
  generic,
  literal,
  maybe,
  merged,
  mutable,
  notify,
  optional,
  record,
  rest,
  text
};
