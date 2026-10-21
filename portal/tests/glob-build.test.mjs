import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve('vite-plugin-dynamic-import'));
const glob = pluginRequire('fast-glob');

await test('build plugin resolves brace imports, nested index files and exclusions without braces', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'supply-glob-'));
  try {
    mkdirSync(path.join(cwd, 'modules', 'nested'), { recursive: true });
    for (const file of ['a.js', 'b.mjs', 'skip.js', '.hidden.js', 'readme.txt', 'nested/index.js']) {
      writeFileSync(path.join(cwd, 'modules', file), 'export default 1;');
    }
    assert.deepEqual(glob.sync(['./modules/**/*.{js,mjs}', '!./modules/skip.js'], { cwd }).sort(),
      ['modules/a.js', 'modules/b.mjs', 'modules/nested/index.js']);
    assert.deepEqual(glob.sync('./modules', { cwd }), []);
    assert.deepEqual(glob.sync('./missing/*.js', { cwd }), []);
    assert.equal(typeof pluginRequire('vite-plugin-dynamic-import').globFiles, 'function');
    assert.throws(() => pluginRequire.resolve('braces'), { code: 'MODULE_NOT_FOUND' });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
