'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

// ─── Shared UI ────────────────────────────────────────────────────────────────

function AtomIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true" className="text-indigo-400">
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" transform="rotate(60 18 18)" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" transform="rotate(120 18 18)" />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

const STATUS_META = {
  draft:     { label: 'Draft',     bg: 'bg-slate-700/60',   text: 'text-slate-300',  dot: 'bg-slate-400' },
  submitted: { label: 'Submitted', bg: 'bg-indigo-500/20',  text: 'text-indigo-300', dot: 'bg-indigo-400' },
  approved:  { label: 'Approved',  bg: 'bg-emerald-500/20', text: 'text-emerald-400',dot: 'bg-emerald-400' },
  returned:  { label: 'Returned',  bg: 'bg-amber-500/20',   text: 'text-amber-400',  dot: 'bg-amber-400' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { label: 'No Sheet', bg: 'bg-slate-800', text: 'text-slate-500', dot: 'bg-slate-600' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${meta.bg} ${meta.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManagerDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [managerName, setManagerName] = useState('');
  const [cycle, setCycle]             = useState(null);
  const [team, setTeam]               = useState([]); // [{profile, sheet}]
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Layout will redirect
      setManagerName('Manager'); // Default fallback, layout layout will provide actual info if needed


      // Active cycle
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('goal_cycles')
        .select('id, name')
        .eq('is_active', true)
        .maybeSingle();
      console.log('error:', cycleErr);
      if (!activeCycle) {
        setLoadError('No active goal cycle. Contact your administrator.');
        setLoading(false);
        return;
      }
      setCycle(activeCycle);

      // Direct reports
      const { data: members, error: membersErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, department')
        .eq('manager_id', user.id)
        .order('full_name');
      console.log('error:', membersErr);

      if (!members || members.length === 0) {
        setTeam([]);
        setLoading(false);
        return;
      }

      // Goal sheets for all direct reports in this cycle (separate flat query)
      const memberIds = members.map(m => m.id);
      const { data: sheets, error: sheetsErr } = await supabase
        .from('goal_sheets')
        .select('id, employee_id, status')
        .in('employee_id', memberIds)
        .eq('cycle_id', activeCycle.id);
      console.log('error:', sheetsErr);

      const sheetMap = {};
      (sheets ?? []).forEach(s => { sheetMap[s.employee_id] = s; });

      setTeam(members.map(m => ({ profile: m, sheet: sheetMap[m.id] ?? null })));
      setLoading(false);
    }
    load();
  }, []);



  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-slate-400 text-sm">Loading team…</p>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
        <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-8 max-w-md text-center">
          <p className="text-red-400 font-medium">{loadError}</p>
        </div>
      </main>
    );
  }

  const pendingCount = team.filter(t => t.sheet?.status === 'submitted').length;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <AtomIcon size={32} />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Team Dashboard</h1>
              <p className="text-slate-400 text-sm mt-0.5">{managerName} · {cycle?.name}</p>
            </div>
          </div>
        </div>

        {/* Pending reviews callout */}
        {pendingCount > 0 && (
          <div className="mb-6 flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-5 py-3">
            <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
            <p className="text-indigo-300 text-sm">
              <span className="font-semibold">{pendingCount}</span> sheet{pendingCount > 1 ? 's' : ''} awaiting your review
            </p>
          </div>
        )}

        {/* Team list */}
        {team.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            No direct reports found for your account.
          </div>
        ) : (
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Team ({team.length})
            </h2>
            <div className="space-y-3">
              {team.map(({ profile, sheet }, i) => (
                <div
                  key={profile.id}
                  id={`team-row-${i}`}
                  className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  {/* Member info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{profile.full_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{profile.department ?? profile.email}</p>
                  </div>

                  {/* Status */}
                  <StatusBadge status={sheet?.status} />

                  {/* Review button — only for submitted sheets */}
                  {sheet?.status === 'submitted' && (
                    <button
                      id={`review-btn-${i}`}
                      type="button"
                      onClick={() => router.push(`/manager/review/${sheet.id}`)}
                      className="shrink-0 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800"
                    >
                      Review →
                    </button>
                  )}

                  {/* View / Check-in links for approved */}
                  {sheet?.status === 'approved' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        id={`checkin-btn-${i}`}
                        type="button"
                        onClick={() => router.push(`/manager/checkin/${sheet.id}`)}
                        className="shrink-0 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800"
                      >
                        Check-in
                      </button>
                      <button
                        id={`view-btn-${i}`}
                        type="button"
                        onClick={() => router.push(`/manager/review/${sheet.id}`)}
                        className="shrink-0 px-4 py-2 rounded-lg border border-slate-600 hover:border-slate-500 text-slate-400 hover:text-white text-xs font-medium transition-colors"
                      >
                        View Goal Sheet
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
