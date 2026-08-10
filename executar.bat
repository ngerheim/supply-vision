@echo off
REM ===================================================================
REM  SUPPLY VISION - ponto unico de execucao manual
REM
REM  Uso:  executar.bat relatorio   -> dispara a tarefa agendada
REM        executar.bat limpeza     -> housekeeping (move p/ archive)
REM        executar.bat debug       -> roda o pipeline aqui, com console
REM        executar.bat recorte     -> analise historica, pergunta o periodo
REM
REM  O recorte tambem aceita as datas direto:
REM        executar.bat recorte 01/07/2026 31/07/2026
REM
REM  Sem argumento, abre um menu.
REM ===================================================================
setlocal
set "ACAO=%~1"
if not "%ACAO%"=="" goto despacho

echo.
echo  ========================================================
echo    SUPPLY VISION
echo  ========================================================
echo.
echo   [1] Disparar relatorio agora (tarefa agendada)
echo   [2] Limpeza de arquivos (mover para archive)
echo   [3] Rodar pipeline aqui (debug, com console)
echo   [4] Recorte historico (escolher periodo)
echo.
set /p "OPC=  Opcao: "
if "%OPC%"=="1" set "ACAO=relatorio"
if "%OPC%"=="2" set "ACAO=limpeza"
if "%OPC%"=="3" set "ACAO=debug"
if "%OPC%"=="4" set "ACAO=recorte"

:despacho
if /i "%ACAO%"=="relatorio" goto relatorio
if /i "%ACAO%"=="limpeza"   goto limpeza
if /i "%ACAO%"=="debug"     goto debug
if /i "%ACAO%"=="recorte"   goto recorte
echo.
echo  ERRO: acao desconhecida "%ACAO%".
echo  Use: executar.bat [relatorio^|limpeza^|debug^|recorte]
echo.
pause
exit /b 1

REM ------------------------------------------------------------------
:relatorio
call :carregar_python || exit /b 1
if not defined TAREFA_RELATORIO (
  echo.
  echo  ERRO: TAREFA_RELATORIO nao definida em config\ambiente.bat.
  echo.
  pause
  exit /b 1
)
echo.
echo  Disparando a tarefa agendada...
schtasks /Run /TN "%TAREFA_RELATORIO%" >nul 2>&1
if errorlevel 1 (
  echo.
  echo  ERRO: nao foi possivel disparar. Verifique se a tarefa
  echo  "%TAREFA_RELATORIO%" existe no Agendador de Tarefas.
  echo.
  pause
  exit /b 1
)
echo.
echo  OK. O relatorio esta sendo gerado em segundo plano.
echo  Os e-mails serao enviados automaticamente ao concluir.
timeout /t 7 >nul
exit /b 0

REM ------------------------------------------------------------------
:limpeza
call :carregar_python || exit /b 1
echo.
echo  Rodando limpeza...
echo.
"%PYTHON%" "%~dp0processo\limpeza.py"
set "RC=%errorlevel%"
echo.
if "%RC%"=="0" (
  echo  Concluido. Resultado em logs\limpeza_AAAAMMDD_HHMM.log
) else (
  echo  ERRO: a limpeza terminou com codigo %RC%.
)
echo.
pause
exit /b %RC%

REM ------------------------------------------------------------------
:debug
call :carregar_python || exit /b 1
echo.
echo  Rodando o pipeline neste console...
echo.
pushd "%~dp0processo"
"%PYTHON%" pipeline.py
set "RC=%errorlevel%"
popd
echo.
if not "%RC%"=="0" echo  ERRO: o pipeline terminou com codigo %RC%.
echo.
pause
exit /b %RC%

REM ------------------------------------------------------------------
:recorte
call :carregar_python || exit /b 1
set "DE=%~2"
set "ATE=%~3"
if not "%DE%"=="" if not "%ATE%"=="" goto rodar_recorte
echo.
echo  ========================================================
echo    RECORTE HISTORICO
echo  ========================================================
echo.
echo   Periodo a analisar, formato DD/MM/AAAA.
echo   As duas datas entram no recorte.
echo   Deixe em branco para usar o que esta em panorama\recorte.py
echo.
set /p "DE=  Data inicial : "
set /p "ATE=  Data final   : "
if "%DE%"=="" goto rodar_recorte
if "%ATE%"=="" (
  echo.
  echo  ERRO: informe as duas datas, ou nenhuma.
  echo.
  pause
  exit /b 1
)

:rodar_recorte
echo.
if "%DE%"=="" (
  "%PYTHON%" "%~dp0panorama\executar.py"
) else (
  "%PYTHON%" "%~dp0panorama\executar.py" --inicio "%DE%" --fim "%ATE%"
)
set "RC=%errorlevel%"
echo.
if "%RC%"=="0" (
  echo  Relatorios em reports_periodo\
) else (
  echo  ERRO: o recorte terminou com codigo %RC%.
)
echo.
pause
exit /b %RC%

REM ------------------------------------------------------------------
:carregar_python
call "%~dp0config\ambiente.bat"
if not defined PYTHON (
  echo.
  echo  ERRO: config\ambiente.bat ausente ou sem a variavel PYTHON.
  echo  Copie config\ambiente.exemplo.bat para config\ambiente.bat.
  echo.
  pause
  exit /b 1
)
exit /b 0
