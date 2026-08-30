import type { StorageAdapter } from './adapter.js';
import { MemoryStorageAdapter } from './memory.js';
import { UpstashRedisStorageAdapter } from './redis.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('storage-factory');

let storageInstance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!storageInstance) {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

    if (redisUrl && redisToken) {
      logger.info('Initializing Upstash Redis serverless storage adapter');
      storageInstance = new UpstashRedisStorageAdapter(redisUrl, redisToken);
    } else {
      logger.info('Using in-memory storage adapter (development/test/offline mode)');
      storageInstance = new MemoryStorageAdapter();
    }
  }

  return storageInstance;
}

export function setStorage(adapter: StorageAdapter): void {
  storageInstance = adapter;
}

export * from './adapter.js';
export { MemoryStorageAdapter } from './memory.js';
export { UpstashRedisStorageAdapter } from './redis.js';
