import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every `new Queue(name, ...)` construction so tests can assert dedupe.
const queueConstructions: string[] = [];

// Mock bullmq so that constructing a Queue never opens a Redis connection.
// Each `new Queue(name, opts)` becomes a lightweight fake carrying its args.
vi.mock('bullmq', () => {
  class FakeQueue {
    name: string;
    opts: unknown;
    constructor(name: string, opts: unknown) {
      this.name = name;
      this.opts = opts;
      queueConstructions.push(name);
    }
    async close(): Promise<void> {
      /* no-op */
    }
  }
  return { Queue: FakeQueue, Worker: class {}, ConnectionOptions: class {} };
});

describe('getQueue (Map dedupe)', () => {
  beforeEach(() => {
    // Reset modules so the module-level cache starts empty for each test.
    vi.resetModules();
    queueConstructions.length = 0;
  });

  it('returns the same instance for the same queue name', async () => {
    const { getQueue } = await import('../queues.js');

    const first = getQueue('notificacao');
    const second = getQueue('notificacao');

    expect(second).toBe(first);
  });

  it('returns distinct instances for different queue names', async () => {
    const { getQueue } = await import('../queues.js');

    const notificacao = getQueue('notificacao');
    const relatorio = getQueue('relatorio');

    expect(notificacao).not.toBe(relatorio);
  });

  it('named helpers dedupe against getQueue for the same name', async () => {
    const { getQueue, auditoriaQueue } = await import('../queues.js');

    // Simulates task 2.6 and this task both wanting the auditoria queue:
    // there must be exactly ONE instance.
    const viaHelper = auditoriaQueue();
    const viaGetter = getQueue('auditoria');

    expect(viaGetter).toBe(viaHelper);
  });

  it('applies the notificacao default job options on first creation', async () => {
    const { getQueue } = await import('../queues.js');

    const queue = getQueue('notificacao') as unknown as {
      opts: { defaultJobOptions: Record<string, unknown> };
    };

    expect(queue.opts.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  });

  it('creates only one underlying Queue per name even across many calls', async () => {
    const { getQueue } = await import('../queues.js');

    getQueue('limpeza');
    getQueue('limpeza');
    getQueue('limpeza');

    const limpezaConstructions = queueConstructions.filter((name) => name === 'limpeza');
    expect(limpezaConstructions).toHaveLength(1);
  });
});
