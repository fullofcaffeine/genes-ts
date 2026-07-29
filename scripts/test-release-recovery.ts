import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

type ExpectedAsset = { digest: string; size: number };
type HostedAsset = ExpectedAsset & {
  name: string;
  state: string;
};
type ReleaseSnapshot = {
  tagName: string;
  isDraft: boolean;
  isImmutable: boolean;
  isPrerelease: boolean;
  body: string;
  assets: HostedAsset[];
};

const { draftAssetPlan, releaseVersionFromTag } = require(
  path.join(repoRoot, "scripts/release/complete-release.cjs")
) as {
  draftAssetPlan(options: {
    release: ReleaseSnapshot;
    tag: string;
    expectedAssets: Record<string, ExpectedAsset>;
    expectedNotes: string;
  }): string[];
  releaseVersionFromTag(tag: string): string;
};
const { verifyReleaseSnapshot } = require(
  path.join(repoRoot, "scripts/release/published-verifier-plugin.cjs")
) as {
  verifyReleaseSnapshot(options: {
    release: ReleaseSnapshot;
    tag: string;
    expectedAssets: Record<string, ExpectedAsset>;
    expectedNotes?: string;
  }): void;
};
const { assertTrackedTreeClean } = require(
  path.join(repoRoot, "scripts/release/haxelib-artifact-plugin.cjs")
) as {
  assertTrackedTreeClean(cwd: string): void;
};
const { commitsBetween, generateNotes, notesForTag, previousStableTag } = require(
  path.join(repoRoot, "scripts/release/release-notes-plugin.cjs")
) as {
  commitsBetween(
    fromTag: string,
    toTag: string,
    cwd: string
  ): Array<{ hash: string; message: string }>;
  generateNotes(
    pluginConfig: { preset: string },
    context: {
      cwd: string;
      commits: Array<{ hash: string; message: string }>;
      lastRelease: { version: string; gitTag: string; gitHead: string };
      nextRelease: { version: string; gitTag: string; gitHead: string };
      options: { repositoryUrl: string; tagFormat: string };
      branch: { name: string };
      logger: {
        log(): void;
        error(): void;
        success(): void;
      };
    }
  ): Promise<string>;
  notesForTag(tag: string, cwd: string): Promise<string>;
  previousStableTag(
    tag: string,
    cwd: string
  ): { tag: string; version: string };
};
const { verifyHostReleaseControls } = require(
  path.join(repoRoot, "scripts/release/release-host-controls.cjs")
) as {
  verifyHostReleaseControls(options: {
    repository: string;
    cwd: string;
    run(
      arguments_: string[],
      options: { cwd: string }
    ): string;
  }): {
    ruleset: { id: number };
  };
};

const tag = "v2.4.6";
const expectedNotes = "## 2.4.6 (2026-07-28)\n\n### Bug Fixes\n\n- repair release\n";
const completionSource = readFileSync(
  path.join(repoRoot, "scripts/release/complete-release.cjs"),
  "utf8"
);
assert(
  completionSource.indexOf("assertTrackedTreeClean(cwd);") <
    completionSource.indexOf("buildApprovedArtifact({ cwd, version, tag, source })"),
  "release completion must reject tracked edits before building immutable bytes"
);
assert.match(completionSource, /"--notes-file",\s+notesPath/);
assert.doesNotMatch(completionSource, /"--generate-notes"/);
const expectedAssets = {
  "genes-ts-2.4.6.zip": {
    digest: `sha256:${"a".repeat(64)}`,
    size: 1200,
  },
  "genes-ts-2.4.6.zip.sha256": {
    digest: `sha256:${"b".repeat(64)}`,
    size: 92,
  },
};
const uploaded = (name: keyof typeof expectedAssets): HostedAsset => ({
  name,
  state: "uploaded",
  ...expectedAssets[name],
});
const draft = (assets: HostedAsset[]): ReleaseSnapshot => ({
  tagName: tag,
  isDraft: true,
  isImmutable: false,
  isPrerelease: false,
  body: expectedNotes,
  assets,
});

assert.equal(releaseVersionFromTag(tag), "2.4.6");
for (const invalid of [
  "2.4.6",
  "v2.4",
  "v2.4.6-beta.1",
  "v02.4.6",
  "latest",
]) {
  assert.throws(() => releaseVersionFromTag(invalid), /vMAJOR\.MINOR\.PATCH/);
}

