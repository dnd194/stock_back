// src/config/kis.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('kis', () => ({
  appKey: process.env.KIS_APP_KEY,
  appSecret: process.env.KIS_APP_SECRET,
  baseUrl:
    process.env.KIS_BASE_URL ??
    'https://openapi.koreainvestment.com:9443',
}));