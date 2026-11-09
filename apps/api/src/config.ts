import {existsSync} from 'node:fs';
import {z} from 'zod';
export function loadConfig(){
 if(existsSync('.env')) process.loadEnvFile('.env');
 return z.object({DATABASE_URL:z.string().default('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),SUPABASE_URL:z.url().default('http://127.0.0.1:54321'),SUPABASE_ANON_KEY:z.string().min(10),SUPABASE_SERVICE_KEY:z.string().min(10),SESSION_KEY:z.string().regex(/^[a-f0-9]{64}$/),APP_ORIGIN:z.url().default('http://localhost:5173'),PORT:z.coerce.number().default(3001),NODE_ENV:z.enum(['development','test','production']).default('development')}).parse(process.env);
}
export type AppConfig=ReturnType<typeof loadConfig>;
