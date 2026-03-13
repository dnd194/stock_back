import { Module } from '@nestjs/common';
import { KisModule } from '../kis/kis.module';
import { BatchService } from './batch.service';
import { SupplySellBatch } from './supply-sell.batch';

@Module({
  imports: [KisModule],
  providers: [BatchService, SupplySellBatch],
})
export class BatchModule {}
