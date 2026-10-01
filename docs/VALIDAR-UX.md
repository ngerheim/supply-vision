# Validação da UX do portal

O portal usa menu superior com Buscar, Chamados, Acordos e Importações em destaque. As demais áreas ficam em **Mais**, respeitando o perfil da conta. A referência de uso é 1366 × 768; a suíte também verifica a largura de 390 pixels.

As listas principais oferecem 25, 50 ou 100 registros por página. Buscar, Chamados, Acordos, condições, histórico de importações e notificações consultam páginas no servidor. Os filtros e a ordenação são aplicados antes do recorte. Cadastros e contas filtram/ordenam a lista completa antes da paginação no navegador. Os seletores de acordo incluem registros antigos, sem o antigo corte de 500.

## Executar os testes

Dentro de `portal/`, com as dependências instaladas:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:ux
npm run test:imports
```

`test:ux` abre uma instância compilada em uma porta local livre e cria seu próprio banco. O script não aceita endereço ou banco externos. No Windows, usa o Edge instalado; em Linux, instale o Chromium do Playwright com `npx playwright install --with-deps chromium`. É possível escolher outro navegador com `PLAYWRIGHT_CHANNEL`.

As evidências ficam em `portal/work/ux-*`: resultado em JSON, log do servidor e captura da interface. Em falhas, há uma captura para diagnóstico. Os testes exercitam filtros múltiplos, mais de mil condições, registros antigos, edição de flags numéricas, rollback quando a auditoria falha, preservação de referências antigas, clique duplo, recuperação de leitura, publicação com falha de recarga e retorno aos filtros/página do acordo.

O CI executa essa suíte depois da compilação, além dos testes de código, auditoria de dependências e instalação nova.

## Atualizar no notebook-servidor

Depois de integrar o PR na `main`, reserve uma janela de manutenção. No notebook-servidor, abra **Supply Vision.bat → Atualizar sistema**. O procedimento já existente faz backup, valida o estado do Git, atualiza dependências quando necessário, compila e testa. Consulte [OPERAR.md](OPERAR.md) para as condições e o comportamento de retorno em caso de falha.

Depois da atualização, confira com uma conta de consulta e uma conta de comprador: pesquisa por vários itens, paginação, abertura/retorno de acordo e consulta de chamados. Valide a publicação de uma planilha aprovada pelo responsável pelos dados. O envio real de e-mail, a atualização do Qlik e a visualização do relatório Power BI dependem das configurações e credenciais do notebook-servidor; os testes isolados não confirmam essas integrações reais.

Não há alteração de esquema neste PR. Os dados privados e o banco de produção não são usados pela suíte de UX.
