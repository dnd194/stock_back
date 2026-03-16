import { Controller, Get, Logger, Query } from '@nestjs/common';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../common/interfaces/api-response.interface';
import { HistoryService } from './history.service';

@Controller('history/buy')
export class HistoryController {
  private readonly logger = new Logger(HistoryController.name);

  constructor(private readonly historyService: HistoryService) {}

  @Get('total')
  async getTotalBuyHistory(@Query('date') date: string) {
    this.logger.log('GET /history/buy/total');
    if (!date) {
      return createErrorResponse('date 파라미터가 필요합니다.');
    }
    try {
      const result = await this.historyService.getTotalBuyHistory(date);
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '쌍끌이 순매수 날짜별 조회 성공');
    } catch (error) {
      this.logger.error('쌍끌이 순매수 날짜별 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('institution')
  async getInstitutionBuyHistory(@Query('date') date: string) {
    this.logger.log('GET /history/buy/institution');
    if (!date) {
      return createErrorResponse('date 파라미터가 필요합니다.');
    }
    try {
      const result = await this.historyService.getInstitutionBuyHistory(date);
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '기관 순매수 날짜별 조회 성공');
    } catch (error) {
      this.logger.error('기관 순매수 날짜별 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('foreign')
  async getForeignBuyHistory(@Query('date') date: string) {
    this.logger.log('GET /history/buy/foreign');
    if (!date) {
      return createErrorResponse('date 파라미터가 필요합니다.');
    }
    try {
      const result = await this.historyService.getForeignBuyHistory(date);
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '외국인 순매수 날짜별 조회 성공');
    } catch (error) {
      this.logger.error('외국인 순매수 순위 날짜별 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '요청 처리 중 오류가 발생했습니다.';
}
