import { buildApp } from './app.js';
import { config } from './config.js';
import { closeConnection } from './db/index.js';

async function start() {
  const app = await buildApp({ logger: true });

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);

      try {
        await app.close();
        await closeConnection();
        app.log.info('Server closed successfully');
        process.exit(0);
      } catch (err) {
        app.log.error(err, 'Error during shutdown');
        process.exit(1);
      }
    });
  }

  try {
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    app.log.info(`Server listening on http://${config.server.host}:${config.server.port}`);
    app.log.info(`API documentation available at http://${config.server.host}:${config.server.port}/documentation`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
