/** Supabase trading_data 테이블 행 (snake_case) */
export interface TradingDataRow {
  id: string;
  created_at: string;
  type: 'total' | 'institution' | 'foreign';
  date: string;
  slot: string;
  rank: number;
  name: string;
  code: string;
  foreign_qty: number;
  institution_qty: number;
  foreign_amount: number;
  institution_amount: number;
  fund_amount: number;
  total_amount: number;
}

/** 정제된 수급 데이터 (market.types RefinedStock와 동일 형식) */
export interface RefinedStock {
  name: string;
  code: string;
  foreignQty: number;
  institutionQty: number;
  foreignAmount: number;
  institutionAmount: number;
  fundAmount: number;
  totalAmount: number;
}

export type RankType = 'total' | 'institution' | 'foreign';
