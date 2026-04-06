declare module 'ioredis' {
  const Redis: unknown;
  export default Redis;
}

declare module 'bullmq' {
  export const Queue: unknown;
  const bullmqDefault: unknown;
  export default bullmqDefault;
}
