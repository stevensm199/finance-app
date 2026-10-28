import type { Logger, LogFields, LogLevel } from '../../service/logger.js';

const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class JsonLogger implements Logger {
  constructor(
    private readonly minimumLevel: LogLevel,
    private readonly writeOutput: (line: string) => void = (line) => process.stdout.write(line),
    private readonly writeError: (line: string) => void = (line) => process.stderr.write(line)
  ) {}

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (rank[level] < rank[this.minimumLevel]) return;
    const line = `${JSON.stringify({ ...fields, timestamp: new Date().toISOString(), level, event })}\n`;
    (level === 'warn' || level === 'error' ? this.writeError : this.writeOutput)(line);
  }
}
