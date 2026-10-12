#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const defaultPolicyPath = path.join(
  repositoryRoot,
  "config/tooling-release-environment-policy.json"
);
const canonicalRepository = "fullofcaffeine/genes-ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Verifies the live GitHub environment that guards npm trusted publishing.
 *
 * Why: the release workflow receives an OpenID Connect identity that npm can
 * trust without a stored token. Repository code can pin the workflow, but the
 * human approval rules live in GitHub settings and can drift independently.
 * Publication must fail before requesting npm credentials if an administrator
 * can bypass review or the person who started the run can approve it.
 *
 * What: the checked-in policy requires at least one reviewer, prevents the
 * triggering actor from approving their own run, disables administrator
 * bypass, and admits deployments only from protected branches.
 *
 * How: GitHub exposes environment protection rules for public repositories
 * through a read-only API. This verifier compares that response with the
 * reviewed policy file. It is run by normal CI and again inside the protected
 * release job, so a weakened live setting fails closed even though settings
 * are not stored in Git. It never creates a deployment or publishes a package.
 */
export function verifyEnvironmentPolicy(policy, environment) {
  assert(policy?.schemaVersion === 1, "unsupported release-environment policy schema");
  assert(
    policy.repository === canonicalRepository,
    `release-environment policy repository must be ${canonicalRepository}`
  );
  assert(
    environment?.name === policy.environment,
    `expected environment ${policy.environment}, got ${String(environment?.name)}`
  );
  assert(
    environment.can_admins_bypass === policy.canAdminsBypass,
    `environment can_admins_bypass must be ${policy.canAdminsBypass}`
  );

  const reviewerRules = Array.isArray(environment.protection_rules)
    ? environment.protection_rules.filter((rule) => rule?.type === "required_reviewers")
    : [];
  assert(reviewerRules.length === 1, "environment must have exactly one required-reviewers rule");
  const reviewerRule = reviewerRules[0];
  assert(
    reviewerRule.prevent_self_review === policy.preventSelfReview,
    `environment prevent_self_review must be ${policy.preventSelfReview}`
  );
  const reviewerCount = Array.isArray(reviewerRule.reviewers)
    ? reviewerRule.reviewers.filter(
        (entry) =>
          (entry?.type === "User" || entry?.type === "Team") &&
          Number.isInteger(entry?.reviewer?.id)
      ).length
    : 0;
  assert(
    reviewerCount >= policy.minimumRequiredReviewers,
    `environment needs at least ${policy.minimumRequiredReviewers} required reviewer`
  );

  const branchPolicy = environment.deployment_branch_policy;
  assert(
    branchPolicy?.protected_branches === policy.protectedBranches,
    `environment protected_branches must be ${policy.protectedBranches}`
  );
  assert(
    branchPolicy?.custom_branch_policies === policy.customBranchPolicies,
    `environment custom_branch_policies must be ${policy.customBranchPolicies}`
  );

  return {
    environment: environment.name,
    reviewerCount,
    preventSelfReview: reviewerRule.prevent_self_review,
    canAdminsBypass: environment.can_admins_bypass,
    protectedBranches: branchPolicy.protected_branches,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/** Reads only the canonical repository; never forwards credentials on redirects. */
export async function fetchEnvironment(policy, { token = null, fetchImpl = fetch } = {}) {
  assert(policy?.repository === canonicalRepository,
    `release-environment policy repository must be ${canonicalRepository}`);
  const endpoint =
    `https://api.github.com/repos/${policy.repository}` +
    `/environments/${encodeURIComponent(policy.environment)}`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let status = null;
    try {
      const response = await fetchImpl(endpoint, {
        redirect: "error",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        status = response.status;
        throw new Error("GitHub environment response was unsuccessful");
      }
      return await response.json();
    } catch {
      // Native errors can include request details. Keep credentials out of diagnostics.
      lastError = new Error(Number.isInteger(status)
        ? `GitHub environment API returned HTTP ${status}; check GitHub authentication and Actions read permission`
        : "GitHub environment request failed; check network access and GitHub authentication");
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError;
}

function parseArguments(argv) {
  const policyFlag = argv.indexOf("--policy");
  if (policyFlag >= 0 && policyFlag !== argv.length - 2)
    throw new Error("--policy must be followed by one final policy path");
  const policyPath =
    policyFlag >= 0 ? path.resolve(argv[policyFlag + 1]) : defaultPolicyPath;
  const modeArguments = policyFlag >= 0 ? argv.slice(0, policyFlag) : argv;
  if (modeArguments.length === 1 && modeArguments[0] === "--live")
    return { live: true, policyPath };
  if (modeArguments.length === 2 && modeArguments[0] === "--file")
    return {
      live: false,
      policyPath,
      environmentPath: modeArguments[1],
    };
  throw new Error(
    "usage: verify-tooling-release-environment.mjs " +
      "(--live | --file <environment.json>) [--policy <policy.json>]"
  );
}

/** Prefer explicit tokens; local users may reuse their existing github.com login. */
export function githubCredential(environment = process.env, readLocal = () => execFileSync(
  "gh", ["auth", "token", "--hostname", "github.com"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
)) {
  const explicit = environment.GH_TOKEN?.trim() || environment.GITHUB_TOKEN?.trim();
  if (explicit) return explicit;
  if (environment.CI) return null;
  try { return readLocal().trim() || null; } catch { return null; }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const policy = await readJson(options.policyPath);
  const environment = options.live
    ? await fetchEnvironment(policy, { token: githubCredential() })
    : await readJson(path.resolve(options.environmentPath));
  const result = verifyEnvironmentPolicy(policy, environment);
  console.log(
    "tooling-release-environment:ok " +
      `(reviewers=${result.reviewerCount}; prevent-self-review=true; ` +
      "admin-bypass=false; protected-branches=true)"
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`tooling-release-environment:error: ${error.message}`);
    process.exitCode = 1;
  });
