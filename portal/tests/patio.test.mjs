import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url),'utf8');
const cores = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[a-f\d]{6})/gi)].map(m => [m[1],m[2]]));
function luminancia(hex) {
  const [r,g,b] = hex.slice(1).match(/../g).map(x => {
    const c = parseInt(x,16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
void test('pares de texto do Patio tem contraste WCAG de pelo menos 4.5:1', () => {
  const pares = ['marinho','aco','link','analise','devolvido','concluido','cancelado'].flatMap(c => [[c,'branco'],[c,'chao']]);
  pares.push(['branco','marinho'],['branco','marinho-claro'],['marinho','ambar']);
  for (const [a,b] of pares) {
    const valores = [luminancia(cores[a]),luminancia(cores[b])].sort((x,y) => y-x);
    const ratio = (valores[0]+0.05)/(valores[1]+0.05);
    assert.ok(ratio >= 4.5,`${a}/${b}: ${ratio.toFixed(2)}`);
  }
});
