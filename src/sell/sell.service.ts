import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { getSlotAndDateForCache } from '../common/utils/market-slot.utils';
import { RefinedStock, NetSellType } from './sell.types';

type NetSellResult =
  | { refined: RefinedStock[] }
  | { message: string };

@Injectable()
export class SellService {
  private readonly logger = new Logger(SellService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** 쌍매도 순매도 순위 */
  async getTotalNetSell(): Promise<NetSellResult> {
    return this.getNetSellByType('total');
  }

  /** 기관 순매도 순위 */
  async getInstitutionNetSell(): Promise<NetSellResult> {
    return this.getNetSellByType('institution');
  }

  /** 외국인 순매도 순위 */
  async getForeignNetSell(): Promise<NetSellResult> {
    return this.getNetSellByType('foreign');
  }

  private async getNetSellByType(type: NetSellType): Promise<NetSellResult> {
    this.logger.log(`getNetSellByType: ${type}`);

    const { dateStr, slot } = getSlotAndDateForCache(dayjs(), 'YYYY-MM-DD');

    const { data, error } = await this.supabase
      .from('trading_data_sell')
      .select('name, code, foreign_qty, institution_qty, foreign_amount, institution_amount, fund_amount, total_amount, rank')
      .eq('type', type)
      .eq('date', dateStr)
      .eq('slot', slot)
      .order('rank', { ascending: true });

    if (error) {
      this.logger.error(`trading_data_sell 조회 실패 (${type})`, error);
      return { message: `데이터 조회 실패: ${error.message}` };
    }

    if (!data || data.length === 0) {
      this.logger.log(`trading_data_sell 없음: ${type} ${dateStr} ${slot}`);
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
