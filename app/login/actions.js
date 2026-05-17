'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase';

/** @type {Record<import('@/lib/types').Role, string>} */
const ROLE_DASHBOARD = {
  employee: '/employee/dashboard',
  manager: '/manager/dashboard',
  admin: '/admin/dashboard',
};

/**
 * Server Action — signs the user in with email + password, then reads their
 * role from the profiles table and redirects to the correct dashboard.
 *
 * Returns an error string on failure so the client can display it inline.
 *
 * @param {FormData} formData
 * @returns {Promise<{error: string}|never>}
 */
export async function login(formData) {
  const email = formData.get('email')?.toString().trim() ?? '';
  const password = formData.get('password')?.toString() ?? '';

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createServerSupabaseClient();

  const { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (authError || !authData.user) {
    return { error: authError?.message ?? 'Login failed. Please try again.' };
  }

  // Read the role from the profiles table.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    // Auth succeeded but no profile row — sign the user back out so they
    // don't end up in a broken half-authed state.
    await supabase.auth.signOut();
    return {
      error:
        'Your account profile could not be found. Please contact your administrator.',
    };
  }

  const destination = ROLE_DASHBOARD[profile.role] ?? '/dashboard';

  // redirect() throws internally (Next.js uses it via an exception), so it
  // must not be inside a try/catch that swallows all errors.
  redirect(destination);
}
