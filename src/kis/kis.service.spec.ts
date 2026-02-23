import { Test, TestingModule } from '@nestjs/testing';
import { KisService } from './kis.service';

describe('KisService', () => {
  let service: KisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KisService],
    }).compile();

    service = module.get<KisService>(KisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
