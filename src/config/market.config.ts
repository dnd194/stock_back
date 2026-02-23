// src/config/market.config.ts
export const MARKET_SUPPLY_SLOTS = ['09:30', '10:00', '11:20', '13:20', '14:30'] as const;

/** 장 마감 시간. 이 후에는 당일 마지막 집계만 캐시에서 조회하고 API 호출 안 함 */
export const MARKET_CLOSE_TIME = '15:30';

export const MARKET_SUPPLY_REDIS_KEY = (date: string, slot: string) =>
  `supply:total:${date}:${slot}`;

export const MARKET_SUPPLY_TTL_SECONDS = 36000; // 10시간