import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DEMO_MODE: z.enum(['true','false']).default('false').transform(v => v === 'true'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  SESSION_SECRET: z.string().default('local-development-only-change-this-before-production'),
  UNIVERSITY_API_URL: z.string().default(''),
  UNIVERSITY_API_TOKEN: z.string().default(''),
});
export const env = schema.parse(process.env);
if (env.NODE_ENV === 'production') {
  if (env.DEMO_MODE) throw new Error('DEMO_MODE interdit en production.');
  if (!env.APP_ORIGIN.startsWith('https://')) throw new Error('APP_ORIGIN HTTPS requis en production.');
  if (env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('local-development')) throw new Error('SESSION_SECRET fort requis en production.');
  if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID requis en production.');
}
