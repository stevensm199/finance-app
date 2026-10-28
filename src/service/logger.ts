export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
}
