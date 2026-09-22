import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category, CategoryRule } from '@ft/api-database';
import { AuthzModule } from '../../_core/authz/authz.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { CategoryRulesController } from './category-rules.controller';
import { CategoryRulesService } from './category-rules.service';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryRule, Category]), AuthzModule, RealtimeModule],
  controllers: [CategoryRulesController],
  providers: [CategoryRulesService],
})
export class CategoryRulesModule {}
