import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executarBackup, enviarEmergencia } from '../scripts/backup.mjs';
import { localizar7zip, lerSenhaBackup, executar7z } from '../scripts/backup-7z.mjs';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';

void test('senha ausente, 7-Zip ausente ou antigo falham com alerta e sem expor segredo', async t => {
  const dir = criarTemporarioTeste('sv-sem-senha-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => lerSenhaBackup({ raiz: dir }), /supv backup senha/);
  assert.throws(() => localizar7zip({}, () => { throw new Error('segredo'); }), /7-Zip ausente/);
  assert.throws(() => localizar7zip({}, () => '7-Zip 23.01 (x64)'), /minima 24.09/);
  assert.equal(localizar7zip({ BACKUP_7ZIP_MIN_VERSION: '26.04' }, () => '7-Zip 26.04 (x64)'), 'C:\\Program Files\\7-Zip\\7z.exe');
  assert.throws(() => executar7z('inexistente', 'segredo', ['t', 'arquivo']), e => !String(e).includes('segredo') && !e.cause);
  for (const senha of [() => lerSenhaBackup({ raiz: dir }), () => { throw new Error('segredo'); }]) {
    const logs = []; let alertas = 0;
    const codigo = await executarBackup({ ensaio: false, config: {}, senha, avisar: async () => alertas++, registrar: m => logs.push(m) });
    assert.equal(codigo, 1); assert.equal(alertas, 1); assert.doesNotMatch(logs.join('\n'), /segredo/);
  }
});
void test('backup na rede nao exige SMTP e nunca envia comprovante nem respeita chave legada', async () => {
  assert.equal(await executarBackup({ ensaio: false, config: { BACKUP_NETWORK_DIR: 'ficticio', BACKUP_ANEXAR_BANCO: 'true' },
    senha: () => 'ficticia', zip: () => 'ficticio', preparar() {}, compactar() {},
    retentar: rede => rede(1000), rede: async () => 'confirmado', email: () => assert.fail(), avisar: () => assert.fail(),
  }), 0);
});
void test('emergencia usa mesmo arquivo e destinatario admin; acima do limite envia so alerta; SMTP falha sanitizado', async t => {
  const dir = criarTemporarioTeste('sv-email-backup-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const arquivo = path.join(dir, 'supply-vision-2026-10-16_1330.7z'); fs.writeFileSync(arquivo, 'pacote criptografado');
  for (const mb of ['15', '0.000001']) {
    let mensagem, fechou = false;
    await enviarEmergencia({ ADMIN_ALERTA_EMAIL: 'ficticio@example.com', BACKUP_EMAIL_MAX_MB: mb }, arquivo, {
      criarTransporte: () => ({ sendMail: async m => { mensagem = m; }, close: () => { fechou = true; } }), registrar() {},
    });
    assert.equal(mensagem.to, 'ficticio@example.com'); assert.match(mensagem.text, /rede falhou/);
    assert.equal(mensagem.attachments.length, mb === '15' ? 1 : 0);
    if (mensagem.attachments.length) assert.equal(mensagem.attachments[0].path, arquivo);
    assert.ok(fechou);
  }
  await assert.rejects(enviarEmergencia({ BACKUP_EMAIL_TO: 'ficticio@example.com' }, arquivo, {
    criarTransporte: () => ({ sendMail: async () => { throw new Error('segredo SMTP'); }, close() {} }),
  }), e => /emergencia falhou/.test(e.message) && !e.message.includes('segredo'));
});
void test('DPAPI indecifravel nunca propaga saida nativa, e falha de versao chega ao alerta', async t => {
  const dir = criarTemporarioTeste('sv-dpapi-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'comum')); fs.writeFileSync(path.join(dir, 'comum/backup-senha.dpapi'), 'cipher-ficticio');
  assert.throws(() => lerSenhaBackup({ raiz: dir, executar() { throw new Error('senha-ficticia-que-nao-pode-vazar'); } }), e => !e.message.includes('senha-ficticia-que-nao-pode-vazar') && !e.cause);
  let detalhe;
  assert.equal(await executarBackup({ ensaio: false, config: {}, senha: () => 'ficticia', zip: () => localizar7zip({}, () => '7-Zip 23.01'),
    avisar: async (evento, opcoes) => { detalhe = opcoes.detalhe; }, registrar() {}, preparar() { assert.fail(); },
  }), 1);
  assert.match(detalhe, /minima 24.09/);
});
void test('Windows: senha gravada duas vezes sem eco e decifrada com DPAPI da conta atual', { skip: process.platform !== 'win32' }, async t => {
  const { execFileSync } = await import('node:child_process');
  // O host pode ser PS7: seus modulos herdados impedem o PS5.1 de carregar
  // Microsoft.PowerShell.Security. O filho deve usar os modulos do proprio PS5.1.
  const modulosAnteriores = process.env.PSModulePath;
  delete process.env.PSModulePath;
  t.after(() => { if (modulosAnteriores === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = modulosAnteriores; });
  const dir = criarTemporarioTeste('sv-senha-windows-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.resolve(import.meta.dirname, '../../scripts/backup-senha.ps1');
  const codigo = "$global:leiturasFixture=0; function Read-Host { param([string]$Prompt,[switch]$AsSecureString); if (!$AsSecureString) { throw 'Leitura deve ser segura' }; $global:leiturasFixture++; ConvertTo-SecureString $env:SV_SENHA_FIXTURE -AsPlainText -Force }; & $env:SV_SCRIPT_FIXTURE; if ($global:leiturasFixture -ne 2) { throw 'Exige duas entradas' }";
  const senha = 'Ficticia ç !"123';
  const saida = execFileSync('powershell.exe', ['-NoProfile', '-Command', codigo], { encoding: 'utf8', env: { ...process.env,
    SUPPLY_VISION_PRIVADO: dir, SV_SENHA_FIXTURE: senha, SV_SCRIPT_FIXTURE: script }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, windowsHide: true });
  assert.ok(!saida.includes(senha));
  assert.ok(!fs.readFileSync(path.join(dir, 'comum/backup-senha.dpapi'), 'utf8').includes(senha));
  assert.equal(lerSenhaBackup({ raiz: dir }), senha);
});
