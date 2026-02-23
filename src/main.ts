import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

// 🛡 Helmet이 해주는 것
// XSS 보호
// 클릭재킹 방지
// MIME 타입 스니핑 방지
// 보안 헤더 자동 설정

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const appConfig = configService.get('app');
  // 🔐 보안 헤더 설정
  app.use(helmet());

  // 🌍 CORS 설정
  app.enableCors({
    origin: appConfig.frontendOrigin,
    methods: appConfig.corsMethods,
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  const port = appConfig.port ?? 3001;
  await app.listen(port);

  logger.log(`🚀 Server running on http://localhost:${port}`);
}
bootstrap();
