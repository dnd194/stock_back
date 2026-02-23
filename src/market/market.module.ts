import { Module } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { KisModule } from '../kis/kis.module';

@Module({
  imports: [KisModule],
  providers: [MarketService],
  controllers: [MarketController],
  // exports: [MarketService],
})
export class MarketModule {}
