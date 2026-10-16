# Supply Vision — mapa para IA

## Escopo e regras de alteracao

- Este e o mapa unico do repositorio. Codex o carrega pela raiz; Claude deve le-lo
  explicitamente antes de alterar o projeto. Motivos locais ficam junto do codigo.
- Produto: acordos comerciais, chamados, comparacao de compras e alertas.
- A operacao usa um unico servidor Windows 11 Pro definitivo na LAN, com Portal,
  supervisor e consumidores locais. Nao ha mais migracao entre maquinas.
- A fonte de verdade e o codigo e seus testes; nao copie limites ou SQL nos testes.
- Preserve comentarios de motivo, invariantes e restricoes de compatibilidade.
  Remova apenas comentarios que repetem literalmente a instrucao seguinte.
- Dados reais, credenciais, parametros, relatorios e bancos pertencem a `privado/`.
  Nunca os inclua no Git, em fixtures, logs publicados ou artefatos de CI.
- Exemplos versionados sao ficticios. Nao reconstrua nomes reais por concatenacao.
- Antes de mudar comportamento, identifique entradas, consumidores e testes;
  chamadas PowerShell podem ser construidas por nome em lacos do CI.
- Uma instalacao em uso recebe commits publicados por `supv atualizar`.
  Alteracoes locais nessa instalacao impedem a atualizacao segura.

## Pontos de entrada

| Caminho | Responsabilidade |
|---|---|
| `supv.cmd`, `scripts/supv.ps1` | CLI; `supv help` define comandos e argumentos |
| `INSTALAR.bat`, `scripts/instalar.ps1` | Instalacao e pre-requisitos |
| `scripts/supervisor.ps1` | Agenda, processos, health, reinicio e estado |
| `scripts/operacao-logica.ps1` | Contratos puros, estado e consultas de health |
| `scripts/inicializacao-logica.ps1` | Tarefa, conta e inicializacao Windows |
| `scripts/administracao-logica.ps1` | Estado agregado e comandos administrados |
| `scripts/diagnostico-logica.ps1` | Mascaramento e relatorios de diagnostico |
| `scripts/atualizar-servidor.ps1` | Coordenacao da atualizacao e recuperacao |
| `scripts/atualizacao-preparo.ps1` | Worktree, portas, dependencias e gates do PREPARAR |
| `portal/app/api/[...path]/route.ts` | Roteamento HTTP, autenticacao, origem, corpo JSON e erros comuns |
| `portal/lib/sessao-api.ts`, `usuarios-api.ts` | Login, logout e administracao de usuarios; SQL junto dos handlers |
| `portal/lib/acordos-api.ts`, `catalogos-api.ts`, `mapeamentos-api.ts` | Acordos, condicoes, busca de precos, cadastros e De/Para |
| `portal/lib/importacoes-api.ts`, `chamados-api.ts` | Importacao/publicacao e operacoes de chamados |
| `portal/lib/auditoria-api.ts`, `notificacoes-api.ts`, `exportacoes-api.ts` | Historico, entregas/reenvio de e-mail e downloads |
| `portal/lib/bootstrap-api.ts`, `api-compartilhada.ts` | Dados iniciais e contrato comum dos modulos da API |
| `portal/lib/controle-escrita.ts` | SQL puro de revisoes e travas, sem importar database.ts |
| `portal/lib/database.ts` | Schema, migracoes, sessoes e cookies |
| `portal/lib/domain.ts`, `importacao.ts` | Validacao, normalizacao e publicacao |
| `portal/components/portal-app.tsx` | Estado da interface e permissoes visuais |
| `portal/lib/atualizacao-periodica.ts` | Consultas automaticas, debounce e salvar/atualizar |
| `portal/components/portal-*.tsx` | Telas por assunto, navegacao e apresentacao compartilhada |
| `portal/components/imports.tsx`, `import-*.tsx` | Envio, previa, correspondencias, resumo, erros e historico de importacao |
| `portal/components/reports.tsx` | Relatorios |
| `portal/scripts/iniciar-portal.mjs` | Configuracao e partida do runtime |
| `portal/scripts/runtime-local.mjs` | Wrangler, proxy e encerramento da arvore |
| `portal/scripts/processar-emails.mjs` | Filas de chamados e relatorio diario |
| `portal/scripts/processar-relatorios.mjs` | Pedidos Python, arquivos e redacao de logs |
| `alertas/processo/pipeline.py` | Orquestracao diaria e entrega |
| `alertas/processo/rodar.py` | Entrada diaria e API de compatibilidade da comparacao |
| `alertas/processo/leitura_dados.py` | Leitura e normalizacao de Qlik e Portal |
| `alertas/processo/contrato_comparacao.py`, `regras_comparacao.py` | Estados, motivos e classificacao das compras |
| `alertas/processo/vigencia_acordos.py`, `qualidade_acordos.py` | Vigencia, parametros e pendencias dos acordos |
| `alertas/processo/resumo_comparacao.py`, `planilhas_comparacao.py` | Indicadores, saida estruturada e planilhas |
| `alertas/panorama/executar.py` | Recorte historico sem e-mail |
| `alertas/processo/contrato_base.py` | Contrato da extracao Qlik |

