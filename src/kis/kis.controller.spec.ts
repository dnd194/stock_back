import { Test, TestingModule } from '@nestjs/testing';
import { KisController } from './kis.controller';

describe('KisController', () => {
  let controller: KisController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KisController],
    }).compile();

    controller = module.get<KisController>(KisController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
