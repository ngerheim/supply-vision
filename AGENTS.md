# Supply Vision — IA

## Operação
- Claude e Codex: ler antes de editar; código e testes definem os contratos. Preservar comentários de motivo e conferir entradas, consumidores e testes antes de mudar comportamento.
- Servidor único definitivo Windows 11 Pro, somente LAN; inicialização em modo `computador`, conta do dono, sem sessão aberta. Sem migração entre máquinas.
- Portal direto em Node 24.20. Versão em `portal/package.json#engines.node`; regras em `portal/scripts/versao-node.mjs`. SQLite local único.
- Repositório público de portfólio, mantido apenas pelo dono. Dados reais, credenciais, bancos, relatórios e infraestrutura ficam fora do Git, fixtures e artefatos públicos.

## Mapa
| Caminho | Assunto |
|---|---|
| `supv.cmd`, `scripts/supv.ps1` | CLI; argumentos em `supv help` |
| `scripts/instalar.ps1`, `inicializacao-logica.ps1` | Instalação, tarefa e conta Windows |
| `scripts/supervisor.ps1`, `operacao-logica.ps1` | Agenda, processos, estado, health e chamadas nativas |
| `scripts/administracao-logica.ps1`, `diagnostico-logica.ps1` | Administração, diagnóstico e mascaramento |
| `scripts/atualizar-servidor.ps1`, `atualizacao-preparo.ps1` | Atualização, isolamento, dependências, CI e rollback |
| `portal/app/api/[...path]/route.ts`, `portal/lib/*-api.ts` | Roteamento e handlers por assunto; contrato em `api-compartilhada.ts` |
| `portal/lib/database.ts`, `sqlite-local.ts`, `controle-escrita.ts` | Schema/sessões, adaptador SQLite, revisões e travas |
| `portal/lib/domain.ts`, `importacao.ts`, `limites-entrada.ts` | Validação, publicação e limites |
| `portal/components/`, `portal/lib/atualizacao-periodica.ts` | Telas, estado, permissões visuais e polling |
| `portal/scripts/iniciar-portal.mjs`, `servidor-node.mjs`, `configuracao-servidor.mjs` | Partida, HTTP/assets, IP e configuração do servidor |
| `portal/scripts/banco-local.mjs`, `sqlite-local.mjs` | Localizador único e executor SQLite |
| `portal/scripts/processar-{emails,relatorios}.mjs` | Consumidores e filas |
| `portal/scripts/backup.mjs`, `restaurar-backup.mjs`, `restauracao-segura.mjs`, `trava-restauracao.mjs` | Backup, restauração e exclusão mútua |
| `alertas/processo/pipeline.py`, `rodar.py`, `leitura_dados.py` | Execução diária, comparação e leitura |
| `alertas/processo/{contrato_base,contrato_comparacao,regras_comparacao,vigencia_acordos,qualidade_acordos}.py` | Extração Qlik, regras, vigência e pendências |
| `alertas/processo/{resumo_comparacao,planilhas_comparacao,limpeza}.py`, `alertas/panorama/` | Saídas, retenção e recortes sem envio |
| `scripts/verificar-infra-publica.mjs`, `portal/tests/`, `alertas/tests/`, `scripts/testar-*.ps1`, `.github/workflows/ci.yml` | Detector, testes e CI |

Caminhos abreviados nas células mantêm o diretório do primeiro arquivo.