## Configuracao e dados privados

- `SUPPLY_VISION_PRIVADO` seleciona a raiz privada; padrao: `privado/` do produto.
- Modelos: `compartilhado/*.env.example`, `portal/portal.env.example`,
  `alertas/config/*.exemplo.txt` e `alertas/parametros/**/*.exemplo.*`.
- `privado/comum/`: `operacao.env` e `smtp.env`; `privado/portal/configuracao/`:
  `portal.env`; `privado/alertas/config/`: configuracao Qlik e destinatarios.
- Parametros reais: `privado/alertas/parametros/{de_para,filtros}`.
- Estado operacional: `privado/operacao/`; logs Portal: `privado/portal/logs/`;
  extracoes, logs e relatorios Alertas: respectivas pastas em `privado/alertas/`.
- Banco: `privado/portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/`.
  Identidade do binding e caminho existentes nao podem mudar numa refatoracao.
- Leitores Node: `portal/scripts/configuracao.mjs`; Python: `sv_paths.py`;
  PowerShell: `Obter-PastaPrivada` e `Ler-ConfigOperacao`.
- SMTP comum e sobreposto pela configuracao especifica quando existente.
  Conferir o leitor correspondente antes de introduzir outra precedencia.
- `PORTAL_URL` e a URL publica; `PORTAL_PORTA` e `RELATORIOS_PORTA` sao portas
  locais. HTTPS externo nao redefine a porta interna. Tokens nao vao ao bundle.
- `MODO_ENSAIO=1` impede envios SMTP e backup de rede; previews locais permanecem.
  O supervisor reaplica a configuracao ao ambiente dos filhos; ausente significa 0.
- `ADMIN_ALERTA_EMAIL` vazio desliga avisos; avisos usam SMTP comum e controle
  separado por evento. Reserva antecede SMTP, inclusive falha ou entrega incerta.
- `privado/termos-proibidos.txt` e opcional: UTF-8, um termo literal por linha,
  busca sem distinguir caixa, linhas vazias e comentarios com `#` ignorados.
  Modelo ficticio: `privado.exemplo/termos-proibidos.exemplo.txt`; CI nao usa lista real.
- O detector genericamente verifica IPv4 privado completo, UNC, DNS local,
  nomes de maquina, contas e links compartilhados de Power BI. Expressoes de
  codigo e nomes de arquivos precisam ser distinguidos de contas literais.
  Excecoes de nomes limitam-se aos caminhos explicitos de testes e exemplos.

## Portal e banco

- Workers executa interface e API mesmo na instalacao local. SQLite nativo e
  executado no Node por `scripts/sqlite-local.mjs`, acessado pelo adaptador
  `lib/sqlite-local.ts`; nao e uma extensao nativa carregada no workerd.
- SQLite local e o unico banco operacional. A chave legada `PORTAL_BANCO_LOCAL`
  continua aceita no portal.env, mas e ignorada e nao vai ao Worker.
