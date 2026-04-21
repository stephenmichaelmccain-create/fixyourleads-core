import IORedis from 'ioredis';

let redisInstance: IORedis | null = null;

export function getRedis() {
  if (!redisInstance) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL is not configured');
    }

    redisInstance = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true
    });
  }

  return redisInstance;
}
