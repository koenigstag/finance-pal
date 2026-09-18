// @ft/api-database constructs its runtime DataSource at import time, which reads DATABASE_URL.
// Any spec that reaches a service holding entity classes — they are the tokens @InjectRepository
// resolves by — pulls that package in, so the variable has to exist before the first import.
//
// Nothing connects: a DataSource is constructed here, never initialized. A real DATABASE_URL in
// the environment still wins, so this only covers the case of running without one, as CI does.
process.env.DATABASE_URL ??= 'postgres://jest:jest@localhost:5432/jest';
