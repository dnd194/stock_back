export interface InvestorStock {
  hts_kor_isnm: string;
  mksc_shrn_iscd: string;
  frgn_ntby_qty: string;
  orgn_ntby_qty: string;
  frgn_ntby_tr_pbmn: string;
  orgn_ntby_tr_pbmn: string;
  fund_ntby_tr_pbmn: string;
}

/** 정제된 수급 데이터 (refined/institution/foreign 공통 형식) */
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

/** KIS 외국인/기관 집계 API 성공 응답 */
export interface ForeignInstitutionTotalSuccess {
  output: InvestorStock[];
  [key: string]: unknown;
}

/** 메시지만 있는 응답 (데이터 없음) */
export interface ForeignInstitutionMessageResponse {
  message: string;
}

/** 응답에 output 배열이 있는지 검사 (타입 가드 + 런타임 검증) */
export function hasOutput(
  data: ForeignInstitutionTotalSuccess | ForeignInstitutionMessageResponse | Record<string, unknown>,
): data is ForeignInstitutionTotalSuccess {
  if (!data || typeof data !== 'object') return false;
  const output = (data as Record<string, unknown>).output;
  return Array.isArray(output);
}
