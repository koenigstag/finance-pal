import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as models from './models/index.js';

type EntityClass = new (...args: never[]) => unknown;

// Entities are ES classes, enums (also exported from ./models) compile to plain objects —
// this filters the barrel down to just the classes without a list to keep in sync by hand.
function isEntityClass(value: unknown): value is EntityClass {
  return typeof value === 'function';
}

// cast to unknown[] first so the predicate's `S extends T` constraint isn't fighting the
// wide union of classes-and-enums that Object.values(models) infers
const entities = (Object.values(models) as unknown[]).filter(isEntityClass);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

export const dataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  entities,
});
