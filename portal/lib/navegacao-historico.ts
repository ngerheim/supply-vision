import { enderecoDaChave, enderecoParaBusca, resolverEndereco, type Nav } from './navegacao.ts';
import type { UsuarioPermissao } from './permissoes.ts';

export function iniciarNavegacao(
  usuario: UsuarioPermissao,
  aplicar: (rota: ReturnType<typeof resolverEndereco>) => void,
  janela: {
    location: Pick<Location, 'pathname' | 'search' | 'hash'>;
    history: Pick<History, 'pushState'>;
    addEventListener: (tipo: 'popstate', ouvinte: () => void) => void;
    removeEventListener: (tipo: 'popstate', ouvinte: () => void) => void;
  },
) {
  const ler = () => aplicar(resolverEndereco(usuario, janela.location.search));
  janela.addEventListener('popstate', ler);
  ler();
  return {
    navegar(chave: Nav, chamado?: string) {
      const params = new URLSearchParams(enderecoParaBusca(enderecoDaChave(chave)));
      if (chamado) params.set('chamado', chamado);
      const endereco = `${janela.location.pathname}?${params}${janela.location.hash}`;
      const atual = `${janela.location.pathname}${janela.location.search}${janela.location.hash}`;
      if (endereco !== atual) janela.history.pushState(null, '', endereco);
      ler();
    },
    parar() { janela.removeEventListener('popstate', ler); },
  };
}
