import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisHealthController } from './redis-health.controller';

@Global()
@Module({
  controllers: [RedisHealthController],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisModule');
        const config = configService.get<{ url?: string; host?: string; port?: number; password?: string; tls?: boolean }>('redis');

        const options: import('ioredis').RedisOptions = {
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            logger.warn(`Redis 재시도 ${times}회, ${delay}ms 후`);
            return delay;
          },
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        };

        const redis = config?.url
          ? new Redis(config.url, options)
          : new Redis({
              ...options,
              host: config?.host ?? 'localhost',
              port: config?.port ?? 6379,
              password: config?.password,
              ...(config?.tls ? { tls: {} } : {}),
            });

        redis.on('connect', () => {
          const desc = config?.url
            ? config.url.replace(/:[^:@]+@/, ':****@')
            : `${config?.host ?? 'localhost'}:${config?.port ?? 6379}`;
          logger.log(`Redis 연결: ${desc}`);
        });
        redis.on('error', (err) => logger.error('Redis 오류', err));
        redis.on('close', () => logger.warn('Redis 연결 종료'));
        redis.on('reconnecting', () => logger.log('Redis 재연결 중'));

        return redis;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
