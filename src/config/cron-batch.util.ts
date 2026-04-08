/**
 * 스케줄 Cron(배치) 실행: 로컬에서 prod와 동시에 돌면 DB 중복 적재 가능.
 * - ENABLE_CRON_BATCH=true → 항상 실행
 * - ENABLE_CRON_BATCH=false → 항상 중지
 * - 미설정 → NODE_ENV === 'production' 일 때만 실행
 */
export function resolveEnableCronBatch(): boolean {
  const explicit = process.env.ENABLE_CRON_BATCH;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
