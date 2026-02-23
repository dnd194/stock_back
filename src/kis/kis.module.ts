import { Module } from '@nestjs/common';
import { KisService } from './kis.service';
import { KisController } from './kis.controller';

@Module({
  providers: [KisService],
  exports: [KisService],
  controllers: [KisController],

})
export class KisModule {}
