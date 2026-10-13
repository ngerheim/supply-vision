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

// Evita que um unico alvo ocupe toda a fila. Nao e bloqueio de conta:
// a reserva existe apenas durante uma tentativa e sempre e liberada.
export class KeyedConcurrencyGate {
  private keys = new Set<string>();
  private gate: ConcurrencyGate;
  constructor(limit: number, waiting: number) { this.gate = new ConcurrencyGate(limit, waiting); }
  async acquire(key: string): Promise<(() => void) | null> {
    if (this.keys.has(key)) return null;
    this.keys.add(key);
    try {
      const release = await this.gate.acquire();
      if (!release) { this.keys.delete(key); return null; }
      let released = false;
      return () => { if (released) return; released = true; release(); this.keys.delete(key); };
    } catch (error) { this.keys.delete(key); throw error; }
  }
}

// Reserva imediata por IP antes de ocupar uma vaga ativa ou espera global.
// Inclui os clientes esperando; recusa excesso sem criar outra fila.
export class IpConcurrencyGate {
  private slots = new Map<string, number>();
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Limite por IP inválido');
  }
  acquire(ip: string): (() => void) | null {
    const usados = this.slots.get(ip) || 0;
    if (usados >= this.limit) return null;
    this.slots.set(ip, usados + 1);
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      const restantes = (this.slots.get(ip) || 1) - 1;
      if (restantes) this.slots.set(ip, restantes);
      else this.slots.delete(ip);
    };
  }
}
