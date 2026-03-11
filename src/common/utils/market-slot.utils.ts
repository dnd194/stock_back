import dayjs, { Dayjs } from 'dayjs';
import { MARKET_SUPPLY_SLOTS } from '../../config/market.config';

/** 캐시 키용 날짜·슬롯 (당일 유효 슬롯 또는 전날 마지막 슬롯) */
export function getSlotAndDateForCache(now: Dayjs): { dateStr: string; slot: string } {
  const currentTime = now.format('HH:mm');
  const lastSlot = MARKET_SUPPLY_SLOTS.filter((time) => currentTime >= time).pop();
  if (lastSlot) {
    return { dateStr: now.format('YYYYMMDD'), slot: lastSlot };
  }
  const yesterday = now.subtract(1, 'day');
  const lastSlotOfDay = MARKET_SUPPLY_SLOTS[MARKET_SUPPLY_SLOTS.length - 1];
  return { dateStr: yesterday.format('YYYYMMDD'), slot: lastSlotOfDay };
}
