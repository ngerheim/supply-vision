// Wrangler consulta os.homedir() mesmo com telemetria desligada. Redireciona
// somente os processos da fumaca para um perfil descartavel, mantendo a guarda.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const raiz = fs.realpathSync(process.env.SV_PREPARO_RAIZ || '');
if (fs.realpathSync(path.resolve(import.meta.dirname, '../..')) !== raiz || !/^\..+-preparo-[0-9a-f]{32}$/.test(path.basename(raiz))) throw new Error('Perfil da fumaca fora do preparo');
const perfil = path.join(raiz, '.cache/perfil-fumaca');
fs.mkdirSync(perfil, { recursive: true });
os.homedir = () => perfil;
process.env.APPDATA = path.join(perfil, 'AppData/Roaming');
process.env.LOCALAPPDATA = path.join(perfil, 'AppData/Local');
syncBuiltinESMExports();
