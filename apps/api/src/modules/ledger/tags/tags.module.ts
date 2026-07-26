import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tag } from '@ft/api-database';
import { AuthzModule } from '../../_core/authz/authz.module';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tag]), AuthzModule],
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
