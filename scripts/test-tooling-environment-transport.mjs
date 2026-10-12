import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fetchEnvironment, githubCredential } from "./verify-tooling-release-environment.mjs";

const policy = { repository: "fullofcaffeine/genes-ts", environment: "tooling-npm-production" };
let requests = 0;
const result = await fetchEnvironment(policy, {
  token: "fixture-token",
  fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, "https://api.github.com/repos/fullofcaffeine/genes-ts/environments/tooling-npm-production");
    assert.equal(options.headers.Authorization, "Bearer fixture-token");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ name: policy.environment }) };
  },
});
assert.equal(result.name, policy.environment);
assert.equal(requests, 1);
await assert.rejects(fetchEnvironment({ ...policy, repository: "other/repo" }, {
  token: "fixture-token",
  fetchImpl: async () => { throw new Error("must not request another repository"); },
}), /repository must be/);
await fetchEnvironment(policy, {
  token: null,
  fetchImpl: async (_url, options) => {
    assert.equal(Object.hasOwn(options.headers, "Authorization"), false);
    return { ok: true, json: async () => ({}) };
  },
});

assert.equal(githubCredential({ GH_TOKEN: "first", GITHUB_TOKEN: "second" }, () => { throw Error("unused"); }), "first");
assert.equal(githubCredential({ GITHUB_TOKEN: "second" }), "second");
assert.equal(githubCredential({ CI: "true" }, () => { throw Error("CI must not invoke gh"); }), null);
assert.equal(githubCredential({}, () => " local-token\n"), "local-token");
assert.equal(githubCredential({}, () => { throw Error("not signed in"); }), null);

let failedAttempts = 0;
await assert.rejects(fetchEnvironment(policy, {
  token: "fixture-token",
  fetchImpl: async () => {
    failedAttempts++;
    throw new Error("request failed with secret fixture-token");
  },
}), error => {
  assert.equal(error.message.includes("fixture-token"), false);
  assert.equal(error.cause, undefined);
  return /check network access/.test(error.message);
});
assert.equal(failedAttempts, 3);
await assert.rejects(fetchEnvironment(policy, {
  token: "fixture-token",
  fetchImpl: async () => ({ ok: false, status: 403 }),
}), /HTTP 403; check GitHub authentication/);
const { load } = createRequire(import.meta.url)("js-yaml");
const ci = load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
const preflight = ci.jobs["genes-ts-preflight"];
assert.deepEqual(preflight.permissions, { contents: "read", actions: "read" });
assert.equal(preflight.steps.find(step => step.run === "yarn test:tooling-release-workflow").env.GH_TOKEN, "${{ github.token }}");
const release = load(readFileSync(new URL("../.github/workflows/release-tooling.yml", import.meta.url), "utf8"));
assert.deepEqual(release.permissions, { contents: "read", "id-token": "write", actions: "read" });
assert.equal(release.jobs.publish.steps.find(step => step.run === "node scripts/verify-tooling-release-environment.mjs --live").env.GH_TOKEN, "${{ github.token }}");
console.log("tooling-environment-transport:ok");
