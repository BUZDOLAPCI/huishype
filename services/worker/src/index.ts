import { ensureWorkerRuntimeEnv } from './config.js';

try {
  ensureWorkerRuntimeEnv();
  const { runWorker } = await import('./runtime.js');
  await runWorker();
} catch {
  process.exitCode = process.exitCode ?? 1;
}
