import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const appConfig = config.get<{ frontendOrigin: string[]; corsMethods: string[]; port?: number }>('app');

  app.use(helmet());
  app.enableCors({
    origin: appConfig?.frontendOrigin ?? ['http://localhost:3000'],
    methods: appConfig?.corsMethods ?? ['GET'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  const port = appConfig?.port ?? 3001;
  await app.listen(port);
  logger.log(`Server http://localhost:${port}`);
}
bootstrap();
