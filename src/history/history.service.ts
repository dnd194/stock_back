import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { getSlotAndDateForCache } from '../common/utils/market-slot.utils';
import { MARKET_SUPPLY_SLOTS } from '../config/market.config';
import { RefinedStock, BuyHistoryType } from './history.types';

const LAST_SLOT = MARKET_SUPPLY_SLOTS[MARKET_SUPPLY_SLOTS.length - 1]; // '14:30'

type HistoryResult =
  | { refined: RefinedStock[] }
  | { message: string };

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** 쌍끌이 순매수 순위 (과거) */
  async getTotalBuyHistory(date: string): Promise<HistoryResult> {
    return this.getBuyHistoryByType('total', date);
  }

  /** 기관 순매수 순위 (과거) */
  async getInstitutionBuyHistory(date: string): Promise<HistoryResult> {
    return this.getBuyHistoryByType('institution', date);
  }

  /** 외국인 순매수 순위 (과거) */
  async getForeignBuyHistory(date: string): Promise<HistoryResult> {
    return this.getBuyHistoryByType('foreign', date);
  }

  private async getBuyHistoryByType(
    type: BuyHistoryType,
    date: string,
  ): Promise<HistoryResult> {
    this.logger.log(`getBuyHistoryByType: ${type} date=${date}`);

    const dateStr = this.normalizeDate(date);
    if (!dateStr) {
      return { message: '날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 또는 YYYYMMDD)' };
    }

    const todayStr = dayjs().format('YYYYMMDD');
    const slot =
      dateStr === todayStr
        ? getSlotAndDateForCache(dayjs()).slot
        : LAST_SLOT;

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

  /** YYYY-MM-DD 또는 YYYYMMDD → YYYYMMDD */
  private normalizeDate(date: string): string | null {
    if (!date || typeof date !== 'string') return null;
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed.replace(/-/g, '');
    }
    if (/^\d{8}$/.test(trimmed)) {
      return trimmed;
    }
    return null;
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
