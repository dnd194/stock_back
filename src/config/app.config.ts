// src/config/app.config.ts
import { registerAs } from '@nestjs/config';
import { resolveEnableCronBatch } from './cron-batch.util';

export default registerAs('app', () => ({
  frontendOrigin: process.env.FRONTEND_ORIGIN?.split(',') ?? [
    'http://localhost:3000',
  ],
  corsMethods: process.env.CORS_METHODS?.split(',') ?? ['GET'],
  port: parseInt(process.env.PORT ?? '3001', 10),
  enableCronBatch: resolveEnableCronBatch(),
}));