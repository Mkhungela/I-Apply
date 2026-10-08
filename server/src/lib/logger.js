import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 20;

const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };

function emit(level, scope, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
  const text =
    config.env === 'production'
      ? JSON.stringify(line)
      : `${COLORS[level] || ''}${line.t} ${level.toUpperCase().padEnd(5)} [${scope}]${COLORS.reset} ${message}` +
        (meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '');
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

/** Creates a namespaced logger, e.g. logger('scheduler').info('tick') */
export function logger(scope) {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
    child: (sub) => logger(`${scope}:${sub}`),
  };
}

export const log = logger('app');
