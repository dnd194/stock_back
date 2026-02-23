import { Controller, Get, Logger } from '@nestjs/common';
import { MarketService } from './market.service';
import { hasOutput } from './market.types';
import { createSuccessResponse, createErrorResponse } from '../common/interfaces/api-response.interface';

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
      return createErrorResponse(data.message ?? '데이터를 찾을 수 없습니다.');
    } catch (error) {
      this.logger.error('시장 데이터 조회 실패', error);
      return createErrorResponse(
        error instanceof Error ? error.message : '시장 데이터 조회 중 오류가 발생했습니다.',
      );
    }
  }

  @Get('refined')
  async getSsangkkeuli() {
    try {
      const raw = await this.marketService.getForeignInstitutionTotal();
      if (!hasOutput(raw)) {
        const message =
          typeof (raw as { message?: string })?.message === 'string'
            ? (raw as { message: string }).message
            : '데이터를 찾을 수 없습니다.';
        return createErrorResponse(message);
      }
      const refined = this.marketService.getSsangkkeuli(raw.output);
      return createSuccessResponse(refined, '정제된 시장 데이터 조회 성공');
    } catch (error) {
      this.logger.error('정제된 시장 데이터 조회 실패', error);
      return createErrorResponse(
        error instanceof Error ? error.message : '정제된 시장 데이터 조회 중 오류가 발생했습니다.',
      );
    }
  }
}
