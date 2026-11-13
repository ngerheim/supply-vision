import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// O html tem CSS zoom (--zoom-portal em globals.css) e o posicionamento das
// listas flutuantes (Floating UI) nao conhece zoom: mede o campo em pixels de
// tela e grava a posicao em pixels CSS, que o zoom encolhe de novo. A lista
// caia deslocada e, nos dialogos, por cima do campo -- o soltar do clique
// escolhia (ou desmarcava) um item e a lista fechava. Esta ancora entrega a
// medida ja em pixels CSS.
export function ancoraComZoom(ref: { current: Element | null }) {
  return {
    get contextElement() { return ref.current ?? undefined; },
    getBoundingClientRect() {
      const r = ref.current?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const x = r.x / zoom, y = r.y / zoom, width = r.width / zoom, height = r.height / zoom;
      return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
    },
  };
}
