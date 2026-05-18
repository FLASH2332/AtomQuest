'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const STATUS_META = {
  draft:     { label: 'Draft',     bg: 'bg-slate-700/60',   text: 'text-slate-300',  dot: 'bg-slate-400' },
  submitted: { label: 'Submitted', bg: 'bg-indigo-500/15',  text: 'text-indigo-300', dot: 'bg-indigo-400' },
  approved:  { label: 'Approved',  bg: 'bg-emerald-500/15', text: 'text-emerald-400',dot: 'bg-emerald-400' },
  returned:  { label: 'Returned',  bg: 'bg-amber-500/15',   text: 'text-amber-400',  dot: 'bg-amber-400' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${meta.bg} ${meta.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

const UOM_LABEL = { min: 'Min', max: 'Max', timeline: 'Timeline', zero: 'Zero' };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [profile, setProfile]         = useState(null);
  const [cycle, setCycle]             = useState(null);
  const [sheet, setSheet]             = useState(null);   // goal_sheets row
  const [goals, setGoals]             = useState([]);
  const [thrustAreaMap, setThrustAreaMap] = useState({}); // id → name
  const [loadError, setLoadError]     = useState('');
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      // Profile
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .single();
      setProfile(prof);

      // Active cycle
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('goal_cycles')
        .select('id, name')
        .eq('is_active', true)
        .single();

      if (cycleErr || !activeCycle) {
        setLoadError(cycleErr?.message || 'No active goal cycle. Contact your administrator.');
        setLoading(false);
        return;
      }
      setCycle(activeCycle);

      // Goal sheet for this employee + cycle — one row max, no status filter needed
      const { data: goalSheet } = await supabase
        .from('goal_sheets')
        .select('id, status, created_at')
        .eq('employee_id', user.id)
        .eq('cycle_id', activeCycle.id)
        .maybeSingle();

      setSheet(goalSheet ?? null);

      // Fetch thrust areas for this cycle and build an id→name map
      const { data: areaRows } = await supabase
        .from('thrust_areas')
        .select('id, name')
        .eq('cycle_id', activeCycle.id);

      const areaMap = {};
      (areaRows ?? []).forEach(a => { areaMap[a.id] = a.name; });
      setThrustAreaMap(areaMap);

      if (goalSheet) {
        const { data: goalRows } = await supabase
          .from('goals')
          .select('id, title, weightage, uom_type, target, target_date, thrust_area_id')
          .eq('sheet_id', goalSheet.id)
          .order('created_at');

        setGoals(goalRows ?? []);
      }

      setLoading(false);
    }
    load();
  }, []);



  // ─── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin text-indigo-400" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
          </svg>
          <p className="text-slate-400 text-sm">Loading…</p>
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

  const totalWeightage = goals.reduce((sum, g) => sum + (Number(g.weightage) || 0), 0);
  const canEdit = !sheet || sheet.status === 'draft' || sheet.status === 'returned';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <AtomIcon size={32} />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">My Dashboard</h1>
              <p className="text-slate-400 text-sm mt-0.5">
                {profile?.full_name ?? 'Employee'} · {cycle?.name ?? ''}
              </p>
            </div>
          </div>
        </div>

        {/* Goal Sheet Status Card */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Goal Sheet Status</p>
              {sheet ? (
                <StatusBadge status={sheet.status} />
              ) : (
                <span className="text-slate-400 text-sm">No goal sheet yet</span>
              )}
            </div>

            {/* Edit Goals — only when draft or returned */}
            {(sheet?.status === 'draft' || sheet?.status === 'returned' || !sheet) && (
              <button
                id="edit-goals-btn"
                type="button"
                onClick={() => router.push('/employee/goals/new')}
                className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800 flex items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {sheet ? 'Edit Goals' : 'Set Goals'}
              </button>
            )}

            {/* Read-only status notes */}
            {sheet?.status === 'submitted' && (
              <span className="text-xs text-indigo-400 italic">Awaiting manager approval — goals are read-only</span>
            )}
            {sheet?.status === 'approved' && (
              <span className="text-xs text-emerald-400 font-medium">✓ Approved by manager — goals are locked</span>
            )}
          </div>

          {/* Weightage summary */}
          {goals.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-700/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-slate-500">Total Weightage</span>
                <span className={`text-xs font-bold tabular-nums ${totalWeightage === 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {totalWeightage}% / 100%
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-1.5 rounded-full ${totalWeightage === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(totalWeightage, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Goals List */}
        {goals.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Goals ({goals.length})
            </h2>
            <div className="space-y-3">
              {goals.map((goal, i) => (
                <div
                  key={goal.id}
                  id={`goal-row-${i}`}
                  className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                        {thrustAreaMap[goal.thrust_area_id] ?? '—'}
                      </span>
                      <span className="text-slate-700">·</span>
                      <span className="text-xs text-slate-500">{UOM_LABEL[goal.uom_type] ?? goal.uom_type}</span>
                    </div>
                    <p className="text-sm font-medium text-white truncate">{goal.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Target:{' '}
                      {goal.uom_type === 'timeline'
                        ? (goal.target_date ?? '—')
                        : goal.uom_type === 'zero'
                          ? '0 incidents'
                          : (goal.target ?? '—')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-lg font-bold text-white tabular-nums">{goal.weightage}%</span>
                    <p className="text-xs text-slate-500">weight</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          sheet && (
            <div className="text-center py-12 text-slate-500 text-sm">
              No goals added yet.{' '}
              <button onClick={() => router.push('/employee/goals/new')} className="text-indigo-400 hover:text-indigo-300 underline">
                Add goals
              </button>
            </div>
          )
        )}

        {!sheet && (
          <div className="text-center py-16">
            <p className="text-slate-500 text-sm mb-4">You haven&apos;t set any goals for this cycle yet.</p>
            <button
              id="start-goals-btn"
              type="button"
              onClick={() => router.push('/employee/goals/new')}
              className="px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
            >
              Set My Goals
            </button>
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
