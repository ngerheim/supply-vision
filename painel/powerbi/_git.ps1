$ErrorActionPreference = 'Continue'
Set-Location 'C:\Projetos\supply-vision'
foreach ($f in @('_aplicar.ps1','_aplicar.log','_check.ps1','_check.log','_conc.py','_conc.log')) {
  Remove-Item (Join-Path 'painel\powerbi' $f) -Force -ErrorAction SilentlyContinue
}
Get-ChildItem '.git' -Recurse -Filter '*.lock' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
$log = 'painel\powerbi\_git.log'
git add painel/powerbi 2>&1 | Out-Null
git -c user.name="Norberto Gerheim" -c user.email="suprimentos@locfrotas.com.br" commit -F painel\powerbi\_msg.txt 2>&1 | Select-Object -First 2 | Out-File -FilePath $log -Encoding utf8
git log --oneline -1 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
git status --short 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
