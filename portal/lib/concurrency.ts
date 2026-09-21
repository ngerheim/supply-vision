// Proteção local de recursos; não substitui limites no proxy entre processos.
export class ConcurrencyGate {
  private active = 0;
  private queue: Array<(release: () => void) => void> = [];
  private readonly limit: number;
  private readonly waiting: number;
  constructor(limit: number, waiting: number) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(waiting) || waiting < 0) throw new Error('Limites de concorrência inválidos');
    this.limit = limit;
    this.waiting = waiting;
  }
  acquire(): Promise<(() => void) | null> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.release());
    }
    if (this.queue.length >= this.waiting) return Promise.resolve(null);
    return new Promise(resolve => this.queue.push(resolve));
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next(this.release());
      else this.active--;
    };
  }
}
