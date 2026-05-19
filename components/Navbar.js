'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

function AtomIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true" className="text-indigo-400">
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" transform="rotate(60 18 18)" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" transform="rotate(120 18 18)" />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
    </svg>
  );
}

export default function Navbar({ profile }) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const getDashboardLink = () => {
    if (profile?.role === 'admin') return '/admin/dashboard';
    if (profile?.role === 'manager') return '/manager/dashboard';
    return '/employee/dashboard';
  };

  return (
    <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        
        {/* Left Side: Logo & Links */}
        <div className="flex items-center gap-6">
          <Link href={getDashboardLink()} className="flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
            <AtomIcon size={24} />
            <span className="text-white font-bold tracking-tight hidden sm:inline-block">AtomQuest</span>
          </Link>
          
          <div className="flex items-center gap-1 sm:gap-4 text-sm font-medium text-slate-400">
            {profile?.role === 'employee' && (
              <>
                <Link href="/employee/dashboard" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">My Goals</Link>
                <Link href="/employee/checkin" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Check-ins</Link>
              </>
            )}
            {profile?.role === 'manager' && (
              <>
                <Link href="/manager/dashboard" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Team Goals</Link>
              </>
            )}
            {profile?.role === 'admin' && (
              <>
                <Link href="/admin/dashboard" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Admin Hub</Link>
                <Link href="/admin/reports" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Reports</Link>
                <Link href="/admin/escalations" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Escalations</Link>
                <Link href="/admin/chatbot" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Assistant</Link>
                <Link href="/admin/analytics" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Analytics</Link>
                <Link href="/admin/audit-logs" className="hover:text-white transition-colors px-2 py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">Audit Logs</Link>
              </>
            )}
          </div>
        </div>
        
        {/* Right Side: Profile & Sign Out */}
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-500 hidden md:inline-block">
            {profile?.full_name} ({profile?.role})
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs font-semibold text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Sign out
          </button>
        </div>

      </div>
    </nav>
  );
}
