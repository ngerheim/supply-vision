import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { rolldown } from 'rolldown';
import * as jsx from 'react/jsx-runtime';
import { ApiError, errorText } from '../../lib/api.ts';
import * as domain from '../../lib/domain.ts';
import * as busca from '../../lib/busca.ts';
import * as filtros from '../../lib/filtros-busca.ts';
import * as situacao from '../../lib/situacao-acordos.ts';

// Executa os handlers reais dos componentes sem DOM. Só hooks, HTTP e os
// componentes visuais filhos são substituídos; o compilador é o do build.
const compiled = new Map();
export async function mount(file, name, props, overrides = {}, globals = {}) {
  if (!compiled.has(file)) {
    const bundle = await rolldown({
      input: fileURLToPath(
        new URL(`../../components/${file}.tsx`, import.meta.url),
      ),
      external: (_id, importer) => Boolean(importer),
      onLog(level, warning, defaultHandler) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE')
          defaultHandler(level, warning);
      },
    });
    try {
      const { output } = await bundle.generate({ format: 'cjs' });
      compiled.set(file, output[0].code);
    } finally {
      await bundle.close();
    }
  }
  const slots = [],
    effects = [],
    requests = [];
  let cursor = 0,
    tree,
    currentProps = props;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useId() { return `id-${cursor++}`; },
    useSyncExternalStore(_assinar, obter) { return obter(); },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      return (slots[index] ||= { current: value });
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn, deps) {
      return hooks.useMemo(() => fn, deps);
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        });
    },
  };
  const visual = new Proxy({}, { get: (_target, key) => String(key) });
  const http = {
    ApiError,
    errorText,
    api(path, options) {
      const request = { path, options };
      request.promise = new Promise((resolve, reject) =>
        Object.assign(request, { resolve, reject }),
      );
      requests.push(request);
      return request.promise;
    },
  };
  const modules = {
    react: hooks,
    'react/jsx-runtime': jsx,
    '@/lib/api': http,
    '@/lib/domain': domain,
    '@/lib/busca': busca,
    '@/lib/filtros-busca': filtros,
    '@/lib/situacao-acordos': situacao,
    './portal-table': {
      ...visual,
      useOrdenacao: () => ({
        ordem: null,
        ordenar: (rows) => rows,
        alternar() {},
      }),
      CabecalhoOrdenavel: 'CabecalhoOrdenavel',
    },
    './tela-padrao': {
      BarraFiltros: ({ busca, onBusca, placeholder, children }) => jsx.jsx('div', { children: [
        onBusca ? jsx.jsx('Input', { 'aria-label': placeholder, value: busca || '', onChange: (event) => onBusca(event.target.value) }) : null,
        children,
      ] }),
      TabelaPadrao: 'TabelaPadrao',
    },
    './portal-presentation': {
      ...visual,
      money: (value) =>
        Number(value).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }),
      date: String,
      cnpj: String,
      Field: 'Field',
      Info: 'Info',
      Loading: 'Loading',
      Empty: 'Empty',
      PaginacaoDeLista: ({ pagina, paginas, alterar }) => paginas > 1 ? jsx.jsx('div', { children: [
        jsx.jsx('span', { children: `Página ${pagina} de ${paginas}` }),
        jsx.jsx('Button', { children: 'Anterior', onClick: () => alterar(pagina - 1) }),
        jsx.jsx('Button', { children: 'Próxima', onClick: () => alterar(pagina + 1) }),
      ] }) : null,
      FalhaDeCarregamento: 'FalhaDeCarregamento',
    },
    ...overrides,
  };
  const compiledModule = { exports: {} };
  runInNewContext(compiled.get(file), {
    require: (id) => modules[id] || visual,
    module: compiledModule,
    exports: compiledModule.exports,
    AbortController,
    FormData,
    File,
    URLSearchParams,
    queueMicrotask,
    setTimeout: globalThis.setTimeout,
    clearTimeout,
    ...globals,
  });
  const component = name === 'default' ? compiledModule.exports.default ?? compiledModule.exports : compiledModule.exports[name];
  const harness = {
    requests,
    render(next = currentProps) {
      currentProps = next;
      cursor = 0;
      tree = component(currentProps);
      // PortalApp delega a sessao a um componente interno; executamos seu corpo real.
      if (file === 'portal-app' && name === 'default') tree = tree.type(tree.props);
      for (const effect of effects.splice(0)) effect();
      return tree;
    },
    find(predicate) {
      const found = [];
      const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== 'object') return;
        if (predicate(node)) found.push(node);
        visit(node.props?.children);
        visit(node.props?.actions);
        visit(node.props?.title);
        visit(node.props?.status);
        visit(node.props?.tabs);
      visit(node.props?.pagina);
      };
      visit(tree);
      return found;
    },
    one(type, predicate = () => true) {
      const nodes = harness.find(
        (node) => node.type === type && predicate(node.props),
      );
      assert.equal(
        nodes.length,
        1,
        `Esperado um ${type}, encontrados ${nodes.length}`,
      );
      return nodes[0].props;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
  harness.render();
  return harness;
}
