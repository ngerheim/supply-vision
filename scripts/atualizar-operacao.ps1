# Worker independente usado pelo supv. Nunca aguarda o cliente.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{32}$')][string]$Execucao,[switch]$Completo)
$ErrorActionPreference='Stop'
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$privado=Obter-PastaPrivada $Raiz
$op=Join-Path $privado 'operacao'
$saida=Join-Path $op 'atualizacao-processo-saida.log';$erro=Join-Path $op 'atualizacao-erro.log'
$codigo=1;$filho=$null
try{
 $argumentos=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'atualizar-servidor.ps1'))
 if($Completo){$argumentos+='-ForcarCompleto'}
 $linha=(@($argumentos|ForEach-Object {Proteger-ArgumentoAtualizacao $_})-join' ')
 # O worker possui as capturas. Fechar a CLI nao fecha os pipes nem
 # interrompe a drenagem do stdout/stderr do atualizador (PS5.1).
 $filho=Start-Process powershell.exe -ArgumentList $linha -NoNewWindow -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erro
 [void]$filho.Handle
 $filho.WaitForExit();$filho.Refresh();$codigo=$filho.ExitCode
 if($null-eq$codigo){$codigo=1}
} catch {
 [IO.File]::AppendAllText($erro,($_.Exception.Message+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
 $codigo=1
}finally{
 if($filho){$filho.Dispose()}
 Gravar-EstadoOperacao (Join-Path $op 'atualizacao-resultado.json') @{execucao=$Execucao;codigo=$codigo;fim=[datetime]::UtcNow.ToString('o')}
}
exit $codigo
