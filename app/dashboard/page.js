import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * Generic /dashboard route — used as a fallback redirect target in middleware
 * when the user's role destination isn't known at redirect time.
 * Reads the actual role from the profiles table and sends the user to the
 * correct role-specific dashboard.
 */
export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const destinations = {
    employee: '/employee/dashboard',
    manager: '/manager/dashboard',
    admin: '/admin/dashboard',
  };

  redirect(destinations[profile?.role] ?? '/login');
}
