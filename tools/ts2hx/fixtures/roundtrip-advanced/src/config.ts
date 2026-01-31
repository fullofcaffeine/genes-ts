export type Role = "admin" | "user";

export interface Config {
  role: Role;
  dryRun: boolean;
  baseUrl?: string;
}

export function normalizeBaseUrl(cfg: Config): string {
  const len = cfg.baseUrl?.length ?? 0;
  if (len === 0) return "http://localhost";
  return cfg.baseUrl!;
}

