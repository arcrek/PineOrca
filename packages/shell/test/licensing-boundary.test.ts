// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Licensing Boundary & AGPL-3.0 Seam Isolation', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  it('verifies Apache-2.0 package manifests contain zero AGPL runtime dependencies', () => {
    const packagesToCheck = ['ui', 'chart', 'worker-bridge', 'shell'];

    for (const pkgName of packagesToCheck) {
      const pkgJsonPath = path.join(rootDir, 'packages', pkgName, 'package.json');
      expect(fs.existsSync(pkgJsonPath), `Missing package.json for ${pkgName}`).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      expect(pkg.license).toBe('Apache-2.0');

      const deps = pkg.dependencies || {};
      expect(
        deps['@pineorca/engine-pinets'],
        `Forbidden dependency @pineorca/engine-pinets detected in ${pkgName}/package.json`,
      ).toBeUndefined();
    }
  });

  it('scans all TypeScript source files to guarantee zero copyleft AST leaks outside worker boundary', () => {
    const searchDirs = [
      path.join(rootDir, 'packages/ui/src'),
      path.join(rootDir, 'packages/chart/src'),
      path.join(rootDir, 'packages/worker-bridge/src'),
      path.join(rootDir, 'packages/shell/src'),
    ];

    const allowedFile = path.resolve(rootDir, 'packages/shell/src/worker/engine.worker.ts');
    const violatingFiles: string[] = [];

    function scanDir(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          if (path.resolve(fullPath) === allowedFile) {
            continue; // The only designated boundary bridge
          }

          const content = fs.readFileSync(fullPath, 'utf8');
          // Check for static and dynamic imports of engine-pinets
          if (
            content.includes('@pineorca/engine-pinets') ||
            content.includes('engine-pinets')
          ) {
            violatingFiles.push(fullPath);
          }
        }
      }
    }

    for (const dir of searchDirs) {
      scanDir(dir);
    }

    expect(
      violatingFiles,
      `Detected AGPL engine-pinets import in host files: ${violatingFiles.join(', ')}`,
    ).toHaveLength(0);
  });
});
