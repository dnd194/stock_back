const ANALYSIS_RULES = `# 📋 분석 지침 (Strict Rules)
1. 데이터 그룹화: 제공된 수급 TOP 10 종목을 반드시 '섹터(산업)'별로 묶어서 정리하세요.
2. 아이콘 활용: 각 항목의 성격에 맞는 이모지를 적시적소에 사용하여 시각적 가독성을 높이세요.
3. 분석 톤: 전문적이면서도 핵심을 찌르는 간결한 문체를 사용하세요.
4. 양식 준수: 반드시 아래 제공된 [수급 브리핑 양식] 구조를 엄격히 유지하세요.

---

## 🕒 [오늘의 수급 섹터별 그룹 브리핑]

### 📂 [섹터명] ([종목수]개)
> **🔥 수급 강도:** [매우강함 / 강함 / 보통]
> - 🏢 **종목:** \`종목명1\`, \`종목명2\`
> - 📊 **수급 동향:** (외인/기관의 매수 집중도 및 쌍끌이 여부 분석)
> - 💡 **인사이트:** (돈이 몰리는 이유와 시장의 핵심 테마 해석)

/* 섹터가 더 있을 경우 위 형식을 반복하세요 */

---

**"본 요약 데이터는 참고용이며, 최종 책임은 투자자 본인에게 있습니다."**
`;

/** 쌍끌이(외국인·기관 동시 순매수) 분석 프롬프트 */
export const GEMINI_SUPPLY_ANALYSIS_PROMPT = `아래는 오늘 외국인·기관 동시 순매수 상위 10종목입니다. 제공된 데이터를 바탕으로 아래 [출력 양식]에 맞춰 분석 보고서를 작성하세요.

${ANALYSIS_RULES}
`;

/** 기관 순매수 분석 프롬프트 */
export const GEMINI_INSTITUTION_ANALYSIS_PROMPT = `아래는 오늘 기관 순매수 상위 10종목입니다. 제공된 데이터를 바탕으로 아래 [출력 양식]에 맞춰 분석 보고서를 작성하세요. (기관 매수 동향에 집중하여 분석하세요.)

${ANALYSIS_RULES}
`;

/** 외국인 순매수 분석 프롬프트 */
export const GEMINI_FOREIGN_ANALYSIS_PROMPT = `아래는 오늘 외국인 순매수 상위 10종목입니다. 제공된 데이터를 바탕으로 아래 [출력 양식]에 맞춰 분석 보고서를 작성하세요. (외국인 매수 동향에 집중하여 분석하세요.)

${ANALYSIS_RULES}
`;

export type GeminiAnalysisType = 'ssangkkeuli' | 'institution' | 'foreign';

const PROMPT_BY_TYPE: Record<GeminiAnalysisType, string> = {
  ssangkkeuli: GEMINI_SUPPLY_ANALYSIS_PROMPT,
  institution: GEMINI_INSTITUTION_ANALYSIS_PROMPT,
  foreign: GEMINI_FOREIGN_ANALYSIS_PROMPT,
};

export function buildSupplyAnalysisPrompt(
  refinedData: unknown,
  type: GeminiAnalysisType = 'ssangkkeuli',
): string {
  return PROMPT_BY_TYPE[type] + '\n\n[제공 데이터]\n' + JSON.stringify(refinedData, null, 2);
}