- A criacao do arquivo inexistente ainda passa pelo D1 para preservar identidade.
  Bases existentes no modo sqlite usam SQL parametrizado pela ponte autenticada.
- WAL permite leitores durante escrita, mas apenas um escritor por vez.
  Executor, consumidores e expurgo usam timeout de lock; ele nao e espera ilimitada.
- Lotes de escrita usam `BEGIN IMMEDIATE` e rollback integral; lotes somente de
  leitura usam snapshot sem adquirir antecipadamente a reserva do escritor.
- Nao introduza retentativa de escritas ou de requisicoes HTTP mutantes.
- Permissoes da API sao obrigatorias mesmo quando a interface esconde o controle.
  Perfis: viewer, editor e admin; alteracoes administrativas invalidam sessoes.
- Senhas: PBKDF2 com salt individual e custo gravado. Sessoes guardam hash do token,
  validade maxima de 12 horas e inatividade de duas horas.
- Poll marcado com `x-portal-poll: 1` valida sessao sem renovar atividade humana.
- `limites-entrada.ts` concentra limites e chave de idempotencia; corpo recebido
  e limitado mesmo sem Content-Length. Erro de entrada vira 400; detalhe interno nao.
- ZIP/XLSX tem limites antes da abertura; validacao e publicacao compartilham regras.
  Travas, dono, revisao e auditoria precisam permanecer atomicos na publicacao.
- Preservar datas civis e a precisao monetaria. Identidade inclui UF quando exigida;
  parametros privados e normalizacao participam da comparacao.
- Proxy local fecha conexoes depois da resposta completa para evitar sockets
  ociosos encerrados pelo workerd; nao corrige falhas repetindo requisicoes.
- Power BI e montado no servidor a partir da configuracao privada e validado por
  `lib/powerbi.ts`; `PBI_PAGINA` seleciona a pagina interna. Manter CSP e
  restricoes de URL sem publicar links reais.

## Alertas e entregas

- Extracao Qlik: `baixar_base.py`, `panorama/baixar_periodo.py` e `qlik.py`.
  Reducao de colunas ocorre depois da extracao: reduzir dimensoes do hipercubo
  pode colapsar linhas antes da validacao. Preservar o contrato da base.
- Slot identifica a data original da execucao, inclusive tentativas apos meia-noite.
  Agenda concluida e estado de entrega impedem envio duplicado apos reinicio.
- Uma resposta SMTP incerta nao autoriza reenvio automatico. Reconciliar estado
  em `privado/alertas/estado-envios` antes de qualquer nova entrega.
- Referencias invalidas ou ambiguas geram pendencias/quarentena; nao viram preco
  zero, cortesia, vigencia ilimitada ou periodo artificialmente sem divergencias.
- `pipeline.py --sem-envio` produz preview. `panorama/executar.py --inicio
  DD/MM/AAAA --fim DD/MM/AAAA` gera recorte sem enviar e-mail, inclusive em pedidos
  antigos com destinatario salvo. Comandos Python partem da pasta `alertas/`.
- Relatorios, recortes e limpeza compartilham o lock de arquivos.
- Historicos expiram 24 horas apos geracao; logs Alertas duram cinco dias.
  `processo/limpeza.py --dry-run` permite verificar alvos sem excluir.
- Worker so enfileira; o consumidor local valida novamente permissoes antes de
  executar Python. Download exige autorizacao, vinculo ao pedido e arquivo permitido.
- Restauracao neutraliza filas antigas e exige confirmacao de reenvio; reinicio
  normal preserva pedidos novos. Nao confundir esses dois eventos.
- Relatorio diario de chamados mantem periodo e conteudo estaveis nas retentativas;
  novas edicoes nao podem mudar retroativamente uma entrega ja preparada.

## Supervisor e atualizacao

- `supv help` e a referencia de argumentos. Entradas principais: iniciar, parar,
  status, logs, atualizar, config validar e backup testar.
- Inicializacao: computador com a conta de dominio do dono (ContaPersonalizada),
  sem sessao aberta; desligado desativa. Configuracao explicita pede credencial.
  Tarefa existente e preservada sem exigir novo formato, conta ou reconfiguracao.
  Tarefa deve pertencer a esta instalacao; nunca substituir outra tarefa ou matar
  processos so pelo nome.
