import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import dayjs from 'dayjs';
import { Redis } from 'ioredis';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import {
  MARKET_CLOSE_TIME,
  GEMINI_SUPPLY_REDIS_KEY,
  MARKET_SUPPLY_REDIS_KEY,
  MARKET_SUPPLY_SLOTS,
  TRADING_DATA_DB_KEY,
  getTTLUntilNext0759,
} from '../config/market.config';
import { getSlotAndDateForCache } from '../common/utils/market-slot.utils';
import { KisService } from '../kis/kis.service';
import { hasOutput, InvestorStock, RefinedStock } from './market.types';
import { buildSupplyAnalysisPrompt, type GeminiAnalysisType } from './market.prompts';

const KIS_API_PATH = '/uapi/domestic-stock/v1/quotations/foreign-institution-total';

const KIS_FOREIGN_INSTITUTION_PARAMS = {
  FID_COND_MRKT_DIV_CODE: 'V',
  FID_COND_SCR_DIV_CODE: '16449',
  FID_INPUT_ISCD: '0000',
  FID_DIV_CLS_CODE: '1',
  FID_RANK_SORT_CLS_CODE: '0',
  FID_ETC_CLS_CODE: '0',
} as const;

type RefinedWithGeminiResult = {
  refined: RefinedStock[];
  gemini: { text: string } | null;
  geminiPending?: boolean;
};

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  /** KIS API 단일 비행: 동일 cacheKey에 대한 동시 요청을 하나로 묶음 */
  private readonly supplyFetchPromises = new Map<string, Promise<unknown>>();

  /** Gemini 단일 비행: 동일 geminiKey에 대한 동시 호출을 하나로 묶음 */
  private readonly geminiFetchPromises = new Map<string, Promise<void>>();

  /** trading_data DB 저장 단일 비행: 동일 (type,date,slot)에 대한 동시 저장을 하나로 묶음 */
  private readonly tradingDataSavePromises = new Map<string, Promise<void>>();

  constructor(
    private readonly kisService: KisService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly configService: ConfigService,
  ) {}

  async getForeignInstitutionTotal() {
    this.logger.log('getForeignInstitutionTotal() 호출');

    const kisConfig = this.configService.get('kis');
    if (!kisConfig?.appKey || !kisConfig?.appSecret) {
      throw new BadRequestException(
        'KIS 설정이 없습니다. KIS_APP_KEY, KIS_APP_SECRET을 확인하세요.',
      );
    }

    const now = dayjs();
    const dateStr = now.format('YYYYMMDD');
    const currentTime = now.format('HH:mm');
    const lastUpdateSlot = MARKET_SUPPLY_SLOTS.filter(
      (time) => currentTime >= time,
    ).pop();

    // 첫 공시(08:00) 전 → 전날 마지막 집계 조회
    if (!lastUpdateSlot) {
      return this.resolveBeforeFirstSlot(now);
    }

    // 당일 슬롯 캐시 조회
    const cacheKey = MARKET_SUPPLY_REDIS_KEY(dateStr, lastUpdateSlot);
    const cached = await this.getCached(cacheKey);
    if (cached) {
      this.logger.log(`Redis 캐시 사용: ${cacheKey}`);
      return JSON.parse(cached);
    }

    // 장 마감 후 → API 호출 없이 캐시만 사용
    if (currentTime > MARKET_CLOSE_TIME) {
      this.logger.log('장 마감 후 - API 미호출');
      return {
        message:
          '장 마감 후입니다. 당일 마지막 집계 데이터가 캐시에 없습니다.',
      };
    }

    // API 호출 (단일 비행으로 동시 요청 coalesce)
    return this.coalesceSupplyFetch(cacheKey, () =>
      this.fetchAndCacheSupplyData(kisConfig, now, cacheKey, lastUpdateSlot),
    );
  }

  /** 동일 cacheKey에 대한 동시 요청을 하나로 묶어 cache stampede 방지 */
  private async coalesceSupplyFetch<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const existing = this.supplyFetchPromises.get(key);
    if (existing) {
      this.logger.log(`KIS 단일 비행 대기: ${key}`);
      return existing as Promise<T>;
    }
    const promise = fn().finally(() => {
      this.supplyFetchPromises.delete(key);
    });
    this.supplyFetchPromises.set(key, promise);
    return promise as Promise<T>;
  }

  private async resolveBeforeFirstSlot(now: dayjs.Dayjs) {
    const yesterday = now.subtract(1, 'day');
    const yesterdayStr = yesterday.format('YYYYMMDD');
    const lastSlot = MARKET_SUPPLY_SLOTS[MARKET_SUPPLY_SLOTS.length - 1];
    const key = MARKET_SUPPLY_REDIS_KEY(yesterdayStr, lastSlot);

    const cached = await this.getCached(key);
    if (cached) {
      this.logger.log(`전날 마지막 집계 사용: ${key}`);
      return JSON.parse(cached);
    }

    this.logger.warn('장 시작 전이고 전날 데이터 없음');
    return {
      message: '장 시작 전이거나 아직 첫 집계 전입니다. 전날 데이터도 없습니다.',
    };
  }

  private async getCached(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.warn(`Redis 조회 실패: ${key}`, error);
      return null;
    }
  }

  private async fetchAndCacheSupplyData(
    kisConfig: { appKey: string; appSecret: string; baseUrl?: string },
    now: dayjs.Dayjs,
    cacheKey: string,
    slot: string,
  ) {
    this.logger.log(`API 호출 (슬롯: ${slot})`);

    const baseUrl =
      kisConfig.baseUrl ?? 'https://openapi.koreainvestment.com:9443';
    const url = `${baseUrl}${KIS_API_PATH}`;

    const doRequest = (token: string) =>
      axios.get<{ output?: InvestorStock[]; [key: string]: unknown }>(url, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          authorization: `Bearer ${token}`,
          appkey: kisConfig.appKey,
          appsecret: kisConfig.appSecret,
          tr_id: 'FHPTJ04400000',
          custtype: 'P',
        },
        params: KIS_FOREIGN_INSTITUTION_PARAMS,
      });

    try {
      let token = await this.kisService.getAccessToken();
      let response: Awaited<ReturnType<typeof doRequest>>;

      try {
        response = await doRequest(token);
      } catch (firstError) {
        const is400 =
          axios.isAxiosError(firstError) &&
          firstError.response?.status === 400;
        if (!is400) throw firstError;

        this.logger.warn('KIS 400 - 토큰 갱신 후 재시도');
        await this.kisService.clearCachedToken();
        token = await this.kisService.getAccessToken(true);
        response = await doRequest(token);
      }

      const apiData = response.data;
      if (!apiData || typeof apiData !== 'object') {
        throw new BadRequestException(
          'KIS 시장 데이터 응답 형식이 올바르지 않습니다.',
        );
      }

      const ttl = getTTLUntilNext0759(now);
      try {
        await this.redis.set(cacheKey, JSON.stringify(apiData), 'EX', ttl);
        this.logger.log(`Redis 저장: ${cacheKey} (TTL: ${ttl}s)`);
      } catch (error) {
        this.logger.warn('Redis 저장 실패 (데이터는 반환)', error);
      }

      return apiData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const msg = error.response?.data?.msg1 ?? error.message;
        if (status === 400) {
          await this.kisService.clearCachedToken();
        }
        this.logger.error(`KIS 시장 데이터 조회 실패 (${status ?? 'network'}): ${msg}`);
        throw new BadRequestException(
          `KIS 시장 데이터 조회 실패 (${status ?? 'network'}): ${msg}`,
        );
      }
      this.logger.error('시장 데이터 조회 중 오류', error);
      throw error;
    }
  }

  /**
   * refined 가공 후, Gemini 캐시가 있으면 함께 반환.
   * 캐시가 없으면 refined만 즉시 반환하고, Gemini는 백그라운드에서 호출해 Redis에 저장.
   */
  async getRefinedWithGemini(): Promise<RefinedWithGeminiResult | { message: string }> {
    return this.getRefinedWithGeminiForType('total');
  }

  /** 기관 순매수 + Gemini (refined와 동일한 방식) */
  async getRefinedInstitutionWithGemini(): Promise<RefinedWithGeminiResult | { message: string }> {
    return this.getRefinedWithGeminiForType('institution');
  }

  /** 외국인 순매수 + Gemini (refined와 동일한 방식) */
  async getRefinedForeignWithGemini(): Promise<RefinedWithGeminiResult | { message: string }> {
    return this.getRefinedWithGeminiForType('foreign');
  }

  private async getRefinedWithGeminiForType(
    type: GeminiAnalysisType,
  ): Promise<RefinedWithGeminiResult | { message: string }> {
    const raw = await this.getForeignInstitutionTotal();
    if (!hasOutput(raw)) {
      return {
        message: (raw as { message?: string }).message ?? '데이터를 찾을 수 없습니다.',
      };
    }

    const now = dayjs();
    const { dateStr, slot } = getSlotAndDateForCache(now);
    const refined = this.getRefinedByType(raw.output, type, dateStr, slot);
    const geminiKey = GEMINI_SUPPLY_REDIS_KEY(dateStr, slot, type);

    const cached = await this.getCached(geminiKey);
    if (cached) {
      this.logger.log(`Gemini 캐시 사용: ${geminiKey}`);
      return JSON.parse(cached);
    }

    const geminiConfig = this.configService.get<{ apiKey?: string; model?: string }>('gemini');
    if (geminiConfig?.apiKey) {
      this.fillGeminiCacheInBackground(geminiKey, {
        apiKey: geminiConfig.apiKey,
        model: geminiConfig.model,
      }, refined, now, type);
    }

    return { refined, gemini: null, geminiPending: !!geminiConfig?.apiKey };
  }

  private getRefinedByType(
    data: InvestorStock[],
    type: GeminiAnalysisType,
    dateStr: string,
    slot: string,
  ): RefinedStock[] {
    const full = this.getRefinedFullByType(data, type);
    const dbKey = TRADING_DATA_DB_KEY(type, dateStr, slot);
    this.coalesceTradingDataSave(dbKey, () =>
      this.saveTradingDataToDb(full, type, dateStr, slot),
    ).catch((err) => this.logger.warn('trading_data 저장 실패', err));
    return full.slice(0, 10);
  }

  /** 동일 (type,date,slot)에 대한 동시 DB 저장을 하나로 묶어 스탬피드 방지 */
  private async coalesceTradingDataSave(
    key: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const existing = this.tradingDataSavePromises.get(key);
    if (existing) {
      this.logger.log(`trading_data 단일 비행 대기: ${key}`);
      return existing;
    }
    const promise = fn().finally(() => {
      this.tradingDataSavePromises.delete(key);
    });
    this.tradingDataSavePromises.set(key, promise);
    return promise;
  }

  private getRefinedFullByType(
    data: InvestorStock[],
    type: GeminiAnalysisType,
  ): RefinedStock[] {
    switch (type) {
      case 'total':
        return this.getSsangkkeuli(data);
      case 'institution':
        return this.getInstitutionNetBuy(data);
      case 'foreign':
        return this.getForeignNetBuy(data);
    }
  }

  private async saveTradingDataToDb(
    fullData: RefinedStock[],
    type: GeminiAnalysisType,
    dateStr: string,
    slot: string,
  ): Promise<void> {
    const { data: existing } = await this.supabase
      .from('trading_data')
      .select('id')
      .eq('type', type)
      .eq('date', dateStr)
      .eq('slot', slot)
      .limit(1);

    if (existing && existing.length > 0) {
      this.logger.log(`trading_data 이미 존재, 스킵: ${type} ${dateStr} ${slot}`);
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

    const { error } = await this.supabase.from('trading_data').insert(rows);
    if (error) throw error;
    this.logger.log(`trading_data 저장: ${type} ${dateStr} ${slot} (${rows.length}건)`);
  }

  /** 백그라운드에서 Gemini 호출 후 Redis 저장. 단일 비행으로 동시 호출 coalesce */
  private fillGeminiCacheInBackground(
    geminiKey: string,
    config: { apiKey: string; model?: string },
    refined: RefinedStock[],
    now: dayjs.Dayjs,
    type: GeminiAnalysisType,
  ): void {
    if (this.geminiFetchPromises.has(geminiKey)) {
      this.logger.log(`Gemini 단일 비행 대기 중: ${geminiKey}`);
      return;
    }
    const promise = this.callGemini(
      { apiKey: config.apiKey, model: config.model },
      refined,
      type,
    )
      .then((text) => {
        const payload = { refined, gemini: { text } };
        const ttl = getTTLUntilNext0759(now);
        return this.redis.set(geminiKey, JSON.stringify(payload), 'EX', ttl);
      })
      .then(() => this.logger.log(`Gemini 백그라운드 저장 완료: ${geminiKey}`))
      .catch((error) => this.logger.warn('Gemini 백그라운드 저장 실패', error))
      .finally(() => {
        this.geminiFetchPromises.delete(geminiKey);
      }) as Promise<void>;
    this.geminiFetchPromises.set(geminiKey, promise);
  }

  private async callGemini(
    config: { apiKey: string; model?: string },
    refined: RefinedStock[],
    type: GeminiAnalysisType,
  ): Promise<string> {
    this.logger.log(`Gemini 호출: type=${type}, 종목수=${refined.length}`);
    const model = config.model ?? 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const prompt = buildSupplyAnalysisPrompt(refined, type);

    const { data } = await axios.post<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(url, {
      contents: [{ parts: [{ text: prompt }] }],
    });

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text == null) {
      throw new BadRequestException('Gemini 응답 형식이 올바르지 않습니다.');
    }
    return text;
  }

  /** 공통 매핑: InvestorStock → RefinedStock */
  private toRefinedStock(s: InvestorStock): RefinedStock {
    return {
      name: s.hts_kor_isnm,
      code: s.mksc_shrn_iscd,
      foreignQty: Number(s.frgn_ntby_qty),
      institutionQty: Number(s.orgn_ntby_qty),
      foreignAmount: Number(s.frgn_ntby_tr_pbmn),
      institutionAmount: Number(s.orgn_ntby_tr_pbmn),
      fundAmount: Number(s.fund_ntby_tr_pbmn),
      totalAmount: Number(s.frgn_ntby_tr_pbmn) + Number(s.orgn_ntby_tr_pbmn),
    };
  }

  /**
   * 쌍끌이: 외국인·기관 순매수 종목 정제.
   * 09:30(기관 미집계)은 외국인 순매수만 있어도 포함, 10:00 이후는 둘 다 순매수만.
   */
  getSsangkkeuli(data: InvestorStock[]): RefinedStock[] {
    const hasInstitution = data.some((s) => Number(s.orgn_ntby_qty) !== 0);
    const includeStock = hasInstitution
      ? (s: InvestorStock) =>
          Number(s.frgn_ntby_qty) > 0 && Number(s.orgn_ntby_qty) > 0
      : (s: InvestorStock) => Number(s.frgn_ntby_qty) > 0;

    return data
      .filter(includeStock)
      .map((s) => this.toRefinedStock(s))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  /** 기관 순매수 (slice는 getRefinedByType에서 처리) */
  getInstitutionNetBuy(data: InvestorStock[]): RefinedStock[] {
    return data
      .filter((s) => Number(s.orgn_ntby_qty) > 0)
      .map((s) => this.toRefinedStock(s))
      .sort((a, b) => b.institutionAmount - a.institutionAmount);
  }

  /** 외국인 순매수 (slice는 getRefinedByType에서 처리) */
  getForeignNetBuy(data: InvestorStock[]): RefinedStock[] {
    return data
      .filter((s) => Number(s.frgn_ntby_qty) > 0)
      .map((s) => this.toRefinedStock(s))
      .sort((a, b) => b.foreignAmount - a.foreignAmount);
  }

}