## Invariantes
- `SUPPLY_VISION_PRIVADO` seleciona a raiz privada (padrão `privado/`). Leitores: Node `portal/scripts/configuracao.mjs`/`caminhos.mjs`, Python `sv_paths.py`, PowerShell `Obter-PastaPrivada`/`Ler-ConfigOperacao`. Modelos em `*.env.example` e `*.exemplo.*`; conferir precedência no leitor.
- Banco: `portal/scripts/banco-local.mjs` concentra `localizarBanco()`, `diretorioBanco()` e `destinoBanco()` para Portal, consumidores, PowerShell e testes. Preservar nome e diretório relativo `portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/` sob a raiz privada. Não buscar recursivamente nem escolher entre bases ambíguas. Operação nunca cria banco ausente; criação de fixture exige `PORTAL_CRIAR_BANCO=1` e ensaio/CI, no destino fixo `portal.sqlite`.
- SQLite: WAL, timeout de lock finito, escritas em `BEGIN IMMEDIATE` com rollback integral; leituras em snapshot sem reserva antecipada de escritor. Publicação mantém dono, trava, revisão e auditoria atômicos. Não repetir automaticamente escritas ou HTTP mutante; não apagar WAL/SHM.
- API sempre aplica autenticação e perfis viewer/editor/admin; alterações administrativas invalidam sessões. Poll `x-portal-poll: 1` não renova atividade humana. Manter limites de corpo/ZIP/XLSX, SQL parametrizado, datas civis e precisão monetária; validação e publicação compartilham regras.
- Servidor: configuração por lista fechada, ambiente sobrepõe arquivo; segredos fora de build, bundle e argumentos. Login usa IP do socket; cabeçalhos encaminhados não o substituem. Servir apenas assets de `dist/client`, barrando caminhos reservados e symlinks externos; preservar CSP e validação Power BI.
- PREPARAR nunca altera a instalação: operação permanece no ar; worktree, configuração fictícia, caches e dependências fisicamente isolados, sem dados reais, hardlinks ou junctions para a instalação. Não desativar `isolamento-preparo.mjs`/hooks SQLite: vedam I/O fora da raiz física e conexões alheias à fixture, inclusive portas operacionais 3000/3001. Portas de teste reservadas pelo SO.
- TROCAR concentra a parada; CONCLUIR valida interface, supervisor e consumidores/heartbeats recentes. HTTP 200 isolado não basta. Rollback preserva código, artefatos e cópia íntegra anterior; reserva exige inventário/compatibilidade. Não religar com banco incompatível, dados ambíguos ou recuperação incompleta.
- `supv atualizar` rápido só reutiliza CI do SHA alvo, ou de PR mesclada com árvore idêntica e cobertura única dos checks. Obrigatórios de GitHub Actions: `Portal`, `Portal - instalacao nova e autenticacao real`, `PowerShell`, `Alertas`, `Atualizacao real`. Ausente, ambíguo ou pendente não aprova; único skipped permitido: `Atualizacao real`, conforme guardas em `Consultar-CIPreparo`/`Consultar-CIPRIdentica`. Falha conhecida da main bloqueia TROCAR; pendência espera até 30 min com cancelamento cooperativo. Consulta indisponível/prazo esgotado usa completo; `--completo` força suites locais. Rápido mantém build, validação/teste operacional e fumaça. Sem-parada exige allowlist nos dois commits, salvo reparo/completo.
- Windows PowerShell 5.1: capturar stderr nativo (`2>&1`/`*> $null`) só via `Executar-NativoOperacao`; decidir por `codigo`, preservando saída e preferências. Após guardar `Start-Process -PassThru`, capturar imediatamente `[void]$p.Handle`, antes de Refresh/HasExited/WaitForExit/ExitCode. Manter guardas de `scripts/ci/testar-chamadas-nativas.ps1`, BOM existente e política LF/CRLF de `.gitattributes`.
- Processos: identidade por PID + início e vínculo à instalação; nunca matar só por nome ou substituir tarefa alheia. Parada encerra árvore Node/Python e fecha SQLite/portas. Health tem prazo local finito além do cancelamento HTTP. Preservar agenda diária, slots e marcadores ao reiniciar.
- Entregas: slot mantém data original; SMTP incerto exige reconciliação, sem reenvio automático. Restauração neutraliza filas antigas e exige confirmação de reenvio; reinício normal preserva novas. Consumidores revalidam permissões; download exige autorização e vínculo ao pedido. Relatório diário preparado conserva período/conteúdo nas retentativas.
- Qlik: reduzir colunas após extração; não colapsar linhas mudando dimensões do hipercubo. Referência inválida/ambígua gera pendência/quarentena, nunca preço zero ou vigência artificial. Relatórios e limpeza compartilham lock.
- Backup consistente via VACUUM INTO, origem somente leitura; destino único na rede (`BACKUP_NETWORK_DIR`), retenção de 14 dias. Pacote `.7z` LZMA2 `-mx=9`, AES-256 e nomes cifrados (`-mhe=on`); senha somente por `supv backup senha`, via DPAPI da conta do dono, nunca no repositório nem em logs.
- Horários em `operacao.env` (13:30 e 20:59 no servidor). Falha de rede: novas tentativas a cada 10 min por 1 h; depois enviar o mesmo `.7z` por e-mail ao administrador, respeitando `BACKUP_EMAIL_MAX_MB`.
- Snapshot local `pre-atualizacao` antes de trocar versão. Validar com `supv backup testar` em cópia descartável; restauração real por `supv backup restaurar`, com operação parada e exclusão mútua com consumidores/SQLite. Preservar base anterior e única cópia válida. Exportação funcional não substitui backup; semente é privada.
- `MODO_ENSAIO=1` impede SMTP e backup de rede; supervisor reaplica aos filhos (ausente = 0). Diagnósticos mascaram segredos.
- Detector: executar `scripts/verificar-infra-publica.mjs`; não afrouxar para passar conteúdo. Barra IP privado, UNC, DNS local, máquinas, contas e links compartilhados Power BI. Em textos, nomes com nome e sobrenome separados por ponto também são contas; usar rótulos sem ponto, sem remontar identidades reais. Exceções só nos caminhos explícitos de testes/exemplos. Lista local opcional `privado/termos-proibidos.txt`: UTF-8, termos literais sem distinção de caixa, um por linha; ignora vazias/`#`; nunca publicar lista real.
- Antivírus: em falhas `write EOF`/`unable to unlink`, conferir locks e Bitdefender, inclusive controle avançado de ameaças; liberar a pasta pode não bastar. Após corrigir proteção ou instalar Visual C++ x64, reiniciar e validar a partida.
- SheetJS vendorizado: preservar licença, hash oficial e integrity do lock; atualização exige revisão explícita.

