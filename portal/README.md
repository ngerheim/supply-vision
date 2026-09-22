# Portal Suprimentos

Portal interno para acordos comerciais, consulta de preços e
chamados. Roda na LAN, em `http://localhost:3000/` na própria máquina.

Este documento reúne o guia de uso, a operação e a parte técnica. Para
instalar, operar o conjunto ou socorrer a operação, veja `docs/` na raiz.

---

# Parte 1 — Uso diário

## Como abrir

A operação é iniciada e encerrada pela central **`Supply Vision.bat`**, na raiz
do produto. Ela controla o Portal, os e-mails, os Alertas e os backups.

Em outro computador, `localhost` aponta para aquele computador, não para o
servidor. Use o endereço de rede (`PORTAL_URL`).

## Primeiro acesso

E-mail e senha são fornecidos pelo administrador. Cada navegador mantém uma
sessão independente. Uma conta compartilhada de consulta não identifica qual
pessoa realizou cada acesso; use contas individuais quando isso for necessário.

Tentativas incorretas recebem atraso progressivo. O processo também limita
logins simultâneos a quatro em execução e dezesseis aguardando; além disso,
responde que está ocupado e orienta tentar novamente. São limites iniciais de
proteção de recursos, ainda sujeitos à homologação no notebook-servidor.

## Perfis

| Perfil | O que pode fazer |
|---|---|
| **Consulta** | Buscar preços e ver acordos. Não cadastra, não importa, não vê chamados nem histórico |
| **Comprador** | Tudo do Consulta, mais cadastrar acordos, importar planilhas, abrir e tratar chamados e mexer nos cadastros |
| **Administrador** | Tudo do Comprador, mais gerenciar usuários, ver o histórico de modificações e exportar a base |

## As abas

- **Buscar** — preços por Estado, cidade, peça/serviço, modelo e fornecedor.
  Combine os filtros; não existe busca por texto livre. Acima de 1.000
  resultados o portal avisa e sugere refinar.
- **Chamados** — fornecedores a negociar. Cada um tem código (`SUP-0001`) e
  passa por Aberto → Aguardando fornecedor → Fechado ou Cancelado, com linha
  do tempo de andamentos.
- **Acordos** — lista, cadastro e edição. Vigente ou Suspenso é escolhido no
  cadastro; **Expirado** aparece sozinho quando a data de fim vence.
- **Fornecedores** — nome, razão social, CNPJ, cidade e UF.
- **Importações** — carga de planilhas.
- **De/Para** *(Admin)* — correspondências confirmadas para itens, modelos
  e unidades. Localidades são cadastradas diretamente.
- **Cadastros** *(Comprador/Admin)* — peças e serviços, modelos, unidades
  e localidades.
- **Histórico** *(Admin)* — tudo que foi alterado, por quem e quando, com
  filtros e paginação de 50.
- **Usuários** *(Admin)* — contas, perfis, exportação, fila de e-mails e
  configuração do relatório diário.

## Pesquisa

Nos campos de texto, acentos e maiúsculas não fazem diferença: `peca` encontra
`PEÇA`. Espaços repetidos são normalizados.

## Cadastrar do zero

1. Cadastre fornecedor, itens, modelos, unidades e localidades.
2. Crie o acordo com número, fornecedor, início, fim opcional e localidades.
3. Inclua as condições à mão ou importe a tabela em **Importações**.
4. Consulte em **Buscar**.
5. Para atualizar depois, use **Importações → Substituir um acordo**: uma
   versão nova é criada e a anterior fica preservada.

## Importar planilhas

Lê a **primeira aba** de um `.xlsx` ou `.xls`, com cabeçalho na primeira linha.
É tolerante: a ordem das colunas não importa, nomes parecidos são aceitos
(`PEÇA/SERVIÇO`, `PECA_SERVICO`, `ITEM`) e preço aceita número ou `R$ 1.234,56`.

