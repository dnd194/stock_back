import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { getSlotAndDateForCache } from '../common/utils/market-slot.utils';
import { RefinedStock, RankType } from './rank.types';

type RankResult = {
  refined: RefinedStock[];
} | {
  message: string;
};

@Injectable()
export class RankService {
  private readonly logger = new Logger(RankService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** 쌍끌이 순위 (Supabase trading_data 조회) */
  async getSsangkkeuli(): Promise<RankResult> {
    return this.getRankByType('total');
  }

  /** 기관 순매수 순위 */
  async getInstitution(): Promise<RankResult> {
    return this.getRankByType('institution');
  }

  /** 외국인 순매수 순위 */
  async getForeign(): Promise<RankResult> {
    return this.getRankByType('foreign');
  }

  private async getRankByType(type: RankType): Promise<RankResult> {
    this.logger.log(`getRankByType: ${type}`);

    const { dateStr, slot } = getSlotAndDateForCache(dayjs());

    const { data, error } = await this.supabase
      .from('trading_data')
      .select('name, code, foreign_qty, institution_qty, foreign_amount, institution_amount, fund_amount, total_amount, rank')
      .eq('type', type)
      .eq('date', dateStr)
      .eq('slot', slot)
      .order('rank', { ascending: true });

    if (error) {
      this.logger.error(`trading_data 조회 실패 (${type})`, error);
      return { message: `데이터 조회 실패: ${error.message}` };
    }

    if (!data || data.length === 0) {
      this.logger.log(`trading_data 없음: ${type} ${dateStr} ${slot}`);
      return { message: '해당 시점의 데이터가 없습니다.' };
    }

    const refined = data.map((row) => this.toRefinedStock(row));
    return { refined };
  }

  private toRefinedStock(row: {
    name: string;
    code: string;
    foreign_qty: number;
    institution_qty: number;
    foreign_amount: number;
    institution_amount: number;
    fund_amount: number;
    total_amount: number;
  }): RefinedStock {
    return {
      name: row.name,
      code: row.code,
      foreignQty: Number(row.foreign_qty),
      institutionQty: Number(row.institution_qty),
      foreignAmount: Number(row.foreign_amount),
      institutionAmount: Number(row.institution_amount),
      fundAmount: Number(row.fund_amount),
      totalAmount: Number(row.total_amount),
    };
  }
}
