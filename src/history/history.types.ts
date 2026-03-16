/** 정제된 수급 데이터 (rank.types RefinedStock와 동일 형식) */
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

export type BuyHistoryType = 'total' | 'institution' | 'foreign';
