import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

export const KIS_ACCESS_TOKEN_KEY = 'KIS:ACCESS_TOKEN';

@Injectable()
export class KisService {
  private readonly logger = new Logger(KisService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  /** Redis에 저장된 KIS 토큰을 삭제한다. 만료/400 시 새 토큰 발급 전에 호출 */
  async clearCachedToken(): Promise<void> {
    try {
      await this.redis.del(KIS_ACCESS_TOKEN_KEY);
      this.logger.log('Redis 캐시 토큰 삭제 완료');
    } catch (error) {
      this.logger.warn('Redis 토큰 삭제 실패', error);
    }
  }

  /**
   * KIS 액세스 토큰 반환. 캐시 있으면 반환, 없거나 forceRefresh 시 새로 발급
   * @param forceRefresh true면 캐시 무시하고 Redis 토큰 삭제 후 새 토큰 발급
   */
  async getAccessToken(forceRefresh = false): Promise<string> {
    this.logger.log(`getAccessToken() 호출 (forceRefresh: ${forceRefresh})`);
    const kisConfig = this.configService.get('kis');
    if (!kisConfig?.appKey || !kisConfig?.appSecret) {
      throw new Error('KIS 설정이 없습니다. KIS_APP_KEY, KIS_APP_SECRET을 확인하세요.');
    }

    if (forceRefresh) {
      await this.clearCachedToken();
    }

    // 1️⃣ Redis에서 토큰 확인
    let cachedToken: string | null = null;
    try {
      cachedToken = await this.redis.get(KIS_ACCESS_TOKEN_KEY);
    } catch (error) {
      this.logger.warn('Redis 토큰 조회 실패, 새 토큰 발급 시도', error);
    }

    if (cachedToken && !forceRefresh) {
      this.logger.log('✅ Redis 캐시 토큰 사용');
      return cachedToken;
    }

    this.logger.log('🔄 새 토큰 발급');

    try {
      // 2️⃣ 한국투자증권 토큰 발급 요청
      const baseUrl = kisConfig.baseUrl ?? 'https://openapi.koreainvestment.com:9443';
      const response = await axios.post<{ access_token: string; expires_in: number }>(
        `${baseUrl}/oauth2/tokenP`,
        {
          grant_type: 'client_credentials',
          appkey: kisConfig.appKey,
          appsecret: kisConfig.appSecret,
        },
      );

      const accessToken = response.data?.access_token;
      const expiresIn = response.data?.expires_in;

      if (!accessToken || typeof expiresIn !== 'number') {
        throw new Error('KIS 토큰 응답 형식이 올바르지 않습니다.');
      }

      // 3️⃣ Redis 저장 (만료 1분 전까지)
      const ttl = Math.max(60, expiresIn - 60);
      try {
        await this.redis.set(KIS_ACCESS_TOKEN_KEY, accessToken, 'EX', ttl);
        this.logger.log(`✅ 토큰 Redis 저장 완료 (TTL: ${ttl}초)`);
      } catch (error) {
        this.logger.warn('Redis 토큰 저장 실패 (토큰은 반환됨)', error);
      }

      return accessToken;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.error_description ?? error.message;
        this.logger.error(`KIS 토큰 발급 실패 (${status ?? 'network'}): ${message}`);
        throw new Error(`KIS 토큰 발급 실패 (${status ?? 'network'}): ${message}`);
      }
      this.logger.error('KIS 토큰 발급 중 예상치 못한 오류', error);
      throw error;
    }
  }
}
