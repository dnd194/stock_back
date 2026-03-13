import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import dayjs from 'dayjs';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { KisService } from '../kis/kis.service';
import { InvestorStock } from '../market/market.types';

type TradingDataSellType = 'total' | 'institution' | 'foreign';

const KIS_API_PATH = '/uapi/domestic-stock/v1/quotations/foreign-institution-total';

/** 순매도 API params (FID_RANK_SORT_CLS_CODE: 1) */
const KIS_NET_SELL_PARAMS = {
  FID_COND_MRKT_DIV_CODE: 'V',
  FID_COND_SCR_DIV_CODE: '16449',
  FID_INPUT_ISCD: '0000',
  FID_DIV_CLS_CODE: '1',
  FID_RANK_SORT_CLS_CODE: '1',
  FID_ETC_CLS_CODE: '0',
} as const;

const TRADING_DATA_SELL_TABLE = 'trading_data_sell';

@Injectable()
export class SupplySellBatch {
  private readonly logger = new Logger(SupplySellBatch.name);

  constructor(
    private readonly kisService: KisService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly configService: ConfigService,
  ) {}

  /** 기본: MARKET_SUPPLY_SLOTS 시간에 실행 (09:30, 10:00, 11:20, 13:20, 14:30) */
  @Cron('30 9 * * 1-5', { timeZone: 'Asia/Seoul' })
  async primary0930(): Promise<void> {
    await this.runPrimary('09:30');
  }

  @Cron('0 10 * * 1-5', { timeZone: 'Asia/Seoul' })
  async primary1000(): Promise<void> {
    await this.runPrimary('10:00');
  }

  @Cron('20 11 * * 1-5', { timeZone: 'Asia/Seoul' })
  async primary1120(): Promise<void> {
    await this.runPrimary('11:20');
  }

  @Cron('20 13 * * 1-5', { timeZone: 'Asia/Seoul' })
  async primary1320(): Promise<void> {
    await this.runPrimary('13:20');
  }

  @Cron('30 14 * * 1-5', { timeZone: 'Asia/Seoul' })
  async primary1430(): Promise<void> {
    await this.runPrimary('14:30');
  }

  /** 보충: DB에 데이터 없을 때만 실행 (09:40, 10:10, 11:30, 13:20, 14:40) */
  @Cron('40 9 * * 1-5', { timeZone: 'Asia/Seoul' })
  async fallback0940(): Promise<void> {
    await this.runFallback('09:30');
  }

  @Cron('10 10 * * 1-5', { timeZone: 'Asia/Seoul' })
  async fallback1010(): Promise<void> {
    await this.runFallback('10:00');
  }

  @Cron('30 11 * * 1-5', { timeZone: 'Asia/Seoul' })
  async fallback1130(): Promise<void> {
    await this.runFallback('11:20');
  }

  @Cron('20 13 * * 1-5', { timeZone: 'Asia/Seoul' })
  async fallback1320(): Promise<void> {
    await this.runFallback('13:20');
  }

  @Cron('40 14 * * 1-5', { timeZone: 'Asia/Seoul' })
  async fallback1440(): Promise<void> {
    await this.runFallback('14:30');
  }

  /** 기본: 슬롯 시간에 무조건 API 호출 후 저장 */
  private async runPrimary(slot: string): Promise<void> {
    this.logger.log(`순매도 배치(기본): slot=${slot}`);
    await this.fetchAndSave(slot);
  }

  /** 보충: DB에 데이터 없을 때만 API 호출 후 저장 */
  private async runFallback(slot: string): Promise<void> {
    const dateStr = dayjs().format('YYYY-MM-DD');
    const hasData = await this.checkDataExists(dateStr, slot);
    if (hasData) {
      this.logger.log(
        `순매도 배치(보충) 스킵 - 이미 존재: ${dateStr} ${slot}`,
      );
      return;
    }
    this.logger.log(`순매도 배치(보충): slot=${slot} 데이터 없음 → 저장`);
    await this.fetchAndSave(slot);
  }

  private async fetchAndSave(slot: string): Promise<void> {
    const kisConfig = this.configService.get<{
      appKey?: string;
      appSecret?: string;
      baseUrl?: string;
    }>('kis');
    if (!kisConfig?.appKey || !kisConfig?.appSecret) {
      this.logger.warn('KIS 설정 없음 - 순매도 배치 스킵');
      return;
    }

    const dateStr = dayjs().format('YYYY-MM-DD');

    try {
      const apiData = await this.fetchFromApi({
        appKey: kisConfig.appKey,
        appSecret: kisConfig.appSecret,
        baseUrl: kisConfig.baseUrl,
      });

      if (!apiData?.output || !Array.isArray(apiData.output)) {
        this.logger.warn('순매도 API 응답 데이터 없음');
        return;
      }

      const types: TradingDataSellType[] = ['total', 'institution', 'foreign'];
      for (const type of types) {
        const full = this.getRefinedSellByType(apiData.output, type);
        await this.saveToDb(full, type, dateStr, slot);
      }

      this.logger.log(`순매도 배치 완료: ${dateStr} ${slot}`);
    } catch (error) {
      this.logger.error(`순매도 배치 실패 (slot=${slot})`, error);
    }
  }

