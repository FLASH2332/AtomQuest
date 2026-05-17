import { createServerSupabaseClient } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';

export default async function ManagerLayout({ children }) {
  const supabase = await createServerSupabaseClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile || (profile.role !== 'manager' && profile.role !== 'admin')) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Navbar profile={profile} />
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}
