import { createServerSupabaseClient } from '@/lib/supabase';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AuditLogsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Verify Admin Role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    redirect('/dashboard');
  }

  // Fetch audit logs with the user who made the change
  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select(`
      id,
      change_type,
      reason,
      old_value,
      new_value,
      created_at,
      goal_id,
      goals ( title ),
      profiles ( full_name, email )
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching audit logs:', error);
  }

  const formatDate = (isoStr) => {
    return new Date(isoStr).toLocaleString('en-IN', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Audit Logs</h1>
          <p className="text-slate-400 text-sm mt-1">View the 100 most recent post-lock changes to goals and sheets.</p>
        </div>

        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900/50 text-slate-400 uppercase tracking-wider text-xs border-b border-slate-700/60">
                <tr>
                  <th className="px-6 py-4 font-semibold">Timestamp</th>
                  <th className="px-6 py-4 font-semibold">User</th>
                  <th className="px-6 py-4 font-semibold">Action</th>
                  <th className="px-6 py-4 font-semibold">Reason</th>
                  <th className="px-6 py-4 font-semibold w-1/3">Changes (Old → New)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {!logs || logs.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-slate-500 italic">
                      No audit logs found.
                    </td>
                  </tr>
                ) : (
                  logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-200">{log.profiles?.full_name || 'Unknown User'}</div>
                        <div className="text-xs text-slate-500">{log.profiles?.email || ''}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5 items-start">
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-indigo-500/10 text-indigo-400 uppercase tracking-wider border border-indigo-500/20">
                            {log.change_type}
                          </span>
                          <span className="text-xs text-slate-400 max-w-[150px] truncate" title={log.goals?.title || log.old_value?.title || 'Unknown Goal'}>
                            {log.goals?.title || log.old_value?.title || 'Unknown Goal'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        {log.reason || '—'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-2 text-xs font-mono">
                          <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-300 overflow-hidden break-words">
                            <span className="text-red-500/70 font-bold block mb-1">Old:</span>
                            {JSON.stringify(log.old_value)}
                          </div>
                          <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 overflow-hidden break-words">
                            <span className="text-emerald-500/70 font-bold block mb-1">New:</span>
                            {JSON.stringify(log.new_value)}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