  private async checkDataExists(
    dateStr: string,
    slot: string,
  ): Promise<boolean> {
    const { data } = await this.supabase
      .from(TRADING_DATA_SELL_TABLE)
      .select('id')
      .eq('type', 'total')
      .eq('date', dateStr)
      .eq('slot', slot)
      .limit(1);
    return !!(data && data.length > 0);
  }

  private async fetchFromApi(kis: {
    appKey: string;
    appSecret: string;
    baseUrl?: string;
  }): Promise<{ output?: InvestorStock[] }> {
    const baseUrl = kis.baseUrl ?? 'https://openapi.koreainvestment.com:9443';
    const url = `${baseUrl}${KIS_API_PATH}`;

    const doRequest = (token: string) =>
      axios.get<{ output?: InvestorStock[] }>(url, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          authorization: `Bearer ${token}`,
          appkey: kis.appKey,
          appsecret: kis.appSecret,
          tr_id: 'FHPTJ04400000',
          custtype: 'P',
        },
        params: KIS_NET_SELL_PARAMS,
      });

    let token = await this.kisService.getAccessToken();
    let response: Awaited<ReturnType<typeof doRequest>>;

    try {
      response = await doRequest(token);
    } catch (firstError) {
      if (
        axios.isAxiosError(firstError) &&
        firstError.response?.status === 400
      ) {
        this.logger.warn('KIS 400 - 토큰 갱신 후 재시도');
        await this.kisService.clearCachedToken();
        token = await this.kisService.getAccessToken(true);
        response = await doRequest(token);
      } else {
        throw firstError;
      }
    }

    return response.data;
  }

  private getRefinedSellByType(
    data: InvestorStock[],
    type: TradingDataSellType,
  ): Array<{
    name: string;
    code: string;
    foreignQty: number;
    institutionQty: number;
    foreignAmount: number;
    institutionAmount: number;
    fundAmount: number;
    totalAmount: number;
  }> {
    const toRow = (s: InvestorStock) => ({
      name: s.hts_kor_isnm,
      code: s.mksc_shrn_iscd,
      foreignQty: Number(s.frgn_ntby_qty),
      institutionQty: Number(s.orgn_ntby_qty),
      foreignAmount: Number(s.frgn_ntby_tr_pbmn),
      institutionAmount: Number(s.orgn_ntby_tr_pbmn),
      fundAmount: Number(s.fund_ntby_tr_pbmn),
      totalAmount:
        Number(s.frgn_ntby_tr_pbmn) + Number(s.orgn_ntby_tr_pbmn),
    });

    switch (type) {
      case 'total': {
        const hasInstitution = data.some((s) => Number(s.orgn_ntby_qty) !== 0);
        const includeStock = hasInstitution
          ? (s: InvestorStock) =>
              Number(s.frgn_ntby_qty) < 0 && Number(s.orgn_ntby_qty) < 0
          : (s: InvestorStock) => Number(s.frgn_ntby_qty) < 0;
        return data
          .filter(includeStock)
          .map(toRow)
          .sort((a, b) => a.totalAmount - b.totalAmount);
      }
      case 'institution':
        return data
          .filter((s) => Number(s.orgn_ntby_qty) < 0)
          .map(toRow)
          .sort((a, b) => a.institutionAmount - b.institutionAmount);
      case 'foreign':
        return data
          .filter((s) => Number(s.frgn_ntby_qty) < 0)
          .map(toRow)
          .sort((a, b) => a.foreignAmount - b.foreignAmount);
    }
  }

  private async saveToDb(
    fullData: Array<{
      name: string;
      code: string;
      foreignQty: number;
      institutionQty: number;
      foreignAmount: number;
      institutionAmount: number;
      fundAmount: number;
      totalAmount: number;
    }>,
    type: TradingDataSellType,
    dateStr: string,
    slot: string,
  ): Promise<void> {
    const { data: existing } = await this.supabase
      .from(TRADING_DATA_SELL_TABLE)
      .select('id')
      .eq('type', type)
      .eq('date', dateStr)
      .eq('slot', slot)
      .limit(1);

    if (existing && existing.length > 0) {
      return;
    }

    const rows = fullData.map((s, idx) => ({
      type,
      date: dateStr,
      slot,
      rank: idx + 1,
      name: s.name,
      code: s.code,
      foreign_qty: s.foreignQty,
      institution_qty: s.institutionQty,
      foreign_amount: s.foreignAmount,
      institution_amount: s.institutionAmount,
      fund_amount: s.fundAmount,
      total_amount: s.totalAmount,
    }));

    const { error } = await this.supabase
      .from(TRADING_DATA_SELL_TABLE)
      .insert(rows);

    if (error) {
      this.logger.error(`trading_data_sell 저장 실패 (${type})`, error);
      return;
    }

    this.logger.log(
      `trading_data_sell 저장: ${type} ${dateStr} ${slot} (${rows.length}건)`,
    );
  }
}
