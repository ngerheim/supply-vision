# Supply Vision — Agent Guide

Guidance for coding agents working in this repository. Code and tests define the contracts; this file records the invariants that are easy to break and the commands that validate a change. Before changing behavior, read the entry points, the consumers and the tests involved, and keep comments that explain *why*.

## Context
- Internal procurement tool: a Portal (Node 24, local SQLite) for supplier agreements, price imports, tickets and reports, plus a Python job (Alertas) that compares purchases against agreements and e-mails the results. Node reference: `portal/package.json#engines.node`; compatibility rules: `portal/scripts/versao-node.mjs`.
- Runs on a single, permanent Windows 11 Pro server on the company LAN, started with the computer under a configured Windows account, with no interactive session. There is no fresh-install path and no machine migration; do not add one.
- The repository is public. Real data, credentials, databases, reports and infrastructure details never enter Git, fixtures, logs or CI artifacts.

## Map
| Path | Responsibility |
|---|---|
| `supv.cmd`, `scripts/supv.ps1` | Operator CLI; arguments in `supv help` |
| `scripts/inicializacao-logica.ps1` | Startup, scheduled task and Windows account |
| `scripts/supervisor.ps1`, `operacao-logica.ps1` | Schedule, child processes, state, health, native calls |
| `scripts/administracao-logica.ps1`, `diagnostico-logica.ps1` | Administration, diagnostics, secret masking |
| `scripts/atualizar-servidor.ps1`, `atualizacao-preparo.ps1` | Update flow: isolation, dependencies, CI gate, rollback |
| `portal/app/api/[...path]/route.ts`, `portal/lib/*-api.ts` | Routing and handlers by subject; shared contract in `api-compartilhada.ts` |
| `portal/lib/database.ts`, `sqlite-local.ts`, `controle-escrita.ts` | Schema and sessions, SQLite adapter, revisions and locks |
| `portal/lib/domain.ts`, `importacao.ts`, `limites-entrada.ts` | Validation, publication, input limits |
| `portal/components/`, `portal/lib/atualizacao-periodica.ts` | Screens, client state, visual permissions, polling |
| `portal/scripts/iniciar-portal.mjs`, `servidor-node.mjs`, `configuracao-servidor.mjs` | Startup, HTTP and assets, client IP, server configuration |
| `portal/scripts/banco-local.mjs`, `sqlite-local.mjs` | Single database locator and SQLite executor |
| `portal/scripts/processar-{emails,relatorios}.mjs` | Queue consumers |
| `portal/scripts/backup.mjs`, `restaurar-backup.mjs`, `restauracao-segura.mjs`, `trava-restauracao.mjs` | Backup, restore, mutual exclusion |
| `alertas/processo/pipeline.py`, `rodar.py`, `leitura_dados.py` | Daily run, comparison, data reading |
| `alertas/processo/{contrato_base,contrato_comparacao,regras_comparacao,vigencia_acordos,qualidade_acordos}.py` | Source extraction, rules, validity periods, data-quality issues |
| `alertas/processo/{resumo_comparacao,planilhas_comparacao,limpeza}.py`, `alertas/panorama/` | Outputs, retention, send-free views |
| `scripts/verificar-infra-publica.mjs`, `portal/tests/`, `alertas/tests/`, `scripts/testar-*.ps1`, `.github/workflows/ci.yml` | Public-data detector, tests, CI |

Abbreviated paths in a cell share the directory of the first file.

## Invariants

### Configuration and data location
- The company logo lives at `<private root>/portal/marca/logo.svg` and is never versioned.
- `SUPPLY_VISION_PRIVADO` selects the private root (default `privado/`). Readers: Node `portal/scripts/configuracao.mjs` and `caminhos.mjs`, Python `sv_paths.py`, PowerShell `Obter-PastaPrivada` and `Ler-ConfigOperacao`. Templates live in `*.env.example` and `*.exemplo.*`; check precedence in the reader before relying on it.
- `portal/scripts/banco-local.mjs` is the only database locator (`localizarBanco`, `diretorioBanco`, `destinoBanco`) for the Portal, consumers, PowerShell and tests. Keep the file name and `portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/` under the private root. Never search recursively or choose between ambiguous databases. Operation never creates a missing database; fixtures create `portal.sqlite` only with `PORTAL_CRIAR_BANCO=1` and either `MODO_ENSAIO=1` or `CI=true`.

