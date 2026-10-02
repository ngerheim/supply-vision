# Preparar a hospedagem completa do portal em Cloudflare Workers + D1

## Objetivo e situacao atual

O objetivo da futura migracao e executar o portal completo fora do
notebook-servidor: entrar com usuario e senha, criar e editar acordos,
gerenciar fornecedores e chamados, importar planilhas e salvar alteracoes
em um banco persistente. A proposta nao e uma pagina apenas de visualizacao.

A hospedagem proposta e na Cloudflare: Workers executa a interface e as APIs;
D1 persiste os dados. O GitHub armazena o codigo e executa as verificacoes e
a preparacao do pacote. **Nao existe adaptacao nem publicacao para GitHub Pages
neste repositorio.**

**A operacao atual continua local, via LAN.** A estrutura remota e opcional e
preparatoria; ela ainda nao entrega um portal hospedado ou pronto para producao.
Enquanto as etapas de homologacao e migracao abaixo nao forem concluidas, o
notebook-servidor continua responsavel pelo portal, banco, e-mails e Alertas.

## O que esta etapa entrega

O GitHub guarda o codigo, revisa as mudancas e prepara o pacote do portal.
O workflow **Preparar hospedagem (sem publicar)** e manual: testa, compila
e executa `wrangler deploy --dry-run`. Ele nao publica, nao cria recursos,
nao conecta ao banco remoto e nao precisa de credenciais Cloudflare.

O notebook de desenvolvimento serve para alterar e testar codigo com dados
ficticios. O notebook-servidor continua atendendo a empresa e guardando os
dados reais em `privado/`. Nenhuma rotina desta etapa atualiza esse servidor.

## Papel do GitHub e limite do GitHub Pages

[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
serve arquivos estaticos. Este portal precisa executar as rotas `/api`,
autenticar usuarios, gravar sessoes e consultar o binding `DB` do D1.
Publicar somente a interface deixaria login e operacoes sem funcionar.

A estrutura proposta aproveita o runtime que o projeto ja usa:
**GitHub Actions prepara o codigo; Cloudflare Workers executa o portal;
D1 guarda o banco remoto.** E uma preparacao para homologacao, nao uma
migracao de producao. Referencia:
[Workers com GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## Configuracoes separadas

Sem `SUPPLY_VISION_TARGET`, o build preserva exatamente `site-creator-d1`
e `00000000-0000-4000-8000-000000000000`, usados pelo banco local existente.
Nunca altere esses identificadores para tentar apontar o servidor local a nuvem.

Para preparar homologacao, a configuracao exige:

| Variavel | Valor |
|---|---|
| `SUPPLY_VISION_TARGET` | `cloudflare-staging` |
| `CLOUDFLARE_D1_DATABASE_ID` | UUID de um D1 separado, exclusivo de homologacao |

O nome do Worker e `supply-vision-portal-staging`. Os enderecos `workers.dev`
e URLs de preview ficam desativados. A configuracao nao incorpora senhas ou
tokens no pacote. A validacao verifica o formato do UUID; a pessoa responsavel
deve conferir que ele pertence a homologacao, pois nao consultamos a conta.

## Como preparar depois do merge

1. Quando for iniciar a homologacao, criar um D1 vazio exclusivo para ela.
   Nesta etapa nao criamos conta, banco, dominio ou recursos cobrados.
2. Em **Actions → Preparar hospedagem (sem publicar) → Run workflow**, escolher
   `main` e informar o UUID dessa base. O workflow precisa estar em `main`
   para aparecer na lista de execucao manual.
3. Conferir os testes e o resultado do empacotamento. O artefato gerado guarda
   `dist/client` e `dist/server`, com retencao de sete dias. Nao inclui
   `privado/`, banco real ou credenciais. O pacote nao confirma que a base
   existe, nem que o portal funciona remotamente: isso exige homologacao real.

## O que falta antes de publicar

- Configurar conta, dominio/rota HTTPS e controle de acesso corporativo para
  homologacao. Manter `workers_dev: false` e `preview_urls: false`; a rota
  devera ser adicionada explicitamente ao configurar o dominio.
- Definir os segredos do Worker fora do Git: `INITIAL_ADMIN_PASSWORD` para
  inicializar uma base vazia e `PORTAL_API_TOKEN` para a integracao interna.
  Configurar `TRUSTED_PROXY` somente com os cabecalhos de origem validados.
- Criar um workflow de publicacao separado, com ambiente protegido no GitHub,
  branch `main`, aprovacao e token Cloudflare de escopo minimo. O workflow
  atual nao tem comando de publicacao real nem recebe esse token.
- Homologar login, sessoes, perfis, importacoes, concorrencia entre instancias,
  limites de memoria/CPU do Worker e migracoes simultaneas do schema. A
  criptografia e importacoes atuais precisam ser medidas no runtime remoto.
- Adaptar `portal/scripts/processar-emails.mjs`: ele usa `node:sqlite` no
  arquivo Miniflare local. Nao consumira automaticamente um D1 remoto.
  Definir um consumidor remoto de fila e agendamento para os relatorios antes
  de desligar o consumidor local; nao operar dois consumidores no mesmo fluxo.
- Adaptar backups/restauracao: `backup.mjs` usa `VACUUM INTO` no arquivo local.
  Definir backup remoto, retencao e testar restauracao antes da migracao.
- Manter o motor Python de Alertas e a extracao do Qlik em uma maquina com
  acesso corporativo. Workers nao executa esses scripts Python ou PowerShell.
  Depois da homologacao, ajustar o `PORTAL_URL` e o token da integracao no
  servidor responsavel pelos Alertas, conferindo acesso pela rede corporativa.
- Planejar migracao integral do banco (a exportacao funcional da API omite
  credenciais e nao substitui uma migracao), reconciliar contagens e acordos,
  definir janela sem escritas e validar rollback. Preservar uma copia integra
  do banco local. Nenhum dado real deve ir para artefatos publicos do GitHub.

O servidor atual so deve ser desativado depois de homologar portal, e-mails,
Alertas e restauracao. Esta estrutura nao depende de deixar o notebook de
desenvolvimento ligado.

## Criterio para concluir a migracao

A migracao so estara concluida quando um usuario autorizado conseguir acessar
o endereco remoto, criar um acordo, editar suas condicoes e consultar os dados
salvos depois de sair e entrar novamente. Perfis de acesso, importacoes,
chamados, integracao dos Alertas, envio de e-mails e restauracao de backup
tambem precisam ser aprovados. Uma interface que apenas abre no navegador ou
um pacote compilado com sucesso nao atendem a esse criterio.
