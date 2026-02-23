import { Module, Global, Logger } from '@nestjs/common';
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
        const redisConfig = configService.get('redis');
        const options: import('ioredis').RedisOptions = {
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            logger.warn(`Redis 연결 재시도 (${times}회), ${delay}ms 후 재시도`);
            return delay;
          },
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        };

        const redis = redisConfig?.url
          ? new Redis(redisConfig.url, options)
          : new Redis({
              ...options,
              host: redisConfig?.host ?? 'localhost',
              port: redisConfig?.port ?? 6379,
              password: redisConfig?.password,
              ...(redisConfig?.tls ? { tls: {} } : {}),
            });

        redis.on('connect', () => {
          const desc = redisConfig?.url ? redisConfig.url.replace(/:[^:@]+@/, ':****@') : `${redisConfig?.host}:${redisConfig?.port}`;
          logger.log(`Redis 연결 성공: ${desc}`);
        });

        redis.on('error', (error) => {
          logger.error('Redis 연결 오류', error);
        });

        redis.on('close', () => {
          logger.warn('Redis 연결 종료');
        });

        redis.on('reconnecting', () => {
          logger.log('Redis 재연결 시도 중...');
        });

        return redis;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