assert.deepEqual(
  draftAssetPlan({ release: draft([]), tag, expectedAssets, expectedNotes }),
  Object.keys(expectedAssets).sort(),
  "a fresh retry should upload both approved assets"
);
assert.deepEqual(
  draftAssetPlan({
    release: draft([uploaded("genes-ts-2.4.6.zip")]),
    tag,
    expectedAssets,
    expectedNotes,
  }),
  ["genes-ts-2.4.6.zip.sha256"],
  "a retry should preserve the correct asset and add only the missing one"
);
assert.deepEqual(
  draftAssetPlan({
    release: draft([
      uploaded("genes-ts-2.4.6.zip"),
      uploaded("genes-ts-2.4.6.zip.sha256"),
    ]),
    tag,
    expectedAssets,
    expectedNotes,
  }),
  [],
  "a complete draft should be publication-ready without replacement"
);

assert.throws(
  () =>
    draftAssetPlan({
      release: draft([
        {
          ...uploaded("genes-ts-2.4.6.zip"),
          digest: `sha256:${"c".repeat(64)}`,
        },
      ]),
      tag,
      expectedAssets,
      expectedNotes,
    }),
  /do not match/
);
assert.throws(
  () =>
    draftAssetPlan({
      release: draft([
        {
          name: "unreviewed.bin",
          state: "uploaded",
          digest: `sha256:${"d".repeat(64)}`,
          size: 1,
        },
      ]),
      tag,
      expectedAssets,
      expectedNotes,
    }),
  /unexpected assets/
);
assert.throws(
  () =>
    draftAssetPlan({
      release: { ...draft([]), body: "unreviewed notes\n" },
      tag,
      expectedAssets,
      expectedNotes,
    }),
  /notes do not match/
);

const immutable: ReleaseSnapshot = {
  ...draft([
    uploaded("genes-ts-2.4.6.zip"),
    uploaded("genes-ts-2.4.6.zip.sha256"),
  ]),
  isDraft: false,
  isImmutable: true,
};
verifyReleaseSnapshot({
  release: immutable,
  tag,
  expectedAssets,
  expectedNotes,
});
verifyReleaseSnapshot({
  release: immutable,
  tag,
  expectedAssets,
  expectedNotes,
});
assert.throws(
  () =>
    verifyReleaseSnapshot({
      release: { ...immutable, isImmutable: false },
      tag,
      expectedAssets,
      expectedNotes,
    }),
  /not immutable/
);
assert.throws(
  () =>
    verifyReleaseSnapshot({
      release: {
        ...immutable,
        assets: [uploaded("genes-ts-2.4.6.zip")],
      },
      tag,
      expectedAssets,
      expectedNotes,
    }),
  /asset inventory/
);
assert.throws(
  () =>
    verifyReleaseSnapshot({
      release: { ...immutable, body: "different immutable notes\n" },
      tag,
      expectedAssets,
      expectedNotes,
    }),
  /notes do not match/
);

