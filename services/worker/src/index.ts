import { ensureWorkerRuntimeEnv } from './config.js';

try {
  ensureWorkerRuntimeEnv();
  const { runWorker } = await import('./runtime.js');
  await runWorker();
} catch (error) {
  console.error('Worker failed to start', error);
  process.exitCode = process.exitCode ?? 1;
}
