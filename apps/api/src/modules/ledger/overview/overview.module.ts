import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '@ft/api-database';
import { AuthzModule } from '../../_core/authz/authz.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction]), AuthzModule],
  controllers: [OverviewController],
  providers: [OverviewService],
  // To the MCP endpoint, which totals a month the way the overview does.
  exports: [OverviewService],
})
export class OverviewModule {}
