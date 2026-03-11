import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** 월~금 23:55에 실행: 당일 date 중 slot이 14:30이 아닌 trading_data 삭제 */
  @Cron('55 23 * * 1-5', {
    timeZone: 'Asia/Seoul',
  })
  async cleanupTradingDataBefore14(): Promise<void> {
    this.logger.log('trading_data 정리 배치 시작');

    const todayStr = dayjs().format('YYYY-MM-DD');

    const { data, error } = await this.supabase
      .from('trading_data')
      .delete()
      .eq('date', todayStr)
      .neq('slot', '14:30')
      .select('id');

    if (error) {
      this.logger.error('trading_data 정리 실패', error);
      return;
    }

    const deletedCount = data?.length ?? 0;
    this.logger.log(
      `trading_data 정리 완료: 당일(${todayStr}) slot≠14:30 ${deletedCount}건 삭제`,
    );
  }
}
