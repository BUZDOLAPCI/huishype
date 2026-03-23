const { afterAll } = require('@jest/globals');

afterAll(async () => {
  const { closeConnection } = await import('./src/db/index.js');
  await closeConnection();
});
