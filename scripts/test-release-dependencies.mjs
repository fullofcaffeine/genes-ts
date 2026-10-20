import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {analyzeCommits} from '@semantic-release/commit-analyzer';
import {generateNotes} from '@semantic-release/release-notes-generator';

const require = createRequire(import.meta.url);
const checkedPackages = new Set();
for (const consumer of ['semantic-release', '@semantic-release/commit-analyzer']) {
  const fromConsumer = createRequire(require.resolve(consumer));
  const fromMicromatch = createRequire(fromConsumer.resolve('micromatch'));
  // Resolve each actual release consumer: a root copy can hide a nested dependency.
  const packagePath = fromMicromatch.resolve('braces/package.json');
  const packageInfo = fromMicromatch(packagePath);
  assert.equal(packageInfo.name, '@fullofcaffeine/braces', consumer);
  assert.equal(packageInfo.version, '3.0.3-caf.1', consumer);
  if (!checkedPackages.has(packagePath)) {
    // Git advisory coverage cannot establish that this repair works.
    const depth = spawnSync(process.execPath, [join(dirname(packagePath), 'scripts/verify-depth.cjs')],
      {cwd:tmpdir(),encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
    assert.ifError(depth.error);
    assert.equal(depth.status,0,depth.stderr || depth.stdout);
    checkedPackages.add(packagePath);
  }
  const matches = fromConsumer('micromatch');
  assert.deepEqual(matches(['core','ui','docs'], '{core,ui}'), ['core','ui']);
}
const logger = {log(){}, error(){}, success(){}};
const commit = message => ({message, hash:'1234567890123456789012345678901234567890'});
const base = {cwd:process.cwd(),logger};
assert.equal(await analyzeCommits({releaseRules:[{type:'feat',scope:'{core,ui}',release:'minor'}]},
  {...base,commits:[commit('feat(ui): add a useful feature')]}),'minor');
assert.equal(await analyzeCommits({}, {...base,commits:[commit('fix: preserve existing behavior')]}),'patch');
assert.equal(await analyzeCommits({}, {...base,commits:[commit('feat: change interface\n\nBREAKING CHANGE: callers must use the new input')]}),'major');
const notes = await generateNotes({}, {...base,
  options:{repositoryUrl:'https://github.com/fullofcaffeine/genes-ts'},
  lastRelease:{gitTag:'v0.1.0',version:'0.1.0'},
  nextRelease:{gitTag:'v0.2.0',version:'0.2.0'},
  commits:[commit('feat(ui): add a useful feature')]
});
assert.match(notes,/add a useful feature/);
assert.match(notes,/0\.2\.0/);
console.log('Release compatibility passed: actual nested fork, brace matching, minor/patch/major classification and release notes. No release or network publication requested.');

// Verify the actual installed cache consumer, rather than a root package copy.
const fromFetch = createRequire(require.resolve('make-fetch-happen'));
assert.equal(fromFetch('http-cache-semantics/package.json').version, '4.3.0');
const CachePolicy = fromFetch('./cache/policy.js');
const request = {method:'GET',url:'https://example.invalid/package',headers:new Map(),compress:true};
const response = {status:200,headers:new Map([['cache-control','private, max-age=60'],['etag','"fixture"']])};
const cache = new CachePolicy({request,response,options:{}});
assert.equal(cache.policy.toObject().sh, false, 'The installed fetch consumer must use a private cache');
assert.equal(cache.storable(), true, 'A private response remains usable in this private cache');
const revalidated = cache.policy.revalidatedPolicy(
  {method:'GET',url:request.url,headers:{}},
  {status:304,headers:{etag:'"fixture"','cache-control':'private, max-age=60'}}
);
assert.equal(revalidated.policy.toObject().sh, false, 'Revalidation must preserve private cache mode');
console.log('Cache compatibility passed: exact package, private construction and private revalidation. No shared-cache safety claim.');
