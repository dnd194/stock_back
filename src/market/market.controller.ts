import { Controller, Get, Logger } from '@nestjs/common';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../common/interfaces/api-response.interface';
import { MarketService } from './market.service';
import { hasOutput } from './market.types';

@Controller('market')
export class MarketController {
  private readonly logger = new Logger(MarketController.name);

  constructor(private readonly marketService: MarketService) {}

  @Get('raw')
  async getRawData() {
    try {
      const data = await this.marketService.getForeignInstitutionTotal();
      if (hasOutput(data)) {
        return createSuccessResponse(data, '시장 데이터 조회 성공');
      }
      return createErrorResponse(
        getMessage(data) ?? '데이터를 찾을 수 없습니다.',
      );
    } catch (error) {
      this.logger.error('시장 데이터 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('total')
  async getSsangkkeuli() {
    this.logger.log('GET /market/total');
    try {
      const result = await this.marketService.getRefinedWithGemini();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '정제된 시장 데이터 조회 성공');
    } catch (error) {
      this.logger.error('정제된 시장 데이터 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('institution')
  async getInstitution() {
    this.logger.log('GET /market/institution');
    try {
      const result = await this.marketService.getRefinedInstitutionWithGemini();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '기관 순매수 조회 성공');
    } catch (error) {
      this.logger.error('기관 순매수 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('foreign')
  async getForeign() {
    this.logger.log('GET /market/foreign');
    try {
      const result = await this.marketService.getRefinedForeignWithGemini();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '외국인 순매수 조회 성공');
    } catch (error) {
      this.logger.error('외국인 순매수 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }
}

function getMessage(
  data: { message?: string } | Record<string, unknown>,
): string | undefined {
  if (data && typeof (data as { message?: string }).message === 'string') {
    return (data as { message: string }).message;
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '요청 처리 중 오류가 발생했습니다.';
}
