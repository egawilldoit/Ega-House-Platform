import type { AppConfig } from './config.js';

export function createLoggerConfig(config: AppConfig): Record<string, unknown> {
  const loggerConfig: Record<string, unknown> = {
    level: config.logLevel,
    redact: {
      paths: [
        'authorization',
        'req.headers.authorization',
        'res.headers.authorization',
        '*.access_token',
        '*.refresh_token',
        '*.api_key',
        '*.secret',
        '*.token',
        '*.password',
        '*.key',
      ],
      censor: '[REDACTED]',
    },
  };

  if (config.logLevel === 'debug') {
    loggerConfig['transport'] = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' },
    };
  }

  return loggerConfig;
}
