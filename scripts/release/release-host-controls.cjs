const { execFileSync } = require("node:child_process");

function runGh(args, options = {}) {
  return execFileSync("gh", args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Prove that GitHub prevents a published version from changing underneath users.
 *
 * The local release code can validate bytes before upload, but repository
 * settings own what happens afterward. This check therefore requires both
 * immutable GitHub Releases and a tag ruleset that blocks deletion or movement
 * of every `v*` tag.
 *
 * GitHub classifies both settings APIs as repository Administration data. Run
 * this operator audit with a maintainer token that has Administration:read.
 * The short-lived workflow GITHUB_TOKEN deliberately cannot receive that
 * permission, even when its job has contents:write.
 */
function verifyHostReleaseControls({
  repository,
  cwd = process.cwd(),
  run = runGh,
}) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new Error("repository must use OWNER/NAME form");
  }

  const immutable = JSON.parse(
    run(["api", `repos/${repository}/immutable-releases`], { cwd })
  );
  if (!immutable.enabled) {
    throw new Error("immutable GitHub Releases are not enabled");
  }

  const repositoryState = JSON.parse(
    run(["api", `repos/${repository}`], { cwd })
  );
  const summaries = JSON.parse(
    run(["api", `repos/${repository}/rulesets`], { cwd })
  );
  const summary = summaries.find(
    (entry) =>
      entry &&
      entry.name === "Immutable semantic version tags" &&
      entry.target === "tag" &&
      entry.enforcement === "active"
  );
  if (!summary) {
    throw new Error("active semantic-version tag immutability ruleset is missing");
  }

  const ruleset = JSON.parse(
    run(["api", `repos/${repository}/rulesets/${summary.id}`], { cwd })
  );
  const includes =
    ruleset.conditions &&
    ruleset.conditions.ref_name &&
    ruleset.conditions.ref_name.include;
  const excludes =
    ruleset.conditions &&
    ruleset.conditions.ref_name &&
    ruleset.conditions.ref_name.exclude;
  const bypassActors = ruleset.bypass_actors;
  const ruleTypes = new Set(
    (ruleset.rules || []).map(({ type }) => type)
  );
  if (
    !Array.isArray(includes) ||
    includes.length !== 1 ||
    includes[0] !== "refs/tags/v*" ||
    !Array.isArray(excludes) ||
    excludes.length !== 0 ||
    !Array.isArray(bypassActors) ||
    (repositoryState.owner &&
      repositoryState.owner.type === "User" &&
      bypassActors.length !== 0) ||
    !ruleTypes.has("deletion") ||
    !ruleTypes.has("non_fast_forward")
  ) {
    throw new Error(
      "semantic-version tag ruleset does not prevent update and deletion"
    );
  }

  if (
    repositoryState.owner &&
    repositoryState.owner.type === "Organization" &&
    (!ruleTypes.has("creation") ||
      bypassActors.length === 0)
  ) {
    throw new Error(
      "organization-owned repository must restrict version-tag creation to a dedicated bypass identity"
    );
  }

  return { immutable, repository: repositoryState, ruleset };
}

module.exports = {
  runGh,
  verifyHostReleaseControls,
};
