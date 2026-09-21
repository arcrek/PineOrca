// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { AppController } from './controller/AppController.js';

async function bootstrap(): Promise<void> {
  const app = new AppController({
    container: '#app',
  });

  await app.init();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrap());
  } else {
    bootstrap();
  }
}
