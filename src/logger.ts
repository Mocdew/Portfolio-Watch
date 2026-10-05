import { pino } from 'pino';
import { getConfig } from './config';

// Redact anything that could leak a secret, regardless of where it appears.
const redactPaths = [
  'AGENT_PRIVATE_KEY',
  '*.AGENT_PRIVATE_KEY',
  'privateKey',
  '*.privateKey',
  'req.headers.authorization',
  'headers.authorization',
];

export function createLogger() {
  const cfg = getConfig();
  return pino({
    level: cfg.LOG_LEVEL,
    base: { service: 'waterline' },
    redact: { paths: redactPaths, censor: '[redacted]' },
  });
}

export const logger = createLogger();
