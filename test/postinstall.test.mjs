import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function runPostinstall(t, { binary, ownsGlobalLink }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-browser-postinstall-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'package');
  const bin = join(packageRoot, 'bin');
  const scripts = join(packageRoot, 'scripts');
  const prefix = join(root, 'global');
  await Promise.all([mkdir(bin, { recursive: true }), mkdir(scripts, { recursive: true }), mkdir(join(prefix, 'bin'), { recursive: true })]);
  await writeFile(join(packageRoot, 'package.json'), '{"type":"module","version":"0.41.1"}\n');
  await copyFile(join(repositoryRoot, 'scripts/postinstall.js'), join(scripts, 'postinstall.js'));
  const wrapper = join(bin, 'agent-browser.js');
  await copyFile(join(repositoryRoot, 'bin/agent-browser.js'), wrapper);
  const native = join(bin, 'agent-browser-android-arm64');
  await writeFile(native, binary);
  const other = join(root, 'installed-agent-browser');
  await writeFile(other, 'existing installation\n');
  const globalLink = join(prefix, 'bin', 'agent-browser');
  await symlink(ownsGlobalLink ? wrapper : other, globalLink);
  const bootstrap = join(packageRoot, 'bootstrap.mjs');
  await writeFile(bootstrap, `import { createRequire, syncBuiltinESMExports } from 'node:module';
const os = createRequire(import.meta.url)('node:os');
os.platform = () => 'android';
os.arch = () => 'arm64';
syncBuiltinESMExports();
await import('./scripts/postinstall.js');
`);
  const result = spawnSync(process.execPath, [bootstrap], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, NPM_CONFIG_PREFIX: prefix, npm_config_prefix: prefix },
  });
  return { result, target: await readlink(globalLink), native, other };
}

for (const ownsGlobalLink of [false, true]) {
  test(`postinstall ${ownsGlobalLink ? 'optimizes its own' : 'preserves another installation\'s'} global link`, async (t) => {
    const { result, target, native, other } = await runPostinstall(t, {
      binary: 'source-built binary\n',
      ownsGlobalLink,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(target, ownsGlobalLink ? native : other);
  });
}

test('Android postinstall does not activate the empty binary left by a failed download', async (t) => {
  const { result, target, other } = await runPostinstall(t, {
    binary: '',
    ownsGlobalLink: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(target, other);
  assert.match(result.stdout, /No prebuilt Android binary/);
  assert.doesNotMatch(result.stdout, /Native binary ready|Downloading native binary/);
});
