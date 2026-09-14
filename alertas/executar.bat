@echo off
REM ===================================================================
REM  SUPPLY VISION - ponto unico de execucao manual
REM
REM  Uso:  executar.bat relatorio   -> executa o relatorio agora
REM        executar.bat limpeza     -> housekeeping (move p/ archive)
REM        executar.bat debug       -> roda o pipeline aqui, com console
REM        executar.bat recorte     -> analise historica, pergunta o periodo
REM        executar.bat paralelo    -> gera tudo sem enviar e-mail
REM
REM  O recorte tambem aceita as datas direto:
REM        executar.bat recorte DD/MM/AAAA DD/MM/AAAA
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
echo   [1] Gerar e enviar relatorio agora
echo   [2] Limpeza de arquivos (mover para archive)
echo   [3] Rodar pipeline aqui (debug, com console)
echo   [4] Recorte historico (escolher periodo)
echo   [5] Execucao paralela (sem enviar e-mail)
echo.
set /p "OPC=  Opcao: "
if "%OPC%"=="1" set "ACAO=relatorio"
if "%OPC%"=="2" set "ACAO=limpeza"
if "%OPC%"=="3" set "ACAO=debug"
if "%OPC%"=="4" set "ACAO=recorte"
if "%OPC%"=="5" set "ACAO=paralelo"

:despacho
if /i "%ACAO%"=="relatorio" goto relatorio
if /i "%ACAO%"=="limpeza"   goto limpeza
if /i "%ACAO%"=="debug"     goto debug
if /i "%ACAO%"=="recorte"   goto recorte
if /i "%ACAO%"=="paralelo"  goto paralelo
echo.
echo  ERRO: acao desconhecida "%ACAO%".
echo  Use: executar.bat [relatorio^|limpeza^|debug^|recorte^|paralelo]
echo.
pause
exit /b 1

REM ------------------------------------------------------------------
:relatorio
call :carregar_python || exit /b 1
echo.
echo  Gerando e enviando o relatorio agora...
echo.
pushd "%~dp0processo"
"%PYTHON%" pipeline.py
set "RC=%errorlevel%"
popd
echo.
if "%RC%"=="0" (echo  Relatorio concluido.) else (echo  ERRO: pipeline terminou com codigo %RC%.)
echo.
pause
exit /b %RC%

REM ------------------------------------------------------------------
:paralelo
call :carregar_python || exit /b 1
echo.
echo  Gerando relatorios e preview do e-mail, sem entrega SMTP...
echo.
pushd "%~dp0processo"
"%PYTHON%" pipeline.py --sem-envio
set "RC=%errorlevel%"
popd
echo.
if "%RC%"=="0" (echo  Concluido sem envio. Confira privado\alertas\relatorios\diarios\previews-email\) else (echo  ERRO: pipeline terminou com codigo %RC%.)
echo.
pause
exit /b %RC%
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
  echo  Concluido. Resultado em privado\alertas\logs\limpeza_AAAAMMDD_HHMM.log
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
echo.
set /p "DE=  Data inicial : "
set /p "ATE=  Data final   : "
if "%DE%"=="" (
  echo.
  echo  ERRO: informe as duas datas.
  echo.
  pause
  exit /b 1
)
if "%ATE%"=="" (
  echo.
  echo  ERRO: informe as duas datas.
  echo.
  pause
  exit /b 1
)

:rodar_recorte
echo.
"%PYTHON%" "%~dp0panorama\executar.py" --inicio "%DE%" --fim "%ATE%"
set "RC=%errorlevel%"
echo.
if "%RC%"=="0" (
  echo  Relatorio em privado\alertas\relatorios\historicos\
) else (
  echo  ERRO: o recorte terminou com codigo %RC%.
)
echo.
pause
exit /b %RC%

REM ------------------------------------------------------------------
:carregar_python
call "%~dp0..\privado\alertas\config\ambiente.bat"
if not defined PYTHON (
  echo.
  echo  ERRO: privado\alertas\config\ambiente.bat ausente ou sem a variavel PYTHON.
  echo  Copie alertas\config\ambiente.exemplo.bat para privado\alertas\config\ambiente.bat.
  echo.
  pause
  exit /b 1
)
exit /b 0