const dirtyRepo = mkdtempSync(path.join(tmpdir(), "genes-release-dirty-"));
try {
  execFileSync("git", ["init", "-q"], { cwd: dirtyRepo });
  execFileSync("git", ["config", "user.name", "Release Test"], {
    cwd: dirtyRepo,
  });
  execFileSync("git", ["config", "user.email", "release@example.invalid"], {
    cwd: dirtyRepo,
  });
  writeFileSync(path.join(dirtyRepo, "tracked.txt"), "approved\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: dirtyRepo });
  execFileSync("git", ["commit", "-qm", "test: approved source"], {
    cwd: dirtyRepo,
  });
  assertTrackedTreeClean(dirtyRepo);
  writeFileSync(path.join(dirtyRepo, "tracked.txt"), "dirty\n");
  assert.throws(
    () => assertTrackedTreeClean(dirtyRepo),
    /modified tracked repository files/
  );
} finally {
  rmSync(dirtyRepo, { recursive: true, force: true });
}

const notesRepo = mkdtempSync(path.join(tmpdir(), "genes-release-notes-"));
try {
  execFileSync("git", ["init", "-q"], { cwd: notesRepo });
  execFileSync("git", ["config", "user.name", "Release Test"], {
    cwd: notesRepo,
  });
  execFileSync("git", ["config", "user.email", "release@example.invalid"], {
    cwd: notesRepo,
  });
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://github.com/fullofcaffeine/genes-ts.git"],
    { cwd: notesRepo }
  );
  writeFileSync(path.join(notesRepo, "tracked.txt"), "baseline\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: notesRepo });
  execFileSync("git", ["commit", "-qm", "chore: baseline"], {
    cwd: notesRepo,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
    },
  });
  execFileSync("git", ["tag", "v2.4.5"], { cwd: notesRepo });
  writeFileSync(path.join(notesRepo, "tracked.txt"), "fixed\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: notesRepo });
  execFileSync("git", ["commit", "-qm", "fix(release): recover exact notes"], {
    cwd: notesRepo,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-28T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-28T12:00:00Z",
    },
  });
  execFileSync("git", ["tag", "v2.4.6"], { cwd: notesRepo });
  const recoveredNotes = await notesForTag("v2.4.6", notesRepo);
  const previous = previousStableTag("v2.4.6", notesRepo);
  const normalNotes = await generateNotes(
    { preset: "conventionalcommits" },
    {
      cwd: notesRepo,
      commits: commitsBetween(previous.tag, "v2.4.6", notesRepo),
      lastRelease: {
        version: previous.version,
        gitTag: previous.tag,
        gitHead: execFileSync(
          "git",
          ["rev-parse", `${previous.tag}^{commit}`],
          { cwd: notesRepo, encoding: "utf8" }
        ).trim(),
      },
      nextRelease: {
        version: "2.4.6",
        gitTag: "v2.4.6",
        gitHead: execFileSync(
          "git",
          ["rev-parse", "v2.4.6^{commit}"],
          { cwd: notesRepo, encoding: "utf8" }
        ).trim(),
      },
      options: {
        repositoryUrl: "https://github.com/fullofcaffeine/genes-ts.git",
        tagFormat: "v${version}",
      },
      branch: { name: "main" },
      logger: { log() {}, error() {}, success() {} },
    }
  );
  assert.equal(
    recoveredNotes,
    normalNotes,
    "normal publication and exact-tag recovery must generate identical notes"
  );
  assert.match(recoveredNotes, /^## .* \(2026-07-28\)$/m);
  assert.match(recoveredNotes, /recover exact notes/);
  assert.doesNotMatch(recoveredNotes, /\(2026-07-20\)/);
} finally {
  rmSync(notesRepo, { recursive: true, force: true });
}

const controls = verifyHostReleaseControls({
  repository: "fullofcaffeine/genes-ts",
  cwd: repoRoot,
  run(arguments_) {
    const endpoint = arguments_[1];
    if (endpoint.endsWith("/immutable-releases")) {
      return JSON.stringify({ enabled: true });
    }
    if (endpoint.endsWith("/rulesets")) {
      return JSON.stringify([
        {
          id: 42,
          name: "Immutable semantic version tags",
          target: "tag",
          enforcement: "active",
        },
      ]);
    }
    if (endpoint.includes("/rulesets/")) {
      return JSON.stringify({
        id: 42,
        bypass_actors: [],
        conditions: {
          ref_name: { include: ["refs/tags/v*"], exclude: [] },
        },
        rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
      });
    }
    return JSON.stringify({ owner: { type: "User" } });
  },
});
assert.equal(controls.ruleset.id, 42);
for (const [label, mutation] of [
  [
    "excluded version tags",
    {
      bypass_actors: [],
      conditions: {
        ref_name: {
          include: ["refs/tags/v*"],
          exclude: ["refs/tags/v0.*"],
        },
      },
      rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
    },
  ],
  [
    "user-repository bypass actor",
    {
      bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }],
      conditions: {
        ref_name: { include: ["refs/tags/v*"], exclude: [] },
      },
      rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
    },
  ],
] as const) {
  assert.throws(
    () =>
      verifyHostReleaseControls({
        repository: "fullofcaffeine/genes-ts",
        cwd: repoRoot,
        run(arguments_) {
          const endpoint = arguments_[1];
          if (endpoint.endsWith("/immutable-releases")) {
            return JSON.stringify({ enabled: true });
          }
          if (endpoint.endsWith("/rulesets")) {
            return JSON.stringify([
              {
                id: 42,
                name: "Immutable semantic version tags",
                target: "tag",
                enforcement: "active",
              },
            ]);
          }
          if (endpoint.includes("/rulesets/")) {
            return JSON.stringify({ id: 42, ...mutation });
          }
          return JSON.stringify({ owner: { type: "User" } });
        },
      }),
    /does not prevent/,
    label
  );
}

console.log(
  "release-recovery:ok (exact notes + clean tree + missing assets + immutable host controls)"
);
