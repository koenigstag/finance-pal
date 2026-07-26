import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency } from '@ft/api-database';

@Injectable()
export class CurrenciesService {
  constructor(@InjectRepository(Currency) private readonly currencies: Repository<Currency>) {}

  list(): Promise<Currency[]> {
    return this.currencies.find({ order: { id: 'ASC' } });
  }
}
