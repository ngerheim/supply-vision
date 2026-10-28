import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function criarTemporarioTeste(prefixo) {
  // O caminho longo evita falhas de cpSync com TEMP em formato Windows 8.3.
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefixo));
}

export function motivoPularIntegracaoWindows(env = process.env, plataforma = process.platform) {
  if (env.SV_TESTES_INTEGRACAO_WINDOWS !== '1') return 'Integracao privilegiada somente no CI: exige SV_TESTES_INTEGRACAO_WINDOWS=1.';
  if (plataforma !== 'win32') return 'Integracao privilegiada exige Windows.';
  return false;
}
