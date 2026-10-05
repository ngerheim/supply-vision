# Avaliação da análise do Claude — 05/10/2026

A análise foi conferida contra a main em `1528d76`. As correções abaixo atendem falhas reproduzidas e preservam os fluxos existentes.

## Alterações adotadas

- SMTP dos alertas e do monitor de saúde: STARTTLS com `ssl.create_default_context()`, verificando certificado e nome do servidor antes do login. Testes simulam aceitação e rejeição; nenhum e-mail real é enviado.
- Datas de compras: interpretação explícita de ISO e dia/mês/ano, inclusive colunas mistas e datas nativas do Excel. A regra é compartilhada com o tratamento da vigência.
- Situação dos acordos: lista, detalhe e exportação usam a mesma expressão SQL. “Vigente” inclui acordos a vencer; filtros específicos para “A vencer” e “Agendado” continuam disponíveis.
- Cadastro manual de preços: combinações existentes retornam 409 em vez de sobrescrever o preço. Um lote que contém duplicidade é recusado inteiro; inserção e auditoria ocorrem no mesmo batch.
- Exclusão de condição: histórico registra todos os campos anteriores, inclusive preço e referências, no mesmo batch da exclusão.
- Chamados: edição exige `expectedRevision` válida e atual. Responsável já atribuído pode permanecer no chamado após ser desativado, permitindo concluir o atendimento; novas atribuições a pessoas inativas continuam recusadas.
- Usuários: hash da nova senha é calculado antes da escrita; cadastro, credenciais e encerramento das sessões mudam atomicamente, respeitando a proteção do último administrador.
- Auditoria: pesquisa literal com `instr(lower(...),lower(?))`, preservando a busca sem distinção de caixa ASCII e evitando padrões LIKE longos no D1. `%`, `_` e barra não funcionam como curingas. Exportações acima de 10.000 registros retornam 400 com orientação para filtrar, antes de carregar as linhas; não há truncamento silencioso.
- Testes HTTP existentes atualizados para enviar a revisão do chamado, como a interface já faz.

## Sugestões que exigem outro escopo

- Não adicionar LIMIT 500 à lista de acordos. A implementação entrega a lista completa e a tela filtra/pagina localmente; um corte esconderia registros. Removidos comentário obsoleto e aviso impossível. O teste HTTP cobre mais de 500 acordos e chamados.
- Não redesenhar versões para tornar toda edição manual imutável nesta correção. A exclusão passa a preservar o estado anterior na auditoria; as versões seguem o contrato atual.
- Não dividir toda a rota, substituir a distribuição de SheetJS nem portar as travas Python para Linux neste PR. São alterações estruturais que precisam de escopo e validação próprios; o ambiente operacional atual é Windows.
- Na exclusão de cadastro, a consulta prévia melhora a mensagem ao usuário; as chaves estrangeiras seguem como proteção final contra referências concorrentes. Nenhuma garantia foi atribuída apenas à consulta prévia.

## Compatibilidade e validação

Clientes externos que editam chamados devem obter a revisão no detalhe e enviá-la como `expectedRevision`. Cadastro repetido de preço agora exige usar a edição da condição existente. Certificados SMTP inválidos ou sem cadeia confiável deixam de ser aceitos.

A validação inclui testes unitários do portal e dos alertas, testes HTTP em banco descartável, cenários de importação, verificação de tipos, lint e build. SMTP é simulado; não houve envio real, acesso ao Qlik de produção, alteração do banco operacional nem implantação.

Referência para o contexto TLS: [documentação oficial do Python](https://docs.python.org/3/library/ssl.html#ssl.create_default_context).