Colunas obrigatórias: `CIDADE`, `UF`, `MODELO`, `PECA_SERVICO`, `PRECO` e
`MEDIDA`. `MARCAS` e `FORNECEDOR` são opcionais. O fornecedor é sempre o do
acordo escolhido, independentemente dessas colunas, e a importação não cria
fornecedores, itens, modelos nem localidades: o que faltar é cadastrado antes.

1. Escolha o acordo de destino e o arquivo.
   O botão **Baixar modelo** entrega um Excel com os cabeçalhos necessários.
2. Clique em **Conferir arquivo**. Essa etapa não publica acordos nem preços.
3. Confira as pendências agrupadas por nome. Administradores podem escolher
   uma sugestão ou pesquisar o cadastro e **Confirmar e lembrar correspondência**.
   A escolha fica no De/Para para as próximas importações. Sugestões nunca são
   aplicadas automaticamente. Compradores podem corrigir a planilha ou solicitar
   a confirmação a um administrador.
4. Confira a amostra, os totais e as duplicatas, e então clique em **Publicar**.
   A publicação revalida todo o arquivo; uma prévia anterior não dispensa validação.

Itens e modelos exigem De/Para explícito, inclusive quando o nome já é canônico.
Unidades ativas aceitam o nome cadastrado ou uma correspondência confirmada.
Localidades precisam estar cadastradas na substituição; não possuem De/Para.
Uma UF digitada errada deve ser corrigida; o cadastro só aceita UFs brasileiras.
Preços inválidos e células obrigatórias vazias são corrigidos na planilha.

Para a mesma cidade **e UF**, item e modelo, a importação mantém o menor preço.
Empates mantêm a primeira linha. O resultado informa os descartes; unidades
diferentes na mesma condição abortam a carga. Cidades homônimas em UFs diferentes
continuam sendo condições distintas.

**Todas as linhas precisam ser válidas.** Uma falha recusa a planilha inteira e
nada é publicado; a tabela anterior continua valendo. Preço zero é aceito e
aparece como cortesia.

Cabeçalhos deslocados e linhas vazias são tratados preservando a indicação da
linha física. Evite células mescladas e subtotais no meio dos dados.
Várias abas funcionam: as demais são ignoradas.
Arquivos que não sejam planilha de verdade são recusados mesmo com extensão
`.xlsx`, porque o conteúdo é verificado, não o nome.

## Excluir cadastros

Fornecedores e itens de **Cadastros** podem ser excluídos. Se estiverem em uso,
o portal recusa e informa quantos — nesse caso inative em vez de excluir.

Administradores podem excluir acordos após confirmação: as condições e versões
do acordo são apagadas; chamados relacionados são preservados sem o vínculo.
Também é possível remover condições individualmente. Chamado aberto por engano
deve ser cancelado.

## Se a página ficar sem aparência

Atualize com **Ctrl + F5**. Se continuar, avise o responsável. Não reinstale
dependências nem compile sobre o portal aberto.

---

# Parte 2 — E-mails dos chamados

O portal avisa por e-mail quando um chamado muda:

- **atribuição e reatribuição** — apenas o novo responsável;
- **andamento e atualização** — solicitante e responsável;
- **conclusão e cancelamento** — solicitante e responsável.

Se solicitante e responsável forem a mesma pessoa, ela recebe uma única
mensagem por evento. Conclusão e cancelamento exigem mensagem explicando o
resultado.

As alterações e suas notificações entram **juntas** numa fila persistente no
próprio banco. Por isso uma indisponibilidade do SMTP não desfaz a alteração do
chamado. São até cinco tentativas, com espera de 1, 5, 15, 60 e 240 minutos.

Administradores acompanham a fila na aba **Usuários** e podem reenviar
**apenas** as notificações que esgotaram as tentativas.

## Relatório diário

Administradores escolhem, por usuário, quem recebe e em qual horário. O
relatório traz os totais por situação e os eventos do dia, no fuso
`America/Sao_Paulo`. Cada destinatário recebe no máximo uma cópia por dia,
mesmo que o serviço reinicie.

