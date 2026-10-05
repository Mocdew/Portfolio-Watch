import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = { PORT: '8080' } as NodeJS.ProcessEnv;

describe('config: PUBLIC_URL derivation', () => {
  it('uses an explicit PUBLIC_URL as-is', () => {
    const cfg = loadConfig({
      ...base,
      PUBLIC_URL: 'https://custom.example',
      RENDER_EXTERNAL_URL: 'https://waterline.onrender.com',
    });
    expect(cfg.PUBLIC_URL).toBe('https://custom.example');
  });

  it('falls back to RENDER_EXTERNAL_URL when PUBLIC_URL is unset', () => {
    const cfg = loadConfig({
      ...base,
      RENDER_EXTERNAL_URL: 'https://waterline.onrender.com',
    });
    expect(cfg.PUBLIC_URL).toBe('https://waterline.onrender.com');
  });

  it('ignores a malformed RENDER_EXTERNAL_URL', () => {
    const cfg = loadConfig({ ...base, RENDER_EXTERNAL_URL: 'not-a-url' });
    expect(cfg.PUBLIC_URL).toBeUndefined();
  });

  it('leaves PUBLIC_URL unset when neither is provided', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.PUBLIC_URL).toBeUndefined();
  });
});

describe('config: TRUST_PROXY parsing', () => {
  it('defaults to false', () => {
    expect(loadConfig({ ...base }).TRUST_PROXY).toBe(false);
  });

  it('is true for "true" or "1" only', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'yes' }).TRUST_PROXY).toBe(false);
  });
});
