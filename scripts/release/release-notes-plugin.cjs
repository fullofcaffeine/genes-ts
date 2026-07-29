const { execFileSync } = require("node:child_process");
const semver = require("semver");

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function normalizeReleaseNotes(notes) {
  if (typeof notes !== "string" || notes.trim().length === 0) {
    throw new Error("release notes must be a non-empty string");
  }
  return `${notes.replace(/\r\n/g, "\n").trimEnd()}\n`;
}

function releaseDateForHead(cwd, gitHead) {
  const date = runGit(["show", "-s", "--format=%cs", `${gitHead}^{commit}`], cwd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("release source commit has no stable YYYY-MM-DD date");
  }
  return date;
}

/**
 * Generate standard Conventional Commit notes with a reproducible date.
 *
 * Why: the upstream notes generator uses the wall-clock publication date.
 * Recovery may happen on another day after the immutable tag already exists,
 * so regenerating those notes could permanently publish different text.
 *
 * What/How: delegate all grouping, links, and commit rendering to the pinned
 * official generator, then replace only its first heading date with the exact
 * tested commit's Git date. Normal publication and later recovery can now
 * derive byte-identical notes from the same repository history.
 */
async function generateNotes(pluginConfig, context) {
  const { generateNotes: generateConventionalNotes } = await import(
    "@semantic-release/release-notes-generator"
  );
  const generated = normalizeReleaseNotes(
    await generateConventionalNotes(pluginConfig, context)
  );
  const date = releaseDateForHead(context.cwd, context.nextRelease.gitHead);
  const headingDate = /^([^\n]*\()\d{4}-\d{2}-\d{2}(\)\n)/;
  if (!headingDate.test(generated)) {
    throw new Error("release notes heading does not contain the expected date");
  }
  return generated.replace(headingDate, `$1${date}$2`);
}

function stableVersion(tag) {
  if (!/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag)) {
    return null;
  }
  const version = tag.slice(1);
  return semver.valid(version, { loose: false }) ? version : null;
}

function previousStableTag(tag, cwd) {
  const tags = runGit(["tag", "--merged", tag, "--list", "v*"], cwd)
    .split("\n")
    .map((candidate) => ({
      tag: candidate,
      version: stableVersion(candidate),
    }))
    .filter(
      (candidate) =>
        candidate.tag !== tag && candidate.version !== null
    )
    .sort((left, right) => semver.rcompare(left.version, right.version));
  if (tags.length === 0) {
    throw new Error("release recovery requires a previous stable SemVer tag");
  }
  return tags[0];
}

function commitsBetween(fromTag, toTag, cwd) {
  const raw = execFileSync(
    "git",
    ["log", "-z", "--format=%H%x00%B", `${fromTag}..${toTag}`],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 2 !== 0) {
    throw new Error("unable to parse release commit history");
  }
  const commits = [];
  for (let index = 0; index < fields.length; index += 2) {
    commits.push({ hash: fields[index], message: fields[index + 1] });
  }
  return commits;
}

async function notesForTag(tag, cwd) {
  const version = stableVersion(tag);
  if (!version) {
    throw new Error("release notes require a stable vMAJOR.MINOR.PATCH tag");
  }
  const previous = previousStableTag(tag, cwd);
  const gitHead = runGit(["rev-parse", `${tag}^{commit}`], cwd);
  const previousHead = runGit(
    ["rev-parse", `${previous.tag}^{commit}`],
    cwd
  );
  const repositoryUrl = runGit(["remote", "get-url", "origin"], cwd);
  return generateNotes(
    { preset: "conventionalcommits" },
    {
      cwd,
      commits: commitsBetween(previous.tag, tag, cwd),
      lastRelease: {
        version: previous.version,
        gitTag: previous.tag,
        gitHead: previousHead,
      },
      nextRelease: { version, gitTag: tag, gitHead },
      options: { repositoryUrl, tagFormat: "v${version}" },
      branch: { name: "main" },
      logger: { log() {}, error() {}, success() {} },
    }
  );
}

module.exports = {
  commitsBetween,
  generateNotes,
  normalizeReleaseNotes,
  notesForTag,
  previousStableTag,
  releaseDateForHead,
  stableVersion,
};
