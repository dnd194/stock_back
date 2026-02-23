import { Controller, Get, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

@Controller('health')
export class RedisHealthController {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const start = Date.now();
    try {
      const pong = await this.redis.ping();
      const latency = Date.now() - start;
      return {
        status: 'ok',
        redis: pong === 'PONG' ? 'connected' : 'unknown',
        latencyMs: latency,
      };
    } catch (error) {
      return {
        status: 'error',
        redis: 'disconnected',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
