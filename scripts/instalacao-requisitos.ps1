function Testar-VisualCpp {
 $r=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
 return $r-and$r.Installed-eq1-and[int]$r.Major-ge14
}
function Garantir-VisualCpp([switch]$SomenteVerificar){
 if(Testar-VisualCpp){return}
 if($SomenteVerificar){throw 'Microsoft Visual C++ Redistributable 2015+ x64 ausente. Execute INSTALAR.bat.'}
 Write-Host 'Instalando Microsoft Visual C++ Redistributable 2015+ x64, necessario ao Portal.'
 $w=(Get-Command winget.exe -ErrorAction Stop).Source
 & $w install --id 'Microsoft.VCRedist.2015+.x64' --exact --scope machine --silent --accept-package-agreements --accept-source-agreements
 if($LASTEXITCODE-or!(Testar-VisualCpp)){throw 'Visual C++ x64 nao ficou disponivel. Reinicie o Windows e execute a instalacao novamente.'}
}
function Executar-WorkerdVersao([string]$Exe){
 $saida=(& $Exe --version 2>&1|Out-String)
 return @{saida=$saida;codigo=$LASTEXITCODE}
}
function Conferir-Workerd([string]$Portal){
 $exe=Join-Path $Portal 'node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe'
 if(!(Test-Path -LiteralPath $exe)){throw 'workerd.exe ausente. Confira o antivirus e execute npm.cmd ci na pasta portal.'}
 try{$r=Executar-WorkerdVersao $exe;$saida=$r.saida;$codigo=$r.codigo}catch{$codigo=1}
 if($codigo-or$saida-notmatch 'workerd'){throw 'O motor do Portal (workerd) nao executou. Confira Visual C++ Redistributable 2015+ x64 e o antivirus. Reinicie apos instalar; consulte AGENTS.md#diagnostico-e-recuperacao (write EOF).'}
 Write-Host 'Motor do Portal (workerd) executou corretamente.'
}
function Avisar-Bitdefender {
 $achou=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue|Where-Object displayName -Match 'Bitdefender')
 if(!$achou){$achou=@(Get-Service -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName-match 'Bitdefender'})}
 if(!$achou){$achou=@(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue|Where-Object {$_.PathName-match 'Bitdefender'})}
 if($achou){Write-Host 'BITDEFENDER detectado: peca a TI exclusao da pasta da instalacao no antimalware em tempo real e no controle avancado de ameacas antes de continuar. O assistente nao altera o antivirus.' -ForegroundColor Yellow}
}
