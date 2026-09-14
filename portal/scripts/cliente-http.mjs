// Cliente HTTP de baixo nivel para provar o que o Invoke-WebRequest nao prova.
// Permite enviar o corpo em pedacos e manter uma requisicao aberta, necessario
// para testar limites de fluxo e exclusao mutua sem depender de sorte.
import http from 'node:http';

const HOST = '127.0.0.1';

export function abrirRequisicao({ metodo = 'POST', caminho, cabecalhos = {}, porta, timeoutMs = 30000 }) {
  let req;
  let concluida = false;
  const resposta = new Promise((resolve) => {
    const concluir = (valor) => {
      if (concluida) return;
      concluida = true;
      resolve(valor);
    };
    req = http.request({
      host: HOST, port: porta, path: caminho, method: metodo, agent: false,
      headers: { connection: 'close', ...cabecalhos },
    }, (res) => {
      let dados = '';
      res.on('data', (c) => { dados += c; });
      res.on('end', () => concluir({ status: res.statusCode, corpo: dados, cabecalhos: res.headers }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`tempo limite de ${timeoutMs} ms`)));
    req.on('error', (e) => concluir({ status: 0, corpo: '', erro: e.message }));
  });
  return {
    resposta,
    escrever: (pedaco) => new Promise((resolve) => {
      if (req.destroyed) { resolve(false); return; }
      req.write(pedaco, (erro) => resolve(!erro));
    }),
    terminar: (pedaco) => pedaco === undefined ? req.end() : req.end(pedaco),
    destruir: () => req.destroy(),
  };
}

export async function requisitar({ metodo = 'POST', caminho, cabecalhos = {}, corpo = null, pedacos = null, porta, timeoutMs }) {
  const aberta = abrirRequisicao({ metodo, caminho, cabecalhos, porta, timeoutMs });
  if (pedacos) {
    for (const pedaco of pedacos) {
      if (!await aberta.escrever(pedaco)) break;
    }
    aberta.terminar();
  } else if (corpo !== null) {
    aberta.terminar(corpo);
  } else {
    aberta.terminar();
  }
  return aberta.resposta;
}

export function multipart(nomeArquivo, bytes) {
  const limite = '----portal' + Math.random().toString(36).slice(2);
  const cabecalho = Buffer.from(
    `--${limite}\r\nContent-Disposition: form-data; name="file"; filename="${nomeArquivo}"\r\n` +
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n',
  );
  const rodape = Buffer.from(`\r\n--${limite}--\r\n`);
  return { corpo: Buffer.concat([cabecalho, Buffer.from(bytes), rodape]), tipo: `multipart/form-data; boundary=${limite}` };
}
