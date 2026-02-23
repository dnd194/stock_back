/** 공통 API 응답 인터페이스 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  timestamp?: string;
}

/** 성공 응답 생성 헬퍼 */
export function createSuccessResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
}

/** 실패 응답 생성 헬퍼 */
export function createErrorResponse(message: string): ApiResponse {
  return {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };
}
