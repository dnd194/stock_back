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
import {
  MARKET_CLOSE_TIME,
  GEMINI_SUPPLY_REDIS_KEY,
  MARKET_SUPPLY_REDIS_KEY,
  MARKET_SUPPLY_SLOTS,
  getTTLUntilNext0759,
} from '../config/market.config';
import { KisService } from '../kis/kis.service';
import { hasOutput } from './market.types';
import { InvestorStock } from './market.types';
import { buildSupplyAnalysisPrompt } from './market.prompts';

const KIS_API_PATH = '/uapi/domestic-stock/v1/quotations/foreign-institution-total';

const KIS_FOREIGN_INSTITUTION_PARAMS = {
  FID_COND_MRKT_DIV_CODE: 'V',
  FID_COND_SCR_DIV_CODE: '16449',
  FID_INPUT_ISCD: '0000',
  FID_DIV_CLS_CODE: '1',
  FID_RANK_SORT_CLS_CODE: '0',
  FID_ETC_CLS_CODE: '0',
} as const;

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private readonly kisService: KisService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
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

    // API 호출 (400 시 토큰 갱신 후 1회 재시도)
    return this.fetchAndCacheSupplyData(kisConfig, now, cacheKey, lastUpdateSlot);
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
   * getSsangkkeuli로 가공 후, Gemini 캐시가 있으면 함께 반환.
   * 캐시가 없으면 refined만 즉시 반환하고, Gemini는 백그라운드에서 호출해 Redis에 저장(다음 요청부터 캐시 hit).
   */
  async getRefinedWithGemini(): Promise<
    | {
        refined: ReturnType<MarketService['getSsangkkeuli']>;
        gemini: { text: string } | null;
        /** true면 백그라운드에서 요약 생성 중. 잠시 후 같은 API 재호출하면 gemini가 채워짐 */
        geminiPending?: boolean;
      }
    | { message: string }
  > {
    const raw = await this.getForeignInstitutionTotal();
    if (!hasOutput(raw)) {
      return {
        message: (raw as { message?: string }).message ?? '데이터를 찾을 수 없습니다.',
      };
    }

    const refined = this.getSsangkkeuli(raw.output);
    const now = dayjs();
    const { dateStr, slot } = this.getSlotAndDateForCache(now);
    const geminiKey = GEMINI_SUPPLY_REDIS_KEY(dateStr, slot);

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
      }, refined, now);
    }

    return { refined, gemini: null, geminiPending: !!geminiConfig?.apiKey };
  }

  /** 백그라운드에서 Gemini 호출 후 Redis 저장. 응답 대기 없이 호출 */
  private fillGeminiCacheInBackground(
    geminiKey: string,
    config: { apiKey: string; model?: string },
    refined: ReturnType<MarketService['getSsangkkeuli']>,
    now: dayjs.Dayjs,
  ): void {
    this.callGemini({ apiKey: config.apiKey, model: config.model }, refined)
      .then((text) => {
        const payload = { refined, gemini: { text } };
        const ttl = getTTLUntilNext0759(now);
        return this.redis.set(geminiKey, JSON.stringify(payload), 'EX', ttl);
      })
      .then(() => this.logger.log(`Gemini 백그라운드 저장 완료: ${geminiKey}`))
      .catch((error) => this.logger.warn('Gemini 백그라운드 저장 실패', error));
  }

  /** 캐시 키용 날짜·슬롯 (당일 유효 슬롯 또는 전날 마지막 슬롯) */
  private getSlotAndDateForCache(now: dayjs.Dayjs): { dateStr: string; slot: string } {
    const currentTime = now.format('HH:mm');
    const lastSlot = MARKET_SUPPLY_SLOTS.filter((time) => currentTime >= time).pop();
    if (lastSlot) {
      return { dateStr: now.format('YYYYMMDD'), slot: lastSlot };
    }
    const yesterday = now.subtract(1, 'day');
    const lastSlotOfDay = MARKET_SUPPLY_SLOTS[MARKET_SUPPLY_SLOTS.length - 1];
    return { dateStr: yesterday.format('YYYYMMDD'), slot: lastSlotOfDay };
  }

  private async callGemini(
    config: { apiKey: string; model?: string },
    refined: ReturnType<MarketService['getSsangkkeuli']>,
  ): Promise<string> {
    const model = config.model ?? 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const prompt = buildSupplyAnalysisPrompt(refined);

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

  /**
   * 쌍끌이: 외국인·기관 순매수 종목 정제.
   * 09:30(기관 미집계)은 외국인 순매수만 있어도 포함, 10:00 이후는 둘 다 순매수만.
   */
  getSsangkkeuli(data: InvestorStock[]) {
    const hasInstitution = data.some(
      (s) => Number(s.orgn_ntby_qty) !== 0,
    );
    const includeStock = hasInstitution
      ? (s: InvestorStock) =>
          Number(s.frgn_ntby_qty) > 0 && Number(s.orgn_ntby_qty) > 0
      : (s: InvestorStock) => Number(s.frgn_ntby_qty) > 0;

    return data
      .filter(includeStock)
      .map((s) => ({
        name: s.hts_kor_isnm,
        code: s.mksc_shrn_iscd,
        foreignQty: Number(s.frgn_ntby_qty),
        institutionQty: Number(s.orgn_ntby_qty),
        foreignAmount: Number(s.frgn_ntby_tr_pbmn),
        institutionAmount: Number(s.orgn_ntby_tr_pbmn),
        fundAmount: Number(s.fund_ntby_tr_pbmn),
        totalAmount:
          Number(s.frgn_ntby_tr_pbmn) + Number(s.orgn_ntby_tr_pbmn),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }
}