### SQLite and API
- WAL mode, finite lock timeout, writes in `BEGIN IMMEDIATE` with full rollback, reads from a snapshot without reserving the writer. Publication keeps owner, lock, revision and audit atomic. Never retry writes or mutating HTTP calls automatically; never delete an active database's WAL/SHM files.
- Protected API routes enforce authentication and viewer/editor/admin permissions; health and session probes, login/logout and the internal token route have separate handling. Password resets, deactivation and role changes invalidate the affected user's sessions. Polling (`x-portal-poll: 1`) does not count as user activity. Keep body/ZIP/XLSX limits, parameterized SQL, civil dates and monetary precision. Validation and publication share rules; publication must match the preview.
- Server configuration comes from a closed key list; environment overrides file. Secrets stay out of the build, the bundle and process arguments. Login uses the socket IP; forwarded headers never replace it. Serve only `dist/client` assets, blocking reserved paths and external symlinks; keep the CSP and the embedded-report URL validation.

### Update flow (`supv atualizar`)
- PREPARE never touches the live installation: the Portal stays up while code, configuration, caches and dependencies are built in a physically isolated copy with fictitious data, no hardlinks or junctions into the installation. Do not disable `isolamento-preparo.mjs` or the SQLite hooks; they block I/O outside the copy and connections outside fixtures, including operational ports. Test ports are reserved by the OS.
- SWAP holds the only downtime; COMPLETE validates the interface, the supervisor and recent consumer heartbeats — an isolated HTTP 200 is not enough. Rollback restores code, artifacts and the last consistent copy. Dependency reserves require inventory and compatibility checks. Never restart on an incompatible database, ambiguous data or an incomplete recovery.
- The update requires the new `main` to descend from the installed commit; a divergent history stops it.
- Fast mode reuses CI only for the target SHA, or a merged PR with an identical tree and unique check coverage. Required GitHub Actions checks: `Portal`, `Portal - instalacao nova e autenticacao real`, `PowerShell`, `Alertas`, `Atualizacao real`. **Never rename these jobs.** Missing or ambiguous required checks block reuse. On `main`, `Atualizacao real` and its matrix groups may be skipped; PR reuse accepts only the aggregator's skip with a matching `main` skip (`Consultar-CIPreparo`, `Consultar-CIPRIdentica`, `Testar-H2PuladoNaMain`). Unless full mode is forced, a known `main` failure blocks SWAP. Pending checks allow identical-tree PR reuse or up to 30 minutes of cooperatively cancellable waiting; unavailable queries or expiry use full mode. `--completo` forces local suites. Fast mode still builds, validates and smoke-tests. The no-stop path requires the changed-path allowlist on both commits and is disabled in repair or full mode.

### Windows and processes
- Windows PowerShell 5.1: capture native stderr only through `Executar-NativoOperacao`; decide by `codigo`, preserving output and caller preferences. After `Start-Process -PassThru`, read `[void]$p.Handle` immediately, before `Refresh`, `HasExited`, `WaitForExit` or `ExitCode`. Keep the guards in `scripts/ci/testar-chamadas-nativas.ps1`, existing BOMs and the line-ending policy in `.gitattributes`.
- Process identity is PID plus start time plus binding to the installation; never kill by name or replace a task that is not ours. Stopping ends the whole Node/Python tree and releases SQLite files and ports. Health checks have a finite local deadline besides HTTP cancellation. Restarts preserve the daily schedule, slots and markers.
- If file operations fail with `write EOF` or `unable to unlink`, check file locks and the endpoint protection's behavior monitoring before anything else; excluding the folder may not be enough. After correcting protection or installing Visual C++ x64, restart and validate startup.

### Deliveries, backup and restore
- A slot keeps its original date. An uncertain SMTP outcome requires reconciliation; nothing is resent automatically. Consumers re-check permissions; downloads require authorization and a link to the request. A prepared daily report keeps its period and content across retries.
- Restore: pending/processing e-mail notifications and daily deliveries become failed and require manual resend; queued report jobs enter review and running jobs fail; sessions are cleared. On the restore day, Alertas slots and daily deliveries scheduled at or before the cutoff are suppressed; the cutoff expires at the next civil day. A normal restart keeps new queue items.
- Backups use `VACUUM INTO` from a read-only source to a single network destination (`BACKUP_NETWORK_DIR`) with 14-day retention, packaged as `.7z` (LZMA2, `-mx=9`, AES-256, encrypted names). The password is set only through `supv backup senha`, stored with the service account's DPAPI, never in the repository or logs. If the network is unavailable, retry every 10 minutes for an hour, then e-mail the same package to `BACKUP_EMAIL_TO` or, if unset, `ADMIN_ALERTA_EMAIL`; above `BACKUP_EMAIL_MAX_MB`, send only an alert. Schedules live in the private `operacao.env`.
- A local `pre-atualizacao` snapshot is taken before every swap. Test with `supv backup testar` on a disposable copy; real restores use `supv backup restaurar` with operation stopped and mutual exclusion against consumers. Keep the previous database and the only valid copy. Functional exports are not backups.
- `MODO_ENSAIO=1` blocks SMTP and network backup; the supervisor propagates it to children (absent means 0). Diagnostics mask secrets.

