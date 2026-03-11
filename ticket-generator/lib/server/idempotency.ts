interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const completed = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function cleanup(now: number): void {
  for (const [key, entry] of completed.entries()) {
    if (entry.expiresAt <= now) {
      completed.delete(key);
    }
  }
}

export interface IdempotentResult<T> {
  value: T;
  deduped: boolean;
}

export async function runIdempotent<T>(
  key: string | undefined,
  operation: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<IdempotentResult<T>> {
  if (!key) {
    return {
      value: await operation(),
      deduped: false,
    };
  }

  const now = Date.now();
  cleanup(now);

  const cached = completed.get(key);
  if (cached && cached.expiresAt > now) {
    return {
      value: cached.value as T,
      deduped: true,
    };
  }

  const pendingOperation = pending.get(key);
  if (pendingOperation) {
    return {
      value: (await pendingOperation) as T,
      deduped: true,
    };
  }

  const created = operation();
  pending.set(key, created as Promise<unknown>);

  try {
    const value = await created;
    completed.set(key, { value, expiresAt: now + ttlMs });
    return {
      value,
      deduped: false,
    };
  } finally {
    pending.delete(key);
  }
}