## Validação e fluxo
- Codex implementa; uma PR por etapa, commit/push sem esperar CI e encerrar após abrir a PR. Integração por **rebase and merge**. Instalação em uso só recebe código por `supv atualizar`; não deixar alterações locais nela.
- Executar checks relevantes com fixtures fictícias descartáveis; Linux não substitui PowerShell 5.1, tarefa, firewall ou console Windows. Não copiar SQL/limites da implementação para testes.
- Portal (em `portal/`): `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`; importação: `npm run test:imports`; restauração: `npm run test:restore -- --fixture`.
- Raiz: `python -m pytest alertas/tests -q`, `ruff check alertas`; detector: `node --test portal/tests/infra-publica.test.mjs` e `node scripts/verificar-infra-publica.mjs`.
- PowerShell: `./scripts/ci/testar-chamadas-nativas.ps1`, `./scripts/testar-supv.ps1`, `./scripts/testar-health-local.ps1`; preparo: `./scripts/testar-dependencias-preparo.ps1`, `./scripts/testar-fases-atualizacao.ps1`, `./scripts/testar-espera-testes.ps1`, `./scripts/testar-espera-ci.ps1`.
- Atualização real (H2, Windows): `$env:SV_TESTES_INTEGRACAO_WINDOWS='1'`; `./scripts/testar-atualizacao-real.ps1 -BaseRef origin/main -DestinoRef HEAD`. Preservar continuidade PREPARAR/CONCLUIR, parada TROCAR e recuperação; sem mocks de build/suites.
- Ao alterar testes/CI, conferir referências, inclusive chamadas PowerShell montadas dinamicamente: `node scripts/ci/verificar-testes.mjs`.
