# Relatorio de vulnerabilidades separando o que roda do que e ferramenta.
#
# ATENCAO: o .npmrc do projeto tem include=dev (necessario porque esta maquina
# define NODE_ENV=production e o npm apagaria as devDependencies). O efeito
# colateral e que "npm audit --omit=dev" NAO exclui as dependencias de
# desenvolvimento: o include vence. E preciso passar --include=prod junto.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:NODE_ENV = 'development'

$resumo = @'
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const v = JSON.parse(s).vulnerabilities || {};
    const nomes = Object.keys(v);
    if (!nomes.length) { console.log('  nenhuma'); return; }
    const porGrau = { critical: [], high: [], moderate: [], low: [] };
    for (const [k, x] of Object.entries(v)) (porGrau[x.severity] || porGrau.low).push(k);
    for (const [grau, lista] of Object.entries(porGrau))
      if (lista.length) console.log('  ' + grau.padEnd(10) + lista.join(', '));
  } catch { console.log('  (nao foi possivel ler o relatorio)'); }
});
'@

Write-Host ''
Write-Host '  O QUE RODA NO PORTAL (dependencias de producao)' -ForegroundColor Cyan
npm audit --omit=dev --include=prod --json 2>$null | node -e $resumo

Write-Host ''
Write-Host '  FERRAMENTAS DE DESENVOLVIMENTO (nao entram no que roda)' -ForegroundColor DarkGray
npm audit --json 2>$null | node -e $resumo
Write-Host ''
