import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { type Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private _client?: Redis;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url =
      this.configService?.get('REDIS_URL') ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

    this._client = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this._client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  get client(): Redis {
    if (!this._client) {
      throw new Error('RedisService accessed before initialization');
    }
    return this._client;
  }

  /**
   * One hit on a fixed-window counter (rate limits): returns the count in the
   * current window. `SET NX EX` and `INCR` run in one MULTI, so the window's
   * TTL is set together with the key; the old separate INCR then EXPIRE could
   * leave a key with no TTL after a crash in between, blocking that caller
   * for good. While Redis is not connected this refuses with 503 instead of
   * waiting: the client queues commands with no retry limit, which hung the
   * request until Redis came back.
   */
  async hitWindow(key: string, windowSeconds: number): Promise<number> {
    const client = this.client;
    if (client.status !== 'ready') {
      throw new ServiceUnavailableException({
        title: 'Temporarily unavailable',
        status: 503,
        detail: 'Please try again in a moment.',
      });
    }
    const results = await client.multi().set(key, '0', 'EX', windowSeconds, 'NX').incr(key).exec();
    const counted = results?.[1];
    if (!counted || counted[0]) {
      throw counted?.[0] ?? new Error(`Rate counter ${key} failed`);
    }
    return Number(counted[1]);
  }

  async onModuleDestroy(): Promise<void> {
    await this._client?.quit();
  }
}
