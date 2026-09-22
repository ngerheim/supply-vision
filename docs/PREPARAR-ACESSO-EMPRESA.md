# Preparação do acesso de consulta

## Atualização sem migração

Este pacote altera código, mensagens e testes. Não cria tabelas, colunas ou
índices, não substitui o SQLite e não modifica os cadastros de produção.
As operações normais de login continuam registrando sessões e auditoria.
Após integrar os commits na main, atualizar pelo Supply Vision.bat no servidor.

O carregamento de consulta omite métricas administrativas, cadastro de unidades
e marcas e dados cadastrais de fornecedores que essas telas não usam. O detalhe
omite observações internas e responsável. Os preços, CNPJs dos acordos e dados
comerciais já visíveis continuam disponíveis.

O detalhe carrega condições em lotes de 500, com total e botão para carregar
mais. O filtro textual é aplicado às condições já carregadas. Uma mudança de
versão ou total durante a navegação reinicia a lista para evitar misturar versões.

O perfil Consulta permanece restrito a Buscar e Acordos. A validação de acesso
é feita no servidor, inclusive quando alguém chama os endereços diretamente.
Cada navegador tem sessão própria; sair de um não encerra os demais. A troca
de senha invalida sessões anteriores e desativar a conta bloqueia seu acesso.

## Homologação antes da divulgação

Ensaio curto no notebook de desenvolvimento em 21/09/2026, com nove sessões
e um acordo sintético de 10 mil condições em 10 mil localidades:

| Requisições simultâneas | Mediana | Percentil 95 | Máximo |
|---|---|---|---|
| 10 | 0,89 s | 1,50 s | 1,51 s |
| 25 | 1,87 s | 4,10 s | 4,93 s |
| 50 | 3,63 s | 9,89 s | 12,17 s |
| 100 | 7,80 s | 30,58 s | 34,25 s |

O cliente HTTP do ensaio espera até 180 segundos. O navegador tem limite de
30 segundos para leitura: portanto, sucesso HTTP do ensaio não equivale a
sucesso da experiência no patamar de 100. Os números incluem carregamento
inicial, pesquisa e detalhe e não representam 100 usuários reais. A quantidade
de localidades da fixture também é maior que a da base inicial da operação.

- Executar `npm run build` e `npm run test:imports` em cópia isolada, em uma
  janela apropriada do notebook-servidor. O ensaio cria seu próprio banco e
  serviço em loopback. Nunca apontar uma ferramenta de carga para produção.
- Conferir os resultados de consulta concorrente em `portal/work/`, especialmente
  o percentil 95, erros, CPU, memória e impacto nos demais serviços da máquina.
- Complementar com uso prolongado e consultas durante backup/importação em
  ambiente isolado. O ensaio curto não cobre disponibilidade por várias horas.
- Conferir o acesso Consulta em navegadores reais e realizar piloto com um
  grupo pequeno antes de distribuir a credencial para toda a empresa.
- Definir com os responsáveis o pico esperado, tempo de resposta aceitável e
  tempo máximo de indisponibilidade. Não há capacidade certificada de usuários.

## Infraestrutura do servidor

- Endereço interno estável e HTTPS, com certificado aceito pelos computadores.
- Proxy confiável que normalize os cabeçalhos de origem; restringir acesso
  direto à porta da aplicação antes de ativar TRUSTED_PROXY.
- Calibrar controle de tráfego considerando usuários atrás do mesmo endereço.
  A fila de login é local ao processo e não substitui proteção no proxy.
- Verificar reinício, suspensão, atualizações do sistema, rede e espaço livre.
- Acompanhar disponibilidade, latência, erros e último backup válido.

## Próximas decisões separadas deste pacote

- Confirmar com os responsáveis quais dados comerciais a empresa pode receber.
- Paginação da lista geral de acordos e filtro de detalhes diretamente no servidor.
- Limites por rota e cache de catálogos, guiados pelas medições de capacidade.
- Revogação administrativa explícita de sessões sem trocar a senha.
- Recuperação resistente a interrupções e política de retenção de backups.
  A retenção atual sem histórico foi uma decisão operacional documentada.
- Correções de localidades, endereço de fornecedores e papel do catálogo de marcas.
- Otimizações com novos índices somente em uma etapa que autorize migração.

Não divulgar a conta corporativa supondo que a aprovação do ensaio de importação
comprove capacidade de atendimento. Os resultados do teste devem orientar o piloto.
