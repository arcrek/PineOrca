// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { handleWorkerCommand } from '@pineorca/engine-pinets/worker';

const workerScope: any = typeof self !== 'undefined' ? self : globalThis;

workerScope.onmessage = async (e: MessageEvent) => {
  await handleWorkerCommand(e.data, (res: any, transfer?: Transferable[]) => {
    if (transfer && transfer.length > 0) {
      workerScope.postMessage(res, transfer);
    } else {
      workerScope.postMessage(res);
    }
  });
};
