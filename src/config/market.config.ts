import dayjs, { Dayjs } from 'dayjs';

export const MARKET_SUPPLY_SLOTS = [
  '09:30',
  '10:00',
  '11:20',
  '13:20',
  '14:30',
] as const;

/**
 * 순매도 배치 보충 실행 시간 (월~금)
 * 해당 슬롯 데이터가 DB에 없을 때만 API 호출 후 저장
 */
export const SUPPLY_SELL_FALLBACK_RUN_AT = [
  { runAt: '09:40', slot: '09:30' },
  { runAt: '10:10', slot: '10:00' },
  { runAt: '11:30', slot: '11:20' },
  { runAt: '13:20', slot: '13:20' },
  { runAt: '14:40', slot: '14:30' },
] as const;

/** 일별 마감 집계 슬롯 (연속 순매수 등 DB 일별 분석용) */
export const MARKET_DAILY_CLOSE_SLOT =
  MARKET_SUPPLY_SLOTS[MARKET_SUPPLY_SLOTS.length - 1];

/** 연속 순매수 분석: 당일 포함 과거 캘린더 일수 */
export const NET_BUY_STREAK_LOOKBACK_DAYS = 7;

/** 기관 첫 집계 시각. 09:30에는 orgn_ntby_qty가 0이라 외국인만 필터 */
export const INSTITUTION_FIRST_SLOT = '10:00';

/** 장 마감. 이후에는 당일 마지막 집계만 캐시에서 조회, API 미호출 */
export const MARKET_CLOSE_TIME = '15:30';

export const MARKET_SUPPLY_REDIS_KEY = (date: string, slot: string) =>
  `supply:total:${date}:${slot}`;

/** trading_data DB type (Supabase CHECK 제약과 일치) */
export type TradingDataType = 'total' | 'institution' | 'foreign';

/** trading_data DB 저장 coalesce 키 (스탬피드 방지) */
export const TRADING_DATA_DB_KEY = (
  type: TradingDataType,
  date: string,
  slot: string,
) => `trading_data:${type}:${date}:${slot}`;

/** Gemini 가공 응답 캐시 키 (type별 분리, TTL은 getTTLUntilNext0759 동일) */
export const GEMINI_SUPPLY_REDIS_KEY = (
  date: string,
  slot: string,
  type: TradingDataType,
) => `supply:gemini:${type}:${date}:${slot}`;

/**
 * 캐시 만료 시각: 다음 07:59 (오늘 07:59 전이면 오늘, 지났으면 내일).
 * 장 마감 후 ~ 다음날 장 시작 전까지 마지막 집계 유지용.
 */
export function getTTLUntilNext0759(from: Dayjs = dayjs()): number {
  const today0759 = from
    .startOf('day')
    .hour(7)
    .minute(59)
    .second(0)
    .millisecond(0);
  const target = from.isBefore(today0759) ? today0759 : today0759.add(1, 'day');
  return Math.max(60, target.diff(from, 'second'));
}
