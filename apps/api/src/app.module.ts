import { Module } from '@nestjs/common';
import { CoreModule } from './modules/_core/core.module';

@Module({
  imports: [CoreModule],
})
export class AppModule {}
