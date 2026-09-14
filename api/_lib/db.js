import { createClient } from '@supabase/supabase-js';

let client;

export function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      throw Object.assign(new Error('Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.'), { status: 500 });
    }
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

// Supabase returns { data, error }; this throws on error so routes stay short.
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw Object.assign(new Error(`Database: ${error.message}`), { status: 500 });
  return data;
}
