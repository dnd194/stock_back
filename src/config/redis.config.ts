import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  // Upstash: Redis 대시보드에서 "Redis Connect" 또는 "Node" 탭의 URL 사용
  // 형식: rediss://:PASSWORD@ENDPOINT.upstash.io:6379
  const url = process.env.REDIS_URL ?? process.env.UPSTASH_REDIS_URL;

  return {
    url,
    // 로컬/직접 설정 시 (url 없을 때 사용)
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_TLS === 'true' || !!url,
  };
});
