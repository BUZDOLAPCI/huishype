import { config } from '../config.js';

type RedisConnection = {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  quit(): Promise<unknown>;
  disconnect(): void;
};

let sharedConnection: RedisConnection | null = null;

function configureRedisConnection(connection: RedisConnection): RedisConnection {
  connection.on('error', (error) => {
    console.error('Redis connection error', error);
  });
  return connection;
}

async function loadRedisConstructor(): Promise<new (url: string, options: Record<string, unknown>) => RedisConnection> {
  const redisModule = await import('ioredis');
  return (redisModule.default ?? redisModule) as new (
    url: string,
    options: Record<string, unknown>,
  ) => RedisConnection;
}

export async function createRedisConnection(): Promise<RedisConnection> {
  const RedisClient = await loadRedisConstructor();

  return configureRedisConnection(new RedisClient(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  }));
}

export async function getRedisConnection(): Promise<RedisConnection> {
  if (sharedConnection) {
    return sharedConnection;
  }

  sharedConnection = await createRedisConnection();
  return sharedConnection;
}

export async function closeRedisConnection(): Promise<void> {
  if (!sharedConnection) {
    return;
  }

  const connection = sharedConnection;
  sharedConnection = null;
  await connection.quit().catch(async () => {
    connection.disconnect();
  });
}