- PID inclui instante de inicio para evitar confundir reutilizacao do numero.
- A parada encerra a arvore Wrangler/workerd/Python, fecha SQLite explicitamente
  e verifica handles/portas; encerrar apenas o launcher deixa descendentes vivos.
- Nao apagar WAL/SHM para simular parada. A recuperacao desses arquivos pertence
  ao SQLite; termino abrupto nao garante finally do JavaScript.
- Health tem prazo local alem do cancelamento do HttpClient; agendamento do
  ThreadPool nao pode transformar uma espera cancelada em espera indefinida.
  Antes do primeiro health da partida, registra uma espera unica por ate 3 minutos.
- Agenda por dia sobrepoe agenda geral; valor diario vazio significa nao executar.
  Preservar slots e marcadores de entrega ao modificar inicializacao ou agenda.
- Atualizacao: PREPARAR valida worktree/configuracao/dependencias/build/testes com
  operacao no ar; TROCAR e a janela de parada; CONCLUIR valida a nova operacao.
  Allowlist sem referencias operacionais nos dois commits permite fast-forward sem
  parada/preparo, salvo reparo/completo; contexto e status registram sem-parada.
  Health apos religar consulta imediatamente e a cada 500 ms por ate 120 s.
- Nao copiar dados reais para o preparo nem desativar suas guardas para fazer testes.
  Portas sao reservadas pelo SO; configuracao, perfil Wrangler e caches sao descartaveis.
- `isolamento-preparo.mjs` barra I/O fora da raiz fisica e conexoes alheias a fixture;
  hooks SQLite preservam a mesma barreira para imports ESM.
- CI reutilizado exige SHA/arvore e checks esperados; integracao H2 pode forcar
  suites completas. Nao considerar check ausente, pendente ou skipped como aprovacao.
- Reserva de dependencias requer inventario e compatibilidade; rollback preserva
  a copia anterior se a reposicao falhar. Recuperacao nao pode religar dados ambiguos.
- O pai de atualizacao 6ef675c entrega contexto codigo, preparo e artefatos
  instalados; preservar esse salto no check Atualizacao real, inclusive recuperacao.
- Scripts Windows devem continuar compativeis com PowerShell 5.1. Preservar BOM
  quando existente e strings interpoladas ASCII onde a copia sem BOM e exercitada.
- `.gitattributes` guarda LF no indice e entrega CRLF aos scripts Windows.

## Backup e restauracao

- `portal/scripts/backup.mjs` faz copia consistente por VACUUM INTO com origem
  somente leitura. Copia local e replica antecedem validacao SMTP.
- `restaurar-backup.mjs`, `restauracao-segura.mjs` e `trava-restauracao.mjs`
  exigem operacao parada e exclusao mutua com consumidores e ponte SQLite.
- Restauracao usa copia integra verificada e preserva a base anterior; nao
  sobrescrever a unica copia de recuperacao nem assumir que exportacao funcional e backup.
- Semente inclui codigo, configuracao e dados privados; tratar como material privado.
  Preparacao/restauracao conferem o supervisor real e a consistencia da copia.
- Retencao e replica de rede nao podem excluir a unica copia valida ao falhar.
- Validacao relevante: `supv backup testar`, testes de backup/restauracao e integridade.

## Diagnostico e recuperacao

- `supv status`, `supv config validar`, `supv logs supervisor` e
  `supv logs atualizacao` sao as entradas de diagnostico; ver argumentos em `supv help`.
- Health 200 sozinho nao prova operacao: exigir estado recente do supervisor,
  consumidores de e-mail/relatorios e seus heartbeats. Nao prova acesso Qlik/SMTP.
- Diagnostico preserva logs e mascara segredos; nao publicar excecoes brutas.
  Relatorio de homologacao e somente leitura e nao altera os dados operacionais.
- Falha de logon da tarefa exige conferir conta, permissao e senha configurada;
  evitar reinicios repetidos sem resolver a causa. Troca de senha exige reconfiguracao.
