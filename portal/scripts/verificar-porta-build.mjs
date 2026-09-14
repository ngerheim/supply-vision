// Vinext limpa dist antes de compilar. No Windows, o servidor pode manter
// parte da pasta aberta: a limpeza parcial deixa a pagina sem CSS e JS.
import { createConnection } from 'node:net';

const ocupada = await new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port: 3000 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', (error) => {
    if (error.code === 'ECONNREFUSED') resolve(false);
    else reject(error);
  });
  socket.setTimeout(3000, () => {
    socket.destroy();
    reject(new Error('Nao foi possivel verificar a porta 3000. Compilacao cancelada.'));
  });
});
if (ocupada) {
  console.error('Compilacao cancelada: a porta 3000 esta em uso. Feche o portal pelo menu antes de atualizar. Para testar o build existente, use -UsarBuildExistente.');
  process.exitCode = 1;
}
