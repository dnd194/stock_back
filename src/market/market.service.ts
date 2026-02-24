import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { KisService } from '../kis/kis.service';
import { InvestorStock } from './market.types';
import { Redis } from 'ioredis';
import dayjs from 'dayjs';
import { ConfigService } from '@nestjs/config';
import {
  MARKET_SUPPLY_SLOTS,
  MARKET_SUPPLY_REDIS_KEY,
  MARKET_SUPPLY_TTL_SECONDS,
  MARKET_CLOSE_TIME,
} from '../config/market.config';

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
      throw new BadRequestException('KIS 설정이 없습니다. KIS_APP_KEY, KIS_APP_SECRET을 확인하세요.');
    }

    const now = dayjs();
    const dateStr = now.format('YYYYMMDD');
    const currentTime = now.format('HH:mm');

    // 1. 전체('0') 데이터를 위한 통합 시간표
    // 외국인이 09:30에 먼저 나오고, 기관이 10:00에 합류하므로 두 시점 모두 슬롯으로 잡습니다.

    // 2. 현재 시간 기준으로 유효한 '최신 슬롯' 찾기
    const lastUpdateSlot = MARKET_SUPPLY_SLOTS.filter((time) => currentTime >= time).pop();

    // 아직 첫 공시(09:30) 전이라면 전날 마지막 집계 데이터 조회
    if (!lastUpdateSlot) {
      const yesterday = now.subtract(1, 'day');
      const yesterdayDateStr = yesterday.format('YYYYMMDD');
      const lastSlotOfYesterday = MARKET_SUPPLY_SLOTS[MARKET_SUPPLY_SLOTS.length - 1]; // 마지막 슬롯 (14:30)
      const yesterdayCacheKey = MARKET_SUPPLY_REDIS_KEY(yesterdayDateStr, lastSlotOfYesterday);
      let yesterdayCached: string | null = null;
      try {
        yesterdayCached = await this.redis.get(yesterdayCacheKey);
      } catch (error) {
        this.logger.warn('전날 데이터 Redis 조회 실패', error);
      }

      if (yesterdayCached) {
        this.logger.log(`✅ 전날 마지막 집계 데이터 사용: ${yesterdayCacheKey}`);
        return JSON.parse(yesterdayCached);
      }

      this.logger.warn('장 시작 전이고 전날 데이터도 없음');
      return { message: '장 시작 전이거나 아직 첫 집계 전입니다. 전날 데이터도 없습니다.' };
    }

    // 3. Redis 키 확인 (예: supply:total:20260220:11:20)
    const cacheKey = MARKET_SUPPLY_REDIS_KEY(dateStr, lastUpdateSlot);
    let cached: string | null = null;
    try {
      cached = await this.redis.get(cacheKey);
    } catch (error) {
      this.logger.warn(`Redis 캐시 조회 실패: ${cacheKey}`, error);
    }

    if (cached) {
      this.logger.log(`✅ Redis 슬롯 ${cacheKey} 사용`);
      return JSON.parse(cached);
    }

    // 4. 장 마감 후에는 API 호출하지 않고 캐시만 사용 (당일 마지막 집계만 표시)
    if (currentTime > MARKET_CLOSE_TIME) {
      this.logger.log('장 마감 후 - API 호출하지 않음');
      return {
        message:
          '장 마감 후입니다. 당일 마지막 집계 데이터가 캐시에 없습니다.',
      };
    }

    // 5. Redis에 없으면 API 호출 (400 시 토큰 갱신 후 1회 재시도)
    this.logger.log(`API 호출 시작 (슬롯: ${lastUpdateSlot})`);
    const baseUrl = kisConfig.baseUrl ?? 'https://openapi.koreainvestment.com:9443';
    const doRequest = async (accessToken: string) =>
      axios.get<{ output?: InvestorStock[]; [key: string]: unknown }>(
        `${baseUrl}/uapi/domestic-stock/v1/quotations/foreign-institution-total`,
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            authorization: `Bearer ${accessToken}`,
            appkey: kisConfig.appKey,
            appsecret: kisConfig.appSecret,
            tr_id: 'FHPTJ04400000',
            custtype: 'P',
          },
          params: {
            FID_COND_MRKT_DIV_CODE: 'V',    // V(Default)
            FID_COND_SCR_DIV_CODE: '16449', // 16449(Default)
            FID_INPUT_ISCD: '0000',          // Default: 0000:전체, 0001:코스피, 1001:코스닥
            FID_DIV_CLS_CODE: '1',           // Default: 0: 수량정열, 1: 금액정열
            FID_RANK_SORT_CLS_CODE: '0',     // Default: 0: 순매수상위, 1: 순매도상위
            FID_ETC_CLS_CODE: '0',           // Default: 0:전체 1:외국인 2:기관계 3:기타
          },
        },
      );

    try {
      let token = await this.kisService.getAccessToken();
      let response: Awaited<ReturnType<typeof doRequest>>;
      try {
        response = await doRequest(token);
      } catch (firstError) {
        if (axios.isAxiosError(firstError) && firstError.response?.status === 400) {
          this.logger.warn('KIS API 500 (status : 400) - 캐시 토큰 만료, Redis 삭제 후 새 토큰으로 재시도');
          await this.kisService.clearCachedToken();
          token = await this.kisService.getAccessToken(true);
          response = await doRequest(token);
        } else {
          throw firstError;
        }
      }

      const apiData = response.data;
      if (!apiData || typeof apiData !== 'object') {
        throw new BadRequestException('KIS 시장 데이터 응답 형식이 올바르지 않습니다.');
      }

      // 6. 성공 시 Redis에 저장
      try {
        await this.redis.set(
          cacheKey,
          JSON.stringify(apiData),
          'EX',
          MARKET_SUPPLY_TTL_SECONDS,
        );
        this.logger.log(`✅ 데이터 Redis 저장 완료: ${cacheKey}`);
      } catch (error) {
        this.logger.warn('Redis 데이터 저장 실패 (데이터는 반환됨)', error);
      }

      return apiData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const msg = error.response?.data?.msg1 ?? error.message;
        if (status === 401) {
          this.logger.warn('KIS API 401 - Redis 토큰 삭제 (재시도 후에도 실패)');
          await this.kisService.clearCachedToken();
        }
        this.logger.error(`KIS 시장 데이터 조회 실패 (${status ?? 'network'}): ${msg}`);
        throw new BadRequestException(`KIS 시장 데이터 조회 실패 (${status ?? 'network'}): ${msg}`);
      }
      this.logger.error('시장 데이터 조회 중 예상치 못한 오류', error);
      throw error;
    }
  }

  /**
   * 쌍끌이: 외국인+기관 순매수 종목 정제.
   * 09:30 슬롯(기관 첫 집계 전)은 기관 데이터가 0이므로 외국인 순매수만 있어도 포함.
   * 10:00 이후 슬롯은 외국인·기관 모두 순매수인 종목만 포함.
   */
  getSsangkkeuli(data: InvestorStock[]) {
    const hasInstitutionData = data.some(
      (stock) => Number(stock.orgn_ntby_qty) !== 0,
    );
    const filterFn = hasInstitutionData
      ? (stock: InvestorStock) =>
          Number(stock.frgn_ntby_qty) > 0 && Number(stock.orgn_ntby_qty) > 0
      : (stock: InvestorStock) => Number(stock.frgn_ntby_qty) > 0;

    return data
      .filter(filterFn)
      .map((stock) => ({
        name: stock.hts_kor_isnm,
        code: stock.mksc_shrn_iscd,
        foreignQty: Number(stock.frgn_ntby_qty),
        institutionQty: Number(stock.orgn_ntby_qty),
        foreignAmount: Number(stock.frgn_ntby_tr_pbmn),
        institutionAmount: Number(stock.orgn_ntby_tr_pbmn),
        fundAmount: Number(stock.fund_ntby_tr_pbmn),
        totalAmount:
          Number(stock.frgn_ntby_tr_pbmn) + Number(stock.orgn_ntby_tr_pbmn),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }
}
