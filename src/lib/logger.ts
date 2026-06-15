/** Minimal structured JSON logger with correlation fields. No external deps. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  level: LogLevel = 'info',
  base: Record<string, unknown> = {},
  sink: (line: string) => void = (line) => process.stdout.write(line + '\n'),
): Logger {
  const min = LEVEL_RANK[level];
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_RANK[lvl] < min) return;
    sink(JSON.stringify({ level: lvl, msg, ...base, ...fields }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }, sink),
  };
}
