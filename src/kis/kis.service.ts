import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Redis from 'ioredis';

export const KIS_ACCESS_TOKEN_KEY = 'KIS:ACCESS_TOKEN';

const KIS_TOKEN_PATH = '/oauth2/tokenP';

@Injectable()
export class KisService {
  private readonly logger = new Logger(KisService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  /** Redis에 저장된 KIS 토큰 삭제 (만료/401 시 새 토큰 발급 전 호출) */
  async clearCachedToken(): Promise<void> {
    try {
      await this.redis.del(KIS_ACCESS_TOKEN_KEY);
      this.logger.log('Redis 캐시 토큰 삭제 완료');
    } catch (error) {
      this.logger.warn('Redis 토큰 삭제 실패', error);
    }
  }

  /**
   * KIS 액세스 토큰 반환. 캐시 있으면 반환, 없거나 forceRefresh 시 새로 발급.
   * @param forceRefresh true면 캐시 무시 후 Redis 삭제하고 새 토큰 발급
   */
  async getAccessToken(forceRefresh = false): Promise<string> {
    this.logger.log(`getAccessToken(forceRefresh: ${forceRefresh})`);

    const kisConfig = this.configService.get('kis');
    if (!kisConfig?.appKey || !kisConfig?.appSecret) {
      throw new Error(
        'KIS 설정이 없습니다. KIS_APP_KEY, KIS_APP_SECRET을 확인하세요.',
      );
    }

    if (forceRefresh) {
      await this.clearCachedToken();
    }

    const cached = await this.getCachedToken();
    if (cached && !forceRefresh) {
      this.logger.log('캐시 토큰 사용');
      return cached;
    }

    this.logger.log('새 토큰 발급');
    return this.issueAndCacheToken(kisConfig);
  }

  private async getCachedToken(): Promise<string | null> {
    try {
      return await this.redis.get(KIS_ACCESS_TOKEN_KEY);
    } catch (error) {
      this.logger.warn('Redis 토큰 조회 실패', error);
      return null;
    }
  }

  private async issueAndCacheToken(kisConfig: {
    appKey: string;
    appSecret: string;
    baseUrl?: string;
  }): Promise<string> {
    const baseUrl =
      kisConfig.baseUrl ?? 'https://openapi.koreainvestment.com:9443';
    const url = `${baseUrl}${KIS_TOKEN_PATH}`;

    try {
      const res = await axios.post<{
        access_token?: string;
        expires_in?: number;
      }>(url, {
        grant_type: 'client_credentials',
        appkey: kisConfig.appKey,
        appsecret: kisConfig.appSecret,
      });

      const token = res.data?.access_token;
      const expiresIn = res.data?.expires_in;

      if (!token || typeof expiresIn !== 'number') {
        throw new Error('KIS 토큰 응답 형식이 올바르지 않습니다.');
      }

      const ttl = Math.max(60, expiresIn - 60);
      try {
        await this.redis.set(KIS_ACCESS_TOKEN_KEY, token, 'EX', ttl);
        this.logger.log(`토큰 Redis 저장 (TTL: ${ttl}s)`);
      } catch (error) {
        this.logger.warn('Redis 토큰 저장 실패', error);
      }

      return token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const msg =
          error.response?.data?.error_description ?? error.message;
        this.logger.error(`KIS 토큰 발급 실패 (${status ?? 'network'}): ${msg}`);
        throw new Error(
          `KIS 토큰 발급 실패 (${status ?? 'network'}): ${msg}`,
        );
      }
      this.logger.error('KIS 토큰 발급 중 오류', error);
      throw error;
    }
  }
}