- `write EOF`/`unable to unlink`: verificar runtime, locks e antivirus. Bitdefender
  pode bloquear pelo controle avançado de ameaças; liberar pasta pode nao bastar.
  Requisito nativo: Visual C++ Redistributable 2015+ x64; pode exigir reiniciar.
- Antes de retorno de versao, conferir compatibilidade do banco e consistencia das
  copias. Nao reiniciar a operacao se a recuperacao ou reconciliacao estiver incompleta.

## Comandos de validacao por mudanca

Comandos Node/npm do Portal partem de `portal/`; os demais partem da raiz.
Usar dados ficticios e ambientes descartaveis; Windows real exige maquina de teste.

| Tipo de mudanca | Verificacao |
|---|---|
| Portal/TypeScript | `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` |
| Extracao/regras Python | `python -m pytest alertas/tests -q`; `ruff check alertas` |
| Detector/integridade | `node --test portal/tests/infra-publica.test.mjs`; `node scripts/verificar-infra-publica.mjs` |
| CLI/console | `./scripts/testar-supv.ps1`; Windows exercita Ctrl+C real e restauracao QuickEdit |
| PREPARAR/dependencias | `./scripts/testar-dependencias-preparo.ps1`, `testar-fases-atualizacao.ps1`, `testar-espera-testes.ps1` |
| Health/parada | `./scripts/testar-health-local.ps1`; `node --test portal/tests/runtime-local.test.mjs` |
| Banco local | `node --test --experimental-strip-types tests/sqlite-local.test.ts tests/runtime-local.test.mjs` |
| Importacao/HTTP | `npm run test:imports` (SQLite local) |
| Backup/restauracao | Testes `backup-*`, `restauracao-*` e `npm run test:restore -- --fixture` |
| Inventario | `node scripts/inventario-metricas.mjs`; `--ref SHA` compara revisao sem checkout |

- Dependencias Python: `requirements.txt`, `requirements-dev.txt` e `requirements-ci.txt`.
- CI `.github/workflows/ci.yml`: parser/PSScriptAnalyzer, Portal, integracao Windows,
  atualizacao real em PR e Alertas. Referencias explicitas a testes sao conferidas
  por `scripts/ci/verificar-testes.mjs`; ensaio e tarefa sao distintos.
- H2 (PowerShell): `$env:SV_TESTES_INTEGRACAO_WINDOWS='1'`; executar
  `./scripts/testar-atualizacao-real.ps1 -BaseRef origin/main -DestinoRef HEAD`.
  Instala a base do merge-base e atualiza
  pelo codigo real, sem mocks de build/suites. Fixture e monitor pertencem a TEMP.
- H2 verifica continuidade em PREPARAR/CONCLUIR, parada em TROCAR, reserva reutilizada,
  migracoes e recuperacao; negativo vem primeiro. Timeout informa fase e encerra arvore.
- Artefatos publicos de CI contem somente diagnosticos ficticios, nunca bancos/snapshots.
- Suites Linux nao substituem PowerShell 5.1, tarefa com conta de usuario, firewall e console Windows.

## Dependencias especiais e runtime local

- Fonte unica da versao Node: `portal/package.json`, campo `node` de `engines`.
  CI usa node-version-file; instalacao e PREPARAR exigem o mesmo major/minor.
  Partida exige o major definido e minor minimo; outra diferenca aceita gera aviso.
  `portal/scripts/versao-node.mjs` aplica estas regras; preservar o proxy local.
- SheetJS local e copia oficial integra, licenca incluida; hash fixado no verificador
  e integrity no lockfile. Atualizacao exige revisao explicita: Dependabot nao cobre o tarball.
- Adaptador fast-glob oferece somente sync ao plugin de importacao; nao e substituto
  geral da API. Preservar semantica de arquivos e revisar quando atualizar o consumidor.
- O plugin Cloudflare do Vite e Wrangler/workerd continuam executando o Portal
  localmente. O binding em vite.config.ts apenas preserva a identidade existente
  e inicializa o arquivo SQLite ausente; nao ha alvo de deploy remoto.
