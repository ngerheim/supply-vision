if(!(Get-Command Executar-NativoOperacao -ErrorAction SilentlyContinue)){. (Join-Path $PSScriptRoot 'operacao-logica.ps1')}
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
 $r=Executar-NativoOperacao $Exe @('--version')
 return @{saida=($r.saida|Out-String);codigo=$r.codigo}
}
function Avisar-Bitdefender {
 $achou=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue|Where-Object displayName -Match 'Bitdefender')
 if(!$achou){$achou=@(Get-Service -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName-match 'Bitdefender'})}
 if(!$achou){$achou=@(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue|Where-Object {$_.PathName-match 'Bitdefender'})}
 if($achou){Write-Host 'BITDEFENDER detectado: peca a TI exclusao da pasta da instalacao no antimalware em tempo real e no controle avancado de ameacas antes de continuar. O assistente nao altera o antivirus.' -ForegroundColor Yellow}
}
