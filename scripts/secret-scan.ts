import { fileURLToPath } from "node:url";
import path from "node:path";
import { scanWithGitleaks } from "./security/gitleaks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

// Scan the git repo (history + current tree) for secrets. Requires fetch-depth 0 in CI.
await scanWithGitleaks("repository", repoRoot);
