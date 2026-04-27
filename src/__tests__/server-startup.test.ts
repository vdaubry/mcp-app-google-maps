import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS, MAPS_RESOURCE_URI } from '../handlers/index.js';
import { GOOGLE_MAPS_INSTRUCTIONS } from '../instructions.js';
import { _resetBundleCache } from '../bundle-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('TOOL_DEFINITIONS — server-side registration shape', () => {
  it('exposes 9 tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(9);
  });

  it('all tools point at the canonical resource URI', () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.spec._meta.ui.resourceUri).toBe(MAPS_RESOURCE_URI);
    }
  });

  it('every tool has an input schema (object shape)', () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(typeof def.spec.inputSchema).toBe('object');
    }
  });

  it('every tool has a non-empty description', () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.spec.description).toBeTruthy();
      expect(def.spec.description.length).toBeGreaterThan(10);
    }
  });
});

describe('GOOGLE_MAPS_INSTRUCTIONS', () => {
  it('mentions all four model-callable tools', () => {
    expect(GOOGLE_MAPS_INSTRUCTIONS).toContain('get_directions');
    expect(GOOGLE_MAPS_INSTRUCTIONS).toContain('nearby_places');
    expect(GOOGLE_MAPS_INSTRUCTIONS).toContain('search_places');
    expect(GOOGLE_MAPS_INSTRUCTIONS).toContain('geocode');
  });
});

describe('MAPS_RESOURCE_URI', () => {
  it('matches the SEP-1865 ui:// scheme', () => {
    expect(MAPS_RESOURCE_URI).toBe('ui://google-maps/v1');
  });
});

describe('server boot — env-var enforcement', () => {
  beforeEach(() => {
    _resetBundleCache();
  });

  it('refuses to start without GOOGLE_MAPS_API_KEY', async () => {
    const serverPath = path.resolve(__dirname, '../../dist/server.js');
    // Skip if the server hasn't been built yet (pure unit-test run).
    const fs = await import('node:fs');
    if (!fs.existsSync(serverPath)) {
      // eslint-disable-next-line no-console
      console.warn('[server-startup.test] dist/server.js missing — skipping subprocess assertion');
      return;
    }
    const proc = spawn('node', [serverPath], {
      env: { ...process.env, GOOGLE_MAPS_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('close', (code) => resolve(code));
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('GOOGLE_MAPS_API_KEY');
  }, 15_000);
});
