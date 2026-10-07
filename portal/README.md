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

Esse limite de concorrência é global, não por usuário: um único computador da
rede enviando muitas tentativas pode ocupá-lo e fazer os demais receberem
"ocupado" por alguns instantes. É um risco aceito para uso na rede interna
(LAN), em troca de proteger a memória do servidor; não exponha o portal à
internet sem um proxy que limite requisições por origem.

## Perfis

| Perfil | O que pode fazer |
|---|---|
| **Consulta** | Grupo Consulta: Buscar e Manutenção. Pode abrir o detalhe de um preço a partir da busca; não acessa a lista de gestão de acordos |
| **Suprimentos** | Grupo Consulta e grupo Suprimentos: Chamados, Acordos, Fornecedores, Importações, Cadastros e De/Para |
| **Administrador** | Todos os grupos, incluindo Relatórios, Histórico, E-mails, Usuários e exportação da base |

O identificador interno `editor` permanece o mesmo; contas existentes recebem o
novo nome sem migração de perfil. As permissões são verificadas também na API.

## As abas

- **Buscar** — preços por Estado, cidade, peça/serviço, modelo e fornecedor.
  Cada lista mostra apenas opções presentes nas condições vigentes e compatíveis
  com as escolhas nos outros filtros. Por exemplo, um fornecedor restringe cidades,
  modelos e peças; uma cidade restringe fornecedores, modelos e peças. A própria
  lista mantém alternativas para acrescentar outras opções ao mesmo filtro.
  Selecione várias opções em cada filtro; as opções do mesmo campo são alternativas,
  e os campos são combinados. É possível marcar até 80 opções no total. A pesquisa
  de nomes dentro de cada filtro mantém as seleções anteriores. A lista permanece
  aberta ao marcar ou desmarcar opções, inclusive após digitar uma busca. Clique
  fora ou pressione **Esc** para fechar; as escolhas são aplicadas ao marcar. As seleções permanecem
  visíveis e podem ser removidas mesmo quando uma combinação não tem condições.
  As opções consideram toda a base de condições vigentes. Acima de 1.000
  resultados o portal avisa e sugere refinar.
- **Chamados** — fornecedores a negociar. Cada um tem código (`SUP-0001`) e
  passa por Aberto → Aguardando fornecedor → Fechado ou Cancelado, com linha
  do tempo de andamentos.
- **Acordos** — lista, cadastro e edição. Vigente ou Suspenso é escolhido no
  cadastro; **Agendado**, **A vencer** (até 60 dias) e **Expirado** são calculados pelas datas. O filtro Vigente inclui os acordos a vencer.
- **Fornecedores** — nome, razão social, CNPJ, cidade e UF.
- **Importações** — carga de planilhas.
- **De/Para** *(Suprimentos/Admin)* — correspondências confirmadas para itens, modelos
  e unidades. Localidades são cadastradas diretamente.
- **Cadastros** *(Suprimentos/Admin)* — peças e serviços, modelos, unidades
  e localidades.
- **Histórico** *(Admin)* — tudo que foi alterado, por quem e quando, com
  filtros e paginação de 50.
