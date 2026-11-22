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
   * current window. `INCR` and `EXPIRE NX` run in one MULTI, so a counter
   * always has a TTL: the old separate INCR then EXPIRE could leave a key
   * with none after a crash in between, blocking that caller for good, and a
   * key already left that way gets its window on its next hit. `NX` leaves a
   * running window alone (Redis 7, which the README already requires;
   * security-alerts uses the same pair). While Redis is not connected this
   * refuses with 503 instead of waiting: the client queues commands with no
   * retry limit, which hung the request until Redis came back.
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
    const results = await client.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
    const counted = results?.[0];
    if (!counted || counted[0]) {
      throw counted?.[0] ?? new Error(`Rate counter ${key} failed`);
    }
    return Number(counted[1]);
  }

  async onModuleDestroy(): Promise<void> {
    await this._client?.quit();
  }
}
