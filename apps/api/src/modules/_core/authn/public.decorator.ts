import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'ft:isPublic';

// Opts a route out of JwtAuthGuard. Authentication is deny-by-default: the guard is global,
// so forgetting this decorator makes a route private (safe), never accidentally public.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
