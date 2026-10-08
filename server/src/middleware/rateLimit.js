/**
 * Minimal in-process rate limiter (per IP + bucket). Enough for a single-node
 * deployment; swap for a shared store when running multiple instances.
 */
const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 60, key = 'default', message = 'Too many requests' } = {}) {
  return (req, res, next) => {
    const id = `${key}:${req.ip}`;
    const now = Date.now();
    const bucket = buckets.get(id) ?? { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(id, bucket);
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    next();
  };
}