As preferências ficam em `daily_report_enabled` e `daily_report_time` na tabela
`users`; a tabela `daily_report_deliveries` registra a entrega por usuário e
data, o que impede duplicidade após reinício.

---

# Parte 3 — Atualizar o Portal

O portal no ar é a **versão compilada**. Alterar o código e reiniciar mantém a
versão antiga.

**`Atualizar Portal.cmd`** prepara o código numa pasta separada, verifica,
compila e testa com banco descartável, e só então troca a versão em uso. A
versão anterior fica em `work/versao-*/anterior`; se a candidata falhar ao
iniciar, o atualizador restaura a anterior sozinho.

O retorno cobre **o build**, não alterações no banco nem em dependências.
Migração de dados e mudança de dependência exigem procedimento próprio. Nunca
instale pacotes com o portal em execução.

## Validação obrigatória antes de ativar

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. build Vinext
5. `scripts/teste-instalacao-nova.ps1 -UsarBuildExistente`
6. `scripts/saude-completa.mjs` — API, HTML, CSS e JavaScript
7. auditoria das dependências de produção

A saúde completa confere API, HTML, CSS e JavaScript: um HTTP 200 na API não
comprova que a tela está funcionando.

Para testar a versão compilada sem tocar na que está em uso:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/teste-instalacao-nova.ps1 -UsarBuildExistente
node scripts/saude-completa.mjs
```

Esse modo testa o build existente, não mudanças posteriores no código-fonte.
`npm run build` direto é bloqueado se a porta 3000 estiver ocupada.

No notebook servidor, a atualização não é feita assim: use
`scripts\atualizar-servidor.ps1`, que busca a versão publicada, testa e reverte
sozinho. Veja `docs/OPERAR.md`.

---

# Parte 4 — Técnico

## Estrutura

| Caminho | Finalidade |
|---|---|
| `app/` | Página, estilos e API |
| `components/` | Tela do portal e os componentes visuais |
| `lib/` | Banco, regras, validações, importação e e-mails |
| `lib/importacao.ts` | Validação e deduplicação compartilhadas pela conferência e publicação |
| `components/imports.tsx` | Conferência, resolução assistida e histórico de importações |
| `components/agreement-dialogs.tsx` | Cadastro manual de acordos e condições |
| `public/` | Ícone público |
| `scripts/` | Operação, atualização, testes, backup e monitoramento |
| `tests/` | Testes automatizados |
| `dist/` | Versão compilada em uso |
| `node_modules/` | Dependências |
| `work/versao-*/anterior/` | Único build anterior, para retorno |

O banco, a configuração e os backups **não** ficam aqui: vivem em `privado/`,
na raiz do produto, que o Git ignora. Credenciais SMTP nunca vão para
documentação, commit ou exportação.

## Banco e segurança

SQLite via D1 local. Senhas com PBKDF2, salt individual e 600.000 iterações.
Sessões guardadas como hash, com expiração em 12 horas e também por
inatividade. Limitação progressiva de tentativas de login, perfis `viewer`,
`editor` e `admin`, trilha de auditoria e validação de limites de entrada.

Uploads são limitados pelos bytes realmente recebidos, mesmo sem
`Content-Length`. O importador verifica o contêiner ZIP/XLSX antes de abrir a
planilha e limita expansão, quantidade de entradas, nomes e estruturas
perigosas. A publicação é transacional, com trava contra importações
concorrentes.

Em instalação vazia, a senha inicial é entregue ao Worker pela variável
`INITIAL_ADMIN_PASSWORD`, declarada em `privado/portal/configuracao/portal.env`
— definir a variável só no PowerShell não a entrega. Quem repassa é o
`scripts/iniciar-portal.mjs`, usado pelos comandos `start`, `start:local` e
`start:lan`; só as chaves dessa lista fechada chegam ao Worker. Não há senha
padrão. Depois de criar as contas reais, desative a conta semente
`admin@portal.local` e apague a chave do `portal.env`.

`TRUSTED_PROXY=true` segue o mesmo caminho, e só deve ser ligado quando existir
um proxy reverso confiável à frente do Portal.

## Backup

`scripts/backup.mjs` localiza o banco, usa `VACUUM INTO` para gerar uma cópia
consistente mesmo com o portal em uso, roda `PRAGMA integrity_check` e
substitui atomicamente o backup. A cópia vai para o disco local e para o
compartilhamento de rede (`BACKUP_NETWORK_DIR`, com conferência SHA-256), e o
e-mail (`BACKUP_EMAIL_TO`) recebe o comprovante: data, tamanho, hash e onde a
cópia está. O banco não é anexado enquanto houver cópia de rede — ele carrega
hashes de senha e toda a base comercial. Sem cópia de rede o anexo volta, com
aviso, para não ficar sem redundância; `BACKUP_ANEXAR_BANCO=true` força o
anexo.

Cada execução substitui a anterior — **não há histórico rotativo**, por decisão
operacional. Os horários são definidos pelo supervisor em
`privado/comum/operacao.env`.

O botão de exportação da interface gera dados de negócio em JSON, sem senhas
nem sessões, e **não substitui** o backup SQLite.

## Recuperação

Se o banco for perdido: encerre a operação, confira o hash e rode
`PRAGMA integrity_check` na cópia, e restaure `portal-atual.sqlite` no local do
banco D1. Se a cópia local não estiver disponível, use a de rede ou o último
anexo recebido por e-mail.

> O nome do arquivo do banco é derivado do binding pelo miniflare. Restaurar
> com outro nome faz o miniflare ignorar a cópia e criar um banco vazio ao
> lado — o sintoma parece perda total de dados, mas é só o nome errado.

Se apenas a interface falhar após uma atualização, use o build `anterior` em
`work/`. O atualizador já faz esse retorno sozinho quando a verificação
pós-troca reprova a candidata.

## Importação

Aceita `.xlsx` e `.xls`, lê a primeira aba e exige todas as linhas válidas; uma
falha aborta a planilha inteira. Preço aceita número, moeda brasileira e zero
para cortesia.

A conferência e a publicação usam a mesma regra de duplicatas. A troca da
versão do acordo, o histórico de conclusão e a auditoria são
confirmados na mesma transação. Marcas da planilha ficam como texto livre da
condição comercial; não há cadastro de marcas.

A importação é sempre a substituição integral de um acordo. Ela cria uma
versão nova e preserva a anterior **dentro do banco**, para rastreabilidade do
negócio — isso não é backup histórico do arquivo.

O banco existente é preservado. As tabelas de De/Para são criadas vazias quando
ausentes, inclusive as de unidades e localidades. Não é preciso substituir
o arquivo SQLite nem preencher correspondências antecipadamente.

`npm run test:imports` testa HTTP real em uma instância e banco descartáveis:
prévia sem publicação, correspondências, rejeições sem alteração de negócio,
limites de volume, concorrência, exportação, reinicialização e atualização de banco.
Inclui falhas provocadas na gravação e na auditoria para verificar a reversão integral.
Inclui também permissões de consulta, dez logins simultâneos, independência do
logout, revogação por troca de senha/desativação e ondas de 10, 25, 50 e 100
requisições concorrentes com nove sessões, sobre um acordo com 10 mil condições.
O relatório registra mediana, percentil 95 e máximo de latência. Esses números
medem o computador onde o ensaio rodou, não certificam o servidor de produção.
Arquivos e relatórios sintéticos ficam em `work/`, fora do Git.

## Acesso pela rede

`Restringir Acesso da Rede.cmd` fecha o acesso pela LAN sem apagar dados.
`scripts/abrir-firewall-lan.ps1` libera a porta 3000, que o instalador não abre
por conta própria.
