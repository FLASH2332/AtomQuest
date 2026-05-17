import { createBrowserClient } from '@supabase/ssr';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
      'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
  );
}

/**
 * Browser (client-side) Supabase client.
 * Use this in Client Components ("use client").
 * Calling this multiple times is safe — @supabase/ssr memoises it.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Server Supabase client.
 * Use this in Server Components, Server Actions, and Route Handlers.
 * Reads/writes cookies via next/headers so auth state is preserved.
 *
 * IMPORTANT: Never expose SUPABASE_SERVICE_ROLE_KEY on the client.
 * If you need elevated privileges, create a separate admin client inside
 * an API route (/app/api/...) using createServerClient with the service key.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll is called from Server Components where cookies cannot be
          // mutated. The middleware (middleware.js) handles session refresh
          // in that case, so this catch is intentional.
        }
      },
    },
  });
}

/**
 * Admin Supabase client (service role — bypasses RLS).
 * ONLY use this inside /app/api/* route handlers, never in client code.
 * Will throw at import time if SUPABASE_SERVICE_ROLE_KEY is not set.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
        'This client must only be used in API route handlers.'
    );
  }

  // Use createServerClient without cookie handling for admin operations.
  // Admin clients are stateless — they authenticate via the service key.
  return createServerClient(supabaseUrl, serviceRoleKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
