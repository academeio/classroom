const counters = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxPerWindow: number, windowMs: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let entry = counters.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    counters.set(key, entry);
  }

  entry.count++;
  const allowed = entry.count <= maxPerWindow;
  return { allowed, remaining: Math.max(0, maxPerWindow - entry.count) };
}
