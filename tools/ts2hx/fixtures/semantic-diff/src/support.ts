function initializeModuleLabel(): string {
  console.log("TS2HX_SIDE_EFFECT:support");
  return "esm";
}

export const moduleLabel = initializeModuleLabel();

export function moduleValue(value: number): number {
  return value + 1;
}
