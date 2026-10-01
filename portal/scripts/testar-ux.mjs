// Sempre cria uma instância local e descartável. Não aceita endereço de produção.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { chromium, request as playwrightRequest } from 'playwright';
import * as XLSX from 'xlsx';

const portal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(portal, 'work'), { recursive: true });
const output = fs.mkdtempSync(path.join(portal, 'work', 'ux-'));
const runtime = path.join(output, 'runtime'),
  state = path.join(output, 'state');
fs.cpSync(path.join(portal, 'dist'), runtime, { recursive: true });
const log = fs.openSync(path.join(output, 'servidor.log'), 'a');
const socket = createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`,
  password = 'Teste-UX-isolado-2026';
const checks = [],
  pageErrors = [];
let child,
  browser,
  db,
  context,
  completed = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log('OK ' + name);
}
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}
try {
  child = spawn(
    process.execPath,
    [
      path.join(portal, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--local',
      '--config',
      path.join(runtime, 'server/wrangler.json'),
      '--persist-to',
      state,
      '--var',
      `INITIAL_ADMIN_PASSWORD:${password}`,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      '0',
    ],
    {
      cwd: output,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG_PATH: path.join(output, 'wrangler.log'),
        MINIFLARE_REGISTRY_PATH: path.join(output, 'registry'),
      },
    },
  );
  let ready = false;
  const probe = await playwrightRequest.newContext({ baseURL: base });
  try {
    for (let i = 0; i < 90; i++) {
      if (child.exitCode !== null) throw Error('Servidor encerrou');
      try {
        if ((await probe.get('/api/health', { timeout: 2000 })).ok()) {
          ready = true;
          break;
        }
      } catch (error) {
        if (i === 5) console.log('Aguardando servidor: ' + error.message);
      }
      await pause(500);
    }
  } finally {
    await probe.dispose();
  }
  assert(ready, 'servidor local inicializou');
  const channel =
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({
    headless: true,
    ...(channel ? { channel } : {}),
  });
  context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1366, height: 768 },
  });
  const request = context.request;
  assert.equal(
    (
      await request.post('/api/login', {
        data: { email: 'admin@portal.local', password },
      })
    ).status(),
    200,
  );
  const api = async (method, url, data) => {
    const response = await request[method]('/api/' + url, { data });
    assert(response.ok(), url + ': ' + (await response.text()));
    return response.json();
  };
  const supplier = await api('post', 'catalogs/suppliers', {
    tradeName: 'FORNECEDOR UX',
    cnpj: '11222333000181',
  });
  const location = await api('post', 'catalogs/locations', {
    city: 'GOIANIA',
    state: 'GO',
  });
  const item = await api('post', 'catalogs/items', { name: 'ITEM UX' }),
    model = await api('post', 'catalogs/models', { name: 'MODELO UX' });
  const bootstrap = await api('get', 'bootstrap'),
    unit = bootstrap.catalogs.units[0];
  const agreement = await api('post', 'agreements', {
    number: 'ACORDO UX',
    supplierId: supplier.id,
    status: 'active',
    startDate: '2020-01-01',
    locationIds: [location.id],
  });
  const endDate = new Date(Date.now() + 10 * 86400000)
    .toISOString()
    .slice(0, 10);
  const expiring = await api('post', 'agreements', {
    number: 'ACORDO A VENCER',
    supplierId: supplier.id,
    status: 'active',
    startDate: '2020-01-01',
    endDate,
    locationIds: [location.id],
  });
  await api('post', `agreements/${agreement.id}/items`, {
    catalogItemId: item.id,
    locationId: location.id,
    unitId: unit.id,
    modelIds: [model.id],
    price: 120,
  });
  await api('post', 'mappings/items', {
    source: 'ITEM UX',
    targetId: item.id,
    active: true,
  });
  await api('post', 'mappings/models', {
    source: 'MODELO UX',
    targetId: model.id,
    active: true,
  });
  await api('post', 'tickets', { supplierName: 'CHAMADO ANTIGO ATIVO' });
  db = new DatabaseSync(
    files(state).find(
      (filename) =>
        filename.endsWith('.sqlite') && !filename.endsWith('metadata.sqlite'),
    ),
  );
  db.exec('PRAGMA busy_timeout=5000');
  const current = db
    .prepare('SELECT current_version_id v FROM agreements WHERE id=?')
    .get(agreement.id).v;
  db.exec('BEGIN IMMEDIATE');
  const insertA = db.prepare(
    'INSERT INTO agreements(id,number,supplier_id,status,start_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
  );
  const insertT = db.prepare(
    'INSERT INTO tickets(id,code,supplier_name,priority,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
  );
  const insertI = db.prepare(
    'INSERT INTO catalog_items(id,name,active) VALUES(?,?,1)',
  );
  const insertC = db.prepare(
    'INSERT INTO agreement_items(id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,courtesy,created_at,updated_at) VALUES(?,?,?,?,?,?,1,0,?,?)',
  );
  for (let i = 0; i < 501; i++) {
    insertA.run(
      'ux-a-' + i,
      'PAGINA ' + i,
      supplier.id,
      'suspended',
      '2020-01-01',
      '2020-01-01',
      '2030-01-01',
    );
    insertT.run(
      'ux-t-' + i,
      'SUP-UX-' + i,
      'FECHADO ' + i,
      'media',
      'fechado',
      '2020-01-01',
      '2030-01-01',
    );
  }
  for (let i = 0; i < 1001; i++) {
    insertI.run('ux-i-' + i, 'CONDICAO ' + String(i).padStart(4, '0'));
    insertC.run(
      'ux-c-' + i,
      current,
      location.id,
      'ux-i-' + i,
      model.id,
      unit.id,
      '2020-01-01',
      '2020-01-01',
    );
  }
  db.exec('COMMIT');
  await check('Acordos: filtro Vigente inclui A vencer', async () => {
    const result = await api('get', 'agreements?status=active');
    assert(result.rows.some((row) => row.id === expiring.id));
    assert.equal(result.total, 2);
  });
  await check('Acordos: seletor encontra registros além de 500', async () => {
    const result = await api('get', 'bootstrap');
    assert.equal(result.agreements.length, 503);
    assert(result.agreements.some((row) => row.id === agreement.id));
  });
  await check(
    'Chamados: filtra antes do limite e encontra ativo antigo',
    async () => {
      const result = await api('get', 'tickets?group=ativos');
      assert.equal(result.total, 1);
      assert.equal(result.tickets[0].supplierName, 'CHAMADO ANTIGO ATIVO');
    },
  );
  await check(
    'Busca: todas as páginas alcançam mais de 1000 condições sem duplicar',
    async () => {
      let count = 0;
      const ids = new Set();
      for (let page = 1; page <= 11; page++) {
        const result = await api('get', `search?page=${page}&pageSize=100`);
        for (const row of result.rows) {
          assert(!ids.has(row.id));
          ids.add(row.id);
          count++;
        }
      }
      assert.equal(count, 1002);
    },
  );
  await check(
    'Condições: pesquisa encontra registro fora da primeira página',
    async () => {
      const result = await api(
        'get',
        `agreements/${agreement.id}?page=1&q=1000`,
      );
      assert.equal(result.total, 1);
      assert.equal(result.items[0].item, 'CONDICAO 1000');
    },
  );
  await check('GET: filtro e paginação inválidos retornam 400', async () => {
    const query = new URLSearchParams();
    for (let i = 0; i < 81; i++) query.append('item', String(i));
    assert.equal((await request.get('/api/search?' + query)).status(), 400);
    assert.equal((await request.get('/api/agreements?page=0')).status(), 400);
  });
  await check(
    'Filtros SQL: percentagem e sublinhado são literais',
    async () => {
      assert.equal((await api('get', 'agreements?q=%25')).total, 0);
      assert.equal((await api('get', 'tickets?q=_')).total, 0);
    },
  );
  await check(
    'Cadastro: renomear mantém inativo e omitir flag preserva estado',
    async () => {
      await api('put', 'catalogs/items/' + item.id, {
        name: 'ITEM UX',
        active: false,
      });
      await api('put', 'catalogs/items/' + item.id, {
        name: 'ITEM UX RENOMEADO',
        active: 0,
      });
      await api('put', 'catalogs/items/' + item.id, { name: 'ITEM UX FINAL' });
      assert.equal(
        db.prepare('SELECT active FROM catalog_items WHERE id=?').get(item.id)
          .active,
        0,
      );
      await api('put', 'catalogs/items/' + item.id, {
        name: 'ITEM UX',
        active: true,
      });
    },
  );
  await check(
    'Usuários: editar nome preserva conta inativa e relatório ativado',
    async () => {
      const user = await api('post', 'users', {
        name: 'CONTA UX',
        email: 'ux@teste.local',
        password: 'Senha-teste-UX-2026',
        role: 'viewer',
      });
      await api('put', 'users/' + user.id, {
        active: false,
        dailyReportEnabled: true,
      });
      const snapshot = (await api('get', 'users')).users.find(
        (row) => row.id === user.id,
      );
      await api('put', 'users/' + user.id, {
        ...snapshot,
        name: 'CONTA RENOMEADA',
      });
      const saved = db
        .prepare(
          'SELECT active,daily_report_enabled enabled FROM users WHERE id=?',
        )
        .get(user.id);
      assert.equal(saved.active, 0);
      assert.equal(saved.enabled, 1);
    },
  );
  await check('Condição existente conserva referências inativas sem permitir novos vínculos',async()=>{
    const condition=db.prepare('SELECT id FROM agreement_items WHERE catalog_item_id=?').get(item.id);
    await api('put','catalogs/items/'+item.id,{name:'ITEM UX',active:false});
    try{await api('put','items/'+condition.id,{catalogItemId:item.id,locationId:location.id,unitId:unit.id,modelId:model.id,price:120,notes:'REFERENCIA PRESERVADA'});assert.equal(db.prepare('SELECT active FROM catalog_items WHERE id=?').get(item.id).active,0);assert.equal((await request.post(`/api/agreements/${agreement.id}/items`,{data:{catalogItemId:item.id,locationId:location.id,unitId:unit.id,modelIds:[model.id],price:120}})).status(),400)}finally{await api('put','catalogs/items/'+item.id,{name:'ITEM UX',active:true})}
  });
  await check('Falha na auditoria desfaz a edição do cadastro', async () => {
    db.exec(
      "CREATE TRIGGER ux_fail BEFORE INSERT ON audit_logs WHEN NEW.entity='items' AND NEW.action='UPDATE' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END",
    );
    try {
      assert.equal(
        (
          await request.put('/api/catalogs/items/' + item.id, {
            data: { name: 'NAO DEVE SALVAR' },
          })
        ).status(),
        400,
      );
      assert.equal(
        db.prepare('SELECT name FROM catalog_items WHERE id=?').get(item.id)
          .name,
        'ITEM UX',
      );
    } finally {
      db.exec('DROP TRIGGER ux_fail');
    }
  });
  await check(
    'Falha na auditoria desfaz edição de acordo, condição e usuário',
    async () => {
      const account = await api('post', 'users', {
        name: 'ATOMICIDADE UX',
        email: 'atomicidade@teste.local',
        password: 'Senha-teste-UX-2026',
        role: 'viewer',
      });
      const condition = db
        .prepare('SELECT id FROM agreement_items WHERE catalog_item_id=?')
        .get(item.id);
      const cases = [
        {
          entity: 'agreement',
          url: 'agreements/' + agreement.id,
          body: {
            number: 'NAO SALVAR',
            supplierId: supplier.id,
            status: 'active',
            startDate: '2020-01-01',
            locationIds: [location.id],
          },
          sql: 'SELECT number v FROM agreements WHERE id=?',
          id: agreement.id,
          expected: 'ACORDO UX',
        },
        {
          entity: 'agreement_item',
          url: 'items/' + condition.id,
          body: {
            catalogItemId: item.id,
            locationId: location.id,
            unitId: unit.id,
            modelId: model.id,
            price: 999,
          },
          sql: 'SELECT price v FROM agreement_items WHERE id=?',
          id: condition.id,
          expected: 120,
        },
        {
          entity: 'user',
          url: 'users/' + account.id,
          body: { name: 'NAO SALVAR', password: 'Nova-senha-UX-2026' },
          sql: 'SELECT name v FROM users WHERE id=?',
          id: account.id,
          expected: 'ATOMICIDADE UX',
        },
      ];
      for (const scenario of cases) {
        db.exec(
          `CREATE TRIGGER ux_fail BEFORE INSERT ON audit_logs WHEN NEW.entity='${scenario.entity}' AND NEW.action='UPDATE' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END`,
        );
        try {
          const response = await request.put('/api/' + scenario.url, {
            data: scenario.body,
          });
          assert(!response.ok());
          assert.equal(
            db.prepare(scenario.sql).get(scenario.id).v,
            scenario.expected,
          );
        } finally {
          db.exec('DROP TRIGGER ux_fail');
        }
      }
    },
  );
  await check(
    'Chamados: todas as opções de ordenação consultam o servidor',
    async () => {
      for (const sort of [
        'updatedAt',
        'code',
        'supplierName',
        'city',
        'priority',
        'status',
        'requestedBy',
        'openTime',
      ]) {
        const result = await api(
          'get',
          'tickets?group=fechados&sort=' + sort + '&pageSize=25',
        );
        assert.equal(result.tickets.length, 25);
        assert.equal(result.total, 501);
      }
      const unassigned = await api(
        'get',
        'tickets?group=ativos&owner=unassigned',
      );
      assert.equal(unassigned.total, 1);
    },
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const navigate = async (name) => {
    if (!['Buscar', 'Chamados', 'Acordos', 'Importações'].includes(name))
      await page.getByRole('button', { name: 'Mais', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).waitFor();
  await check(
    '1366×768: filtros recolhidos deixam a pesquisa acessível',
    async () => {
      const box = await page
        .getByRole('button', { name: 'Pesquisar', exact: true })
        .boundingBox();
      assert(box.y + box.height < 768);
      assert.equal(
        await page.getByRole('textbox', { name: 'Buscar Modelo' }).count(),
        0,
      );
    },
  );
  await check(
    'Busca: múltiplas seleções continuam marcadas ao reabrir',
    async () => {
      const trigger = page
        .locator('fieldset')
        .filter({ has: page.getByText('Peça ou serviço', { exact: true }) })
        .getByRole('button')
        .first();
      await trigger.click();
      const popup = page.getByRole('dialog');
      await popup.getByRole('textbox').fill('CONDICAO 000');
      await popup.getByRole('checkbox').nth(0).check();
      await popup.getByRole('checkbox').nth(1).check();
      await popup.getByRole('button', { name: 'Concluir' }).click();
      await trigger.click();
      assert.equal(
        await popup.getByRole('checkbox').filter({ visible: true }).count(),
        10,
      );
      assert(await popup.getByRole('checkbox').nth(0).isChecked());
      assert(await popup.getByRole('checkbox').nth(1).isChecked());
      await popup.getByRole('button', { name: 'Concluir' }).click();
      await page
        .getByRole('button', { name: 'Pesquisar', exact: true })
        .click();
      await page.getByText('2 condições encontradas').waitFor();
    },
  );
  await check('Chamados: duplo clique envia uma única criação', async () => {
    await navigate('Chamados');
    await page.getByRole('button', { name: 'Novo chamado' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Fornecedor *')
      .fill('DUPLO CLIQUE UX');
    let writes = 0;
    await page.route('**/api/tickets', async (route) => {
      if (route.request().method() === 'POST') {
        writes++;
        await pause(600);
      }
      await route.continue();
    });
    await page
      .getByRole('button', { name: 'Abrir chamado', exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(writes, 1);
    const saved = await api('get', 'tickets?group=ativos&q=DUPLO');
    assert.equal(saved.total, 1);
    await page.unroute('**/api/tickets');
  });
  await check('Chamados: erro de leitura oferece nova tentativa', async () => {
    await navigate('Buscar');
    await page.route('**/api/tickets?**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"indisponível"}',
      }),
    );
    await navigate('Chamados');
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .waitFor();
    await page.unroute('**/api/tickets?**');
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .click();
    await page.getByRole('button', { name: 'Novo chamado' }).waitFor();
  });
  await check('De/Para: erro de leitura oferece nova tentativa', async () => {
    await page.route('**/api/mappings', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"indisponível"}',
      }),
    );
    await navigate('De/Para');
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .waitFor();
    await page.unroute('**/api/mappings');
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Nova correspondência', exact: true })
      .waitFor();
  });
  await check(
    'Todas as áreas cabem na largura de 1366 e 390 pixels',
    async () => {
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 768 });
        for (const name of [
          'Buscar',
          'Chamados',
          'Acordos',
          'Importações',
          'Manutenção',
          'Fornecedores',
          'Cadastros',
          'De/Para',
          'Histórico',
          'Usuários e envios',
        ]) {
          await navigate(name);
          await pause(200);
          const metrics = await page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
          }));
          assert(
            metrics.scroll <= metrics.width,
            `${name}: ${JSON.stringify(metrics)}`,
          );
        }
      }
      await page.setViewportSize({ width: 1366, height: 768 });
    },
  );
  await check(
    'Importações: publicação confirmada sobrevive à falha de recarga',
    async () => {
      await navigate('Importações');
      await page
        .getByLabel('Acordo de destino', { exact: true })
        .selectOption(agreement.id);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet([
          {
            CIDADE: 'GOIANIA',
            UF: 'GO',
            MODELO: 'MODELO UX',
            PECA_SERVICO: 'ITEM UX',
            PRECO: 42,
            MEDIDA: unit.code,
          },
        ]),
        'Dados',
      );
      await page
        .locator('input[type=file]')
        .setInputFiles({
          name: 'ux.xlsx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
        });
      await page.getByRole('button', { name: 'Conferir arquivo' }).click();
      await page.getByRole('button', { name: /Publicar/ }).waitFor();
      await page.route('**/api/bootstrap', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"indisponível"}',
        }),
      );
      await page.getByRole('button', { name: /Publicar/ }).click();
      await page.getByText('Publicação confirmada', { exact: true }).waitFor();
      await page.unroute('**/api/bootstrap');
      await page.getByRole('button', { name: 'Atualizar histórico' }).click();
      assert.equal(
        db
          .prepare(
            'SELECT COUNT(*) n FROM agreement_items WHERE version_id=(SELECT current_version_id FROM agreements WHERE id=?)',
          )
          .get(agreement.id).n,
        1,
      );
    },
  );
  await check('Navegação: recarregar preserva a aba', async () => {
    await navigate('Acordos');
    await page.reload();
    await page.getByRole('button', { name: 'Acordos', exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Acordos', exact: true })
        .getAttribute('aria-current'),
      'page',
    );
  });
  await check('Acordos: abrir e voltar preserva filtros e página', async () => {
    const filter = page.getByPlaceholder('Número, fornecedor, CNPJ ou cidade');
    await filter.fill('PAGINA');
    await page.getByText('501 acordos', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Próxima', exact: true }).click();
    await page.getByText('Página 2 de 21', { exact: true }).waitFor();
    const first = page.locator('tbody button').first();
    const number = await first.innerText();
    await first.click();
    await page.getByRole('button', { name: /Voltar/ }).waitFor();
    await page.getByRole('button', { name: /Voltar/ }).click();
    assert.equal(await filter.inputValue(), 'PAGINA');
    await page.getByText('Página 2 de 21', { exact: true }).waitFor();
    assert.equal(
      await page.locator('tbody button').first().innerText(),
      number,
    );
  });
  await page.screenshot({
    path: path.join(output, 'portal-1366.png'),
    fullPage: true,
  });
  assert.deepEqual(pageErrors, [], 'nenhuma exceção no navegador');
  completed = true;
  console.log(`${checks.length} verificações passaram. Evidências: ${output}`);
} finally {
  fs.writeFileSync(
    path.join(output, 'resultado.json'),
    JSON.stringify({ completed, checks, pageErrors }, null, 2),
  );
  if (!completed && context?.pages()[0])
    await context
      .pages()[0]
      .screenshot({ path: path.join(output, 'falha.png'), fullPage: true })
      .catch(() => {});
  db?.close();
  await context?.close();
  await browser?.close();
  if (child?.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {}
    } else child.kill('SIGTERM');
  }
  fs.closeSync(log);
}
