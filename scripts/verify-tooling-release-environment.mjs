#!/usr/bin/env node

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

async function fetchEnvironment(policy) {
  const endpoint =
    `https://api.github.com/repos/${policy.repository}` +
    `/environments/${encodeURIComponent(policy.environment)}`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`GitHub environment API returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const policy = await readJson(options.policyPath);
  const environment = options.live
    ? await fetchEnvironment(policy)
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
