import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Budget, Category, CategoryRule, Currency, RecurringRule, Transaction } from '@ft/api-database';
import { AuthzModule } from '../../_core/authz/authz.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Transaction, RecurringRule, CategoryRule, Budget, Currency]), AuthzModule, RealtimeModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
