import { Controller, Get, Logger } from '@nestjs/common';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../common/interfaces/api-response.interface';
import { SellService } from './sell.service';

@Controller('sell')
export class SellController {
  private readonly logger = new Logger(SellController.name);

  constructor(private readonly sellService: SellService) {}

  @Get('total')
  async getTotalNetSell() {
    this.logger.log('GET /sell/total');
    try {
      const result = await this.sellService.getTotalNetSell();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '쌍끌이 순매도 순위 조회 성공');
    } catch (error) {
      this.logger.error('쌍끌이 순매도 순위 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('institution')
  async getInstitutionNetSell() {
    this.logger.log('GET /sell/institution');
    try {
      const result = await this.sellService.getInstitutionNetSell();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '기관 순매도 순위 조회 성공');
    } catch (error) {
      this.logger.error('기관 순매도 순위 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('foreign')
  async getForeignNetSell() {
    this.logger.log('GET /sell/foreign');
    try {
      const result = await this.sellService.getForeignNetSell();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '외국인 순매도 순위 조회 성공');
    } catch (error) {
      this.logger.error('외국인 순매도 순위 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '요청 처리 중 오류가 발생했습니다.';
}
