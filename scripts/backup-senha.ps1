# Windows PowerShell 5.1: DPAPI sem -Key pertence ao usuario atual.
[CmdletBinding()]
param([switch]$Ler)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$arquivo=Join-Path (Obter-PastaPrivada (Split-Path $PSScriptRoot)) 'comum/backup-senha.dpapi'
$primeira=$null;$segunda=$null;$ponteiro=[IntPtr]::Zero;$outro=[IntPtr]::Zero
try {
 if($env:OS-ne'Windows_NT'){throw 'DPAPI exige Windows.'}
 if($Ler){
  # Saida exclusiva do pipe anonimo do Node; nunca chamar -Ler pelo supv.
  $primeira=ConvertTo-SecureString ([IO.File]::ReadAllText($arquivo).Trim())
  $ponteiro=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($primeira)
  [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
  [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro))
 }else{
  $primeira=Read-Host 'Senha do backup' -AsSecureString
  $segunda=Read-Host 'Repita a senha do backup' -AsSecureString
  if($primeira.Length-eq0-or$primeira.Length-ne$segunda.Length){throw 'Senhas diferentes ou vazias.'}
  $ponteiro=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($primeira)
  $outro=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($segunda)
  for($i=0;$i-lt$primeira.Length;$i++){
   $caractere=[Runtime.InteropServices.Marshal]::ReadInt16($ponteiro,$i*2)
   if($caractere-in@(0,10,13)-or$caractere-ne[Runtime.InteropServices.Marshal]::ReadInt16($outro,$i*2)){throw 'Senhas diferentes ou invalidas.'}
  }
  [void][IO.Directory]::CreateDirectory((Split-Path $arquivo))
  $temporario=$arquivo+'.tmp'
  try{
   [IO.File]::WriteAllText($temporario,(ConvertFrom-SecureString $primeira),[Text.Encoding]::ASCII)
   if(Test-Path -LiteralPath $arquivo){[IO.File]::Replace($temporario,$arquivo,$null)}else{[IO.File]::Move($temporario,$arquivo)}
  }finally{Remove-Item -LiteralPath $temporario -Force -ErrorAction SilentlyContinue}
  Write-Host 'Senha de backup salva para o usuario atual.'
 }
}catch{throw 'Senha nao salva ou indisponivel. Use a conta do dono e confirme as duas entradas.'}
finally{
 if($ponteiro-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)}
 if($outro-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($outro)}
 if($primeira){$primeira.Dispose()};if($segunda){$segunda.Dispose()}
}