### Alertas data
- Reduce columns after extraction; never collapse rows by changing the dimensions of the source cube. Invalid or ambiguous references become data-quality issues or quarantine, never a zero price or an artificial validity period. Reports and cleanup share a lock.

### Public-data safety
- Run `node scripts/verificar-infra-publica.mjs`; never loosen it to let content through. It blocks private IPs, UNC paths, local DNS names, machine and account names and shared report links. In prose, given names and surnames joined by a dot count as accounts; use labels without dots and never reassemble real identities. Exceptions exist only in the explicit test and example paths.
- Optional local list `privado/termos-proibidos.txt` (UTF-8, literal, case-insensitive, one term per line, blank lines and `#` ignored). Never publish the real list.
- Vendored SheetJS: keep the license, the official hash and the lockfile integrity; upgrades require explicit review.

## Local demonstration
- Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/demonstracao.ps1` (PowerShell 5.1); use `-Porta 3100`, `-Pasta <absolute private directory>` and optionally `-Recriar`. Stop with Ctrl+C in the same console. Data and `credenciais.json` default to `%LOCALAPPDATA%/supply-vision-demo`, outside the checkout. Published example passwords belong only to this fictitious database.
- The launcher shares build/start helpers with the end-to-end fixture, always forces `MODO_ENSAIO=1`, creates a database only on first startup, and binds only to `127.0.0.1`. It starts no supervisor, Alertas or scheduled tasks. Real private roots, installations, the checkout, foreign databases and links/junctions are refused. Recreating requires the demo sentinel and database identity. A per-directory mutex prevents concurrent launch/recreation; cleanup verifies PID, start time and entry point before stopping its own process tree.

## Versioning
- `3.0` = a new module or a change in how the Portal is used; `2.x` = a closed set of improvements; `2.9.x` = a fix worth recording. Day-to-day updates get no number.
- The version lives in `portal/package.json` and changes in the PR that closes the version. The `vX.Y.Z` tag goes on the `main` commit deployed to the server. `supv status` and the Portal sidebar show it.

## Changes and validation
- Small PRs, integrated with **rebase and merge**. Rebase onto `main` before fixing a branch when another PR landed in between. The live installation only receives code through `supv atualizar` and never holds local changes.
- Validate with the **same commands and arguments as `.github/workflows/ci.yml`** for the affected jobs, using disposable fictitious fixtures. Linux does not replace Windows PowerShell 5.1, scheduled tasks, firewall or console behavior. Do not copy SQL or limits from the implementation into tests.
- Portal (in `portal/`): `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`; imports: `npm run test:imports`; restore: `npm run test:restore -- --fixture`.
- Root: `python -m pytest alertas/tests -q`, `ruff check alertas`; detector: `node --test portal/tests/infra-publica.test.mjs` and `node scripts/verificar-infra-publica.mjs`.
- PowerShell: `./scripts/ci/testar-chamadas-nativas.ps1`, `./scripts/testar-supv.ps1`, `./scripts/testar-health-local.ps1`; update preparation: `./scripts/testar-dependencias-preparo.ps1`, `./scripts/testar-fases-atualizacao.ps1`, `./scripts/testar-espera-testes.ps1`, `./scripts/testar-espera-ci.ps1`.
- Real update (Windows PowerShell 5.1): `$env:SV_TESTES_INTEGRACAO_WINDOWS='1'; $env:SV_PREPARO_COMPLETO='1'`; run `./scripts/testar-atualizacao-real.ps1 -BaseRef origin/main -DestinoRef HEAD -LimiteSegundos 1800 -Grupo atualizacao` and repeat with `-Grupo reversao`. Keep PREPARE/COMPLETE continuity, the SWAP stop and recovery; no build or suite mocks.
- `Atualizacao real` runs the Portal and Alertas suites inside the PREPARE isolation. New tests must pass there too: fixtures use OS-reserved test ports and never touch the operational ports.
- Changes to API behavior must also pass `./portal/scripts/teste-portal-ponta-a-ponta.ps1` (job `Portal - instalacao nova e autenticacao real`), whose scenarios exercise existing flows end to end.
- Python dependencies are pinned to exact versions (`alertas/config/requirements*.txt`), like the Node lockfile; Dependabot proposes upgrades with its cooldown. Never reintroduce version ranges.
- When changing tests or CI, check references in the workflow and in the `scripts/ci/` drivers, including PowerShell names built in loops: `node scripts/ci/verificar-testes.mjs`.
- In tests, scan HTML by index (as in `portal/tests/csp-nonce-smoke.test.mjs`); CodeQL flags HTML-matching regular expressions.
