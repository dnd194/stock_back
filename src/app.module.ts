import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { KisModule } from './kis/kis.module';
import { MarketModule } from './market/market.module';
import kisConfig from './config/kis.config';
import appConfig from './config/app.config';
import redisConfig from './config/redis.config';
import geminiConfig from './config/gemini.config';
import supabaseConfig from './config/supabase.config';
import { SupabaseModule } from './supabase/supabase.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ConfigModule.forFeature(kisConfig),
    ConfigModule.forFeature(appConfig),
    ConfigModule.forFeature(redisConfig),
    ConfigModule.forFeature(geminiConfig),
    ConfigModule.forFeature(supabaseConfig),
    RedisModule,
    SupabaseModule,
    KisModule,
    MarketModule,
  ],
})
export class AppModule {}
