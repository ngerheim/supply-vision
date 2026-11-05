import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// O Button do Base UI nasce com type="button": sem type="submit" explícito o
// clique não dispara o onSubmit do formulário e nada acontece na tela.
void test('todo formulário das telas tem um botão de envio explícito', () => {
  const pasta = new URL('../components/', import.meta.url).pathname;
  const semEnvio = [];
  for (const arquivo of readdirSync(pasta, { recursive: true }).filter((f) => String(f).endsWith('.tsx'))) {
    const texto = readFileSync(join(pasta, String(arquivo)), 'utf8');
    for (const m of texto.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
      if (!/onSubmit=/.test(m[0].slice(0, 400))) continue;
      if (!/type=["']submit["']|type=\{["']submit["']\}/.test(m[0])) {
        semEnvio.push(String(arquivo) + ":" + String(texto.slice(0, m.index).split("\n").length));
      }
    }
  }
  assert.deepEqual(semEnvio, []);
});
