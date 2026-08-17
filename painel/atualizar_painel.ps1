<#
    Encadeia a atualizacao do painel numa unica tarefa agendavel.

        executar.py  ->  conferir.py  ->  (parquet publicado)

    O conferir.py e PORTEIRO, nao relatorio: se alguma identidade numerica
    falhar, o script aborta e o parquet consolidado NAO e trocado. Assim o
    Power BI nunca faz refresh sobre um dado que ja se sabe inconsistente.

    O refresh no Servico e agendado separadamente, no proprio Power BI, com
    folga sobre este horario -- a extracao do Qlik leva ate ~400s e o timeout
    do executar.py e 1000s.

    Uso manual:
        powershell -ExecutionPolicy Bypass -File painel\atualizar_painel.ps1

    No Agendador de Tarefas:
        Programa:   powershell.exe
        Argumentos: -NoProfile -ExecutionPolicy Bypass -File "C:\Projetos\supply-vision-privado\painel\atualizar_painel.ps1"
        Iniciar em: C:\Projetos\supply-vision-privado
        Marcar "Executar estando o usuario conectado ou nao" NAO funciona aqui:
        o gateway pessoal e aplicacao interativa e precisa da sessao ativa.
        Use "Executar somente quando o usuario estiver conectado".
#>
[CmdletBinding()]
param(
    [string] $Raiz = 'C:\Projetos\supply-vision-privado',
    # Sem extrair do Qlik, para reprocessar a base ja baixada.
    [switch] $SemExtrair
)

$ErrorActionPreference = 'Stop'
Set-Location $Raiz

$logDir = Join-Path $Raiz 'painel\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$log   = Join-Path $logDir "atualizar_$stamp.log"

function Registrar([string] $texto) {
    $linha = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto
    Write-Host $linha
    Add-Content -Path $log -Value $linha -Encoding utf8
}

$inicio = Get-Date
Registrar "inicio | raiz=$Raiz | semExtrair=$SemExtrair"

try {
    # ── 1. pipeline ─────────────────────────────────────────────────
    $args = @('painel\executar.py')
    if ($SemExtrair) { $args += '--sem-extrair' }
    Registrar "executando: python $($args -join ' ')"
    & python @args 2>&1 | ForEach-Object { Registrar "  [exec] $_" }
    if ($LASTEXITCODE -ne 0) {
        throw "executar.py saiu com codigo $LASTEXITCODE"
    }

    # ── 2. porteiro ─────────────────────────────────────────────────
    # Roda DEPOIS da publicacao do parquet porque o conferir.py le o
    # consolidado. Se ele reprovar, o parquet anterior esta em
    # painel\arquivados e a restauracao e manual e consciente -- preferivel a
    # um rollback automatico que ninguem percebe.
    Registrar "conferindo identidades numericas"
    & python 'painel\powerbi\gerador\conferir.py' 2>&1 |
        ForEach-Object { Registrar "  [conf] $_" }
    if ($LASTEXITCODE -ne 0) {
        throw "conferir.py reprovou o parquet (codigo $LASTEXITCODE) -- NAO atualize o painel"
    }

    $dur = [int]((Get-Date) - $inicio).TotalSeconds
    Registrar "CONCLUIDO em ${dur}s | log em $log"
    exit 0
}
catch {
    Registrar "FALHOU: $($_.Exception.Message)"
    # Codigo 1 faz o Agendador marcar a tarefa como falha, o que e visivel no
    # historico. Sem isso, uma falha silenciosa passa por execucao bem-sucedida.
    exit 1
}