- **Manutenção** *(todos)* — relatório de manutenção no Power BI; não é o modo de pausa da central.
- **Relatórios** *(Admin)* — gerar/enviar relatório diário e recorte sem e-mail,
  fila, registros e download válido por 24 horas para históricos. Veja [operação](../docs/OPERAR.md#relatórios-no-portal).
- **E-mails** *(Admin)* — fila de notificações dos chamados.
- **Usuários** *(Admin)* — contas, perfis, exportação da base e configuração do relatório diário de chamados.

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
3. Confira as pendências agrupadas por nome. Suprimentos e administradores podem escolher
   uma sugestão ou pesquisar o cadastro e **Confirmar e lembrar correspondência**.
   A escolha fica no De/Para para as próximas importações. Sugestões nunca são
   aplicadas automaticamente. Corrija a planilha ou confirme explicitamente a correspondência.
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

Na aba **Chamados**, o fornecedor é obrigatório. Clique nos cabeçalhos para
alternar a ordenação, como em Acordos. A lista ocupa a largura disponível e
não exibe Título ou Local. O cadastro não solicita Título, CNPJ ou contato.
As mensagens de alteração de situação aparecem no histórico, junto da mudança.
Chamados antigos sem fornecedor recebem seu título anterior como identificação;
os títulos legados e demais dados já gravados são preservados no banco.

O portal avisa por e-mail quando um chamado muda:

- **atribuição e reatribuição** — apenas o novo responsável;
- **andamento e atualização** — solicitante e responsável;
- **conclusão e cancelamento** — solicitante e responsável.

Se solicitante e responsável forem a mesma pessoa, ela recebe uma única
mensagem por evento. Conclusão e cancelamento exigem mensagem explicando o
resultado.

As alterações e suas notificações entram **juntas** numa fila persistente no
próprio banco. Por isso uma indisponibilidade do SMTP não desfaz a alteração do
chamado. Falhas comprovadamente anteriores à aceitação SMTP permitem até cinco
tentativas. Reservas interrompidas e resultados incertos ficam como falha para
revisão manual; uma reserva vencida nunca autoriza reenvio automático.

Administradores acompanham a fila na aba **Usuários** e podem reenviar
as notificações com falha definitiva ou resultado incerto, depois de conferir a entrega.

## Relatório diário

Administradores escolhem, por usuário, quem recebe e em qual horário. O
relatório traz os totais por situação e os eventos do período desde o envio anterior, no fuso
`America/Sao_Paulo`. Há uma entrega registrada por usuário/dia. Reiniciar não
reenvia automaticamente entregas interrompidas: o resultado pode ser incerto e
exige conferência antes de uma nova tentativa manual. SMTP não oferece garantia
de entrega exatamente uma vez.

As preferências ficam em `daily_report_enabled` e `daily_report_time` na tabela
`users`; a tabela `daily_report_deliveries` registra a entrega por usuário e
data, o que impede duplicidade após reinício.

---

# Parte 3 — Atualizar o Portal

O portal no ar é a **versão compilada**. Alterar o código e reiniciar mantém a
versão antiga.

Use **`Supply Vision.bat` → Atualizar sistema** (`scripts/atualizar-servidor.ps1`).
Ele faz backup do banco, recebe a versão nova, reinstala dependências, compila,
testa e religa a operação. Se algo falhar, volta ao código anterior e, se a
versão nova já tiver rodado sobre o banco, restaura o backup feito antes da
atualização. Veja [docs/OPERAR.md](../docs/OPERAR.md) e
[docs/SOCORRO.md](../docs/SOCORRO.md).

Nunca instale pacotes com o portal em execução.

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
| `components/reports.tsx` | Operações manuais, acompanhamento e arquivos |
| `lib/navegacao.ts` | Grupos e nomes dos perfis |
| `scripts/processar-relatorios.mjs` | Fila local e ponte autenticada para downloads |
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
inatividade (as atualizações automáticas da tela, marcadas com o cabeçalho
`x-portal-poll: 1`, validam a sessão mas não contam como atividade). Limitação progressiva de tentativas de login, perfis `viewer`,
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

## Backup e recuperação

A rotina de backup (cópia local e na rede, histórico de 7 dias, comprovante por
e-mail) e a restauração pela central estão em
[`docs/OPERAR.md`](../docs/OPERAR.md#backup), que é a única fonte desse
assunto; este arquivo não repete o procedimento para os dois não divergirem.

O botão de exportação da interface gera dados de negócio em JSON, sem senhas
nem sessões, e **não substitui** o backup SQLite.

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

O banco existente é preservado. As tabelas de De/Para de itens, modelos e
unidades são criadas vazias quando ausentes; localidade não tem De/Para. Não é
preciso substituir o arquivo SQLite nem preencher correspondências
antecipadamente.

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


### Consulta e importação

Os filtros de busca reúnem seleção múltipla e digitação em um único campo. A importação mantém um acordo de destino por arquivo e aceita no máximo **1.000 linhas incluindo o cabeçalho** e **2 MB**, tanto na conferência quanto na publicação.

As observações do acordo (e das condições) aparecem no detalhe somente para os perfis Suprimentos e Administrador; o perfil Consulta não as recebe nem pela API. A aba **Histórico** permite exportar todos os registros que correspondem aos filtros em uma planilha `.xlsx`, disponível somente para administradores. A aba **E-mails**, também administrativa, pagina as notificações e permite filtrar por destinatário, situação, tipo, texto e período.

Fornecedores são paginados em grupos de 25. Quando a tabela ultrapassa a largura da tela, a barra superior e Shift + rolagem permitem navegar horizontalmente em qualquer altura da lista. Dados de situação, correspondências de unidades e observações legadas continuam preservados, mesmo quando seus controles deixam de ser exibidos.

### Prazo dos corpos HTTP

O portal limita a leitura a 60 segundos e drena corpos excedidos por até cinco
segundos ou 16 MB adicionais. Corpos normais excedidos continuam recebendo 413;
um fluxo que não termina recebe 408 ou tem a conexão fechada pelo proxy local.
No Wrangler local, liberar o leitor e a reserva não garante o fechamento
imediato do socket enquanto o cliente mantém o corpo aberto. O prazo da
conexão depende do runtime ou do proxy de implantação; não há um novo proxy
HTTP incorporado nesta correção.
A reserva de importação é liberada em qualquer caso e sua posse é renovada e
conferida depois da leitura, antes de preparar e antes de publicar dados.
