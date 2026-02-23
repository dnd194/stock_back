import { Controller, Get } from '@nestjs/common';
import { KisService } from './kis.service';

@Controller('kis')
export class KisController {
  constructor(private readonly kisService: KisService) {}

  @Get('token')
  async getToken() {
    return this.kisService.getAccessToken();
  }
}
