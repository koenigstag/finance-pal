import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { initializeDataSource, initializeTransactionalContext } from '@ft/api-database';

// Owns every concern tied to wiring up @ft/api-database's DataSource into Nest: registering
// it with typeorm-transactional, and handing that exact instance to TypeOrmModule instead of
// letting it construct a second, disconnected one.
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({}),
      dataSourceFactory: () => initializeDataSource(),
    }),
  ],
})
export class DatabaseModule {
  // Call before NestFactory.create() — typeorm-transactional needs its AsyncLocalStorage
  // context set up before addTransactionalDataSource() (triggered by this module's
  // dataSourceFactory above) or any @Transactional() method runs.
  static init(): void {
    initializeTransactionalContext();
  }
}
