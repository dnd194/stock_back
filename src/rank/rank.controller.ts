import { Controller, Get, Logger } from '@nestjs/common';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../common/interfaces/api-response.interface';
import { RankService } from './rank.service';

@Controller('ranking')
export class RankController {
  private readonly logger = new Logger(RankController.name);

  constructor(private readonly rankService: RankService) {}

  @Get('total')
  async getSsangkkeuli() {
    this.logger.log('GET /ranking/total');
    try {
      const result = await this.rankService.getSsangkkeuli();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '상위종목 쌍끌이 순위 조회 성공');
    } catch (error) {
      this.logger.error('상위종목 쌍끌이 순위 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('institution')
  async getInstitution() {
    this.logger.log('GET /ranking/institution');
    try {
      const result = await this.rankService.getInstitution();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '상위종목 기관 순매수 순위 조회 성공');
    } catch (error) {
      this.logger.error('상위종목기관 순매수 순위 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }

  @Get('foreign')
  async getForeign() {
    this.logger.log('GET /ranking/foreign');
    try {
      const result = await this.rankService.getForeign();
      if ('message' in result) {
        return createErrorResponse(result.message);
      }
      return createSuccessResponse(result, '상위종목외국인 순매수 순위 조회 성공');
    } catch (error) {
      this.logger.error('상위종목 외국인 순매수 순위 조회 실패', error);
      return createErrorResponse(toErrorMessage(error));
    }
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '요청 처리 중 오류가 발생했습니다.';
}
