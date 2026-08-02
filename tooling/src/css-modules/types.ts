export const CSS_MODULE_EXPORTS_PROTOCOL = "genes.css-module-exports";
export const CSS_MODULE_EXPORTS_VERSION = 1;
export const CSS_MODULE_NAMING_POLICY = "genes-haxe-css-fields-v1";

export interface CssModuleSourceLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

export interface CssModuleInput {
  readonly path: string;
  readonly sha256: string;
}

export interface CssModuleExport {
  readonly name: string;
  readonly source: CssModuleSourceLocation;
}

/**
 * Exact, portable evidence supplied by a CSS Modules processor integration.
 *
 * The manifest records facts; it does not ask Genes to interpret CSS. A host
 * creates it from a pinned processor and lists every file that affected the
 * exported names so stale companions can be rejected safely.
 */
export interface CssModuleExportsManifestV1 {
  readonly protocol: typeof CSS_MODULE_EXPORTS_PROTOCOL;
  readonly version: typeof CSS_MODULE_EXPORTS_VERSION;
  readonly namingPolicy: typeof CSS_MODULE_NAMING_POLICY;
  readonly binding: {
    readonly haxeOwner: string;
    readonly generatedModule: string;
    readonly request: string;
    readonly hostModulePath: string;
    readonly companionType: string;
  };
  readonly source: {
    readonly entry: string;
    readonly inputs: readonly CssModuleInput[];
  };
  readonly producer: {
    readonly providerId: string;
    readonly providerVersion: string;
    readonly processorId: string;
    readonly processorVersion: string;
    readonly processorIntegrity: string;
    readonly configurationSha256: string;
  };
  readonly exports: readonly CssModuleExport[];
}

export interface CssModuleCompanionField {
  readonly haxeName: string;
  readonly runtimeName: string;
  readonly source: CssModuleSourceLocation;
}

export interface CssModuleCompanion {
  readonly manifest: CssModuleExportsManifestV1;
  readonly manifestSha256: string;
  readonly relativePath: string;
  readonly content: string;
  readonly fields: readonly CssModuleCompanionField[];
}

export interface GenerateCssModuleCompanionOptions {
  /** Directory against which every manifest input path is resolved. */
  readonly projectRoot: string;
  /** Untrusted JSON decoded by the caller. */
  readonly manifest: unknown;
}
