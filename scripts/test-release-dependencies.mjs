import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
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

// Keep the proxy consumer's IPv6 decoder compatible with the security update.
const fromSocks = createRequire(require.resolve('socks'));
assert.equal(fromSocks('ip-address/package.json').version, '10.7.4');
const {SocksClient} = require('socks');
const packet = Buffer.from('0000000420010db800000000000000000000000101bb6869', 'hex');
assert.deepEqual(SocksClient.parseUDPFrame(packet), {
  frameNumber: 0,
  remoteHost: {host: '2001:0db8:0000:0000:0000:0000:0000:0001', port: 443},
  data: Buffer.from('hi')
});
const fromHooks = createRequire(require.resolve('eslint-plugin-react-hooks'));
assert.equal(fromHooks('zod/package.json').version, '4.6.6');
console.log('Dependency compatibility passed: SOCKS IPv6 decoding and the hooks consumer selects patched Zod. Hooks behavior is checked by test:react-hooks.');

// Exercise the versions reached by consumers, including both Undici majors.
const fromAjv = createRequire(require.resolve('ajv'));
assert.equal(fromAjv('fast-uri/package.json').version, '3.1.9');
assert.equal(fromAjv('fast-uri').resolve('https://example.invalid/schema/', '../value'),
  'https://example.invalid/value');
for (const [consumer, version] of [
  ['@actions/http-client', '6.29.1'], ['node-gyp', '6.29.1'],
  ['@semantic-release/github', '7.30.1']
]) {
  const fromConsumer = createRequire(import.meta.resolve(consumer));
  assert.equal(fromConsumer('undici/package.json').version, version, consumer);
  const {MockAgent, request: send} = fromConsumer('undici');
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  try {
    dispatcher.get('https://example.invalid').intercept({path:'/probe',method:'GET'})
      .reply(200, {ok:true}, {headers:{'content-type':'application/json'}});
    const result = await send('https://example.invalid/probe', {dispatcher});
    assert.equal(result.statusCode, 200);
    assert.deepEqual(await result.body.json(), {ok:true});
    dispatcher.assertNoPendingInterceptors();
  } finally {
    await dispatcher.close();
  }
}

// Keep JSON parsing and rejection behavior at the actual Express boundary.
const fromExpress = createRequire(require.resolve('express'));
assert.equal(fromExpress('body-parser/package.json').version, '1.20.9');
const parseJson = fromExpress('body-parser').json({limit:'64b'});
const server = createServer((request, response) => {
  parseJson(request, response, error => {
    response.setHeader('content-type', 'application/json');
    response.statusCode = error ? error.status : 200;
    response.end(JSON.stringify(error ? {error:error.type} : request.body));
  });
});
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address !== null && typeof address === 'object');
  for (const [body, status, expected] of [
    ['{"ok":true}', 200, {ok:true}],
    ['{', 400, {error:'entity.parse.failed'}],
    [JSON.stringify({value:'x'.repeat(100)}), 413, {error:'entity.too.large'}]
  ]) {
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      method:'POST', headers:{'content-type':'application/json'}, body
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), expected);
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log('Dependency compatibility passed: installed URI resolution, both HTTP client majors, and JSON parsing with malformed/oversized input rejection.');
