'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

// ─── Quarter helper (same logic as employee checkin page) ─────────────────────

function getCurrentQuarter(cycle) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const milestones = [
    { quarter: 'Q4', date: new Date(cycle.q4_open) },
    { quarter: 'Q3', date: new Date(cycle.q3_open) },
    { quarter: 'Q2', date: new Date(cycle.q2_open) },
    { quarter: 'Q1', date: new Date(cycle.q1_open) },
  ];
  for (const { quarter, date } of milestones) {
    if (today >= date) return quarter;
  }
  return null;
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

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

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

const UOM_LABEL = { min: 'Min ↑', max: 'Max ↓', timeline: 'Timeline', zero: 'Zero' };

function scoreColor(score) {
  if (score === null || score === undefined || isNaN(score)) return 'text-slate-500';
  if (score >= 1)    return 'text-emerald-400';
  if (score >= 0.75) return 'text-indigo-400';
  if (score >= 0.5)  return 'text-amber-400';
  return 'text-red-400';
}

function formatScore(score) {
  if (score === null || score === undefined || isNaN(score)) return '—';
  return `${Math.min(score * 100, 999).toFixed(1)}%`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManagerCheckinPage({ params }) {
  const { sheetId } = use(params);
  const router = useRouter();
  const supabase = createClient();

  const [cycle, setCycle]                   = useState(null);
  const [currentQuarter, setCurrentQuarter] = useState(null);
  const [employee, setEmployee]             = useState(null);
  const [goals, setGoals]                   = useState([]);   // with achievements attached
  const [thrustAreaMap, setThrustAreaMap]   = useState({});
  const [comment, setComment]               = useState('');   // current textarea value
  const [existingComment, setExistingComment] = useState(''); // what's saved in DB
  const [loading, setLoading]               = useState(true);
  const [loadError, setLoadError]           = useState('');
  const [isSaving, setIsSaving]             = useState(false);
  const [saveError, setSaveError]           = useState('');
  const [saveSuccess, setSaveSuccess]       = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      console.log('error:', authErr);
      if (!user) { router.push('/login'); return; }

      // Verify manager/admin role
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      console.log('error:', profileErr);
      if (profile?.role !== 'manager' && profile?.role !== 'admin') {
        router.push('/login');
        return;
      }

      // Sheet → get employee_id and cycle_id
      const { data: sheet, error: sheetErr } = await supabase
        .from('goal_sheets')
        .select('id, employee_id, cycle_id, status')
        .eq('id', sheetId)
        .maybeSingle();
      console.log('error:', sheetErr);
      if (!sheet) {
        setLoadError('Goal sheet not found.');
        setLoading(false);
        return;
      }

      // Employee profile
      const { data: emp, error: empErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, department')
        .eq('id', sheet.employee_id)
        .maybeSingle();
      console.log('error:', empErr);
      setEmployee(emp);

      // Active cycle with quarter dates
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('goal_cycles')
        .select('id, name, q1_open, q2_open, q3_open, q4_open')
        .eq('id', sheet.cycle_id)
        .maybeSingle();
      console.log('error:', cycleErr);
      if (!activeCycle) {
        setLoadError('Cycle not found.');
        setLoading(false);
        return;
      }
      setCycle(activeCycle);

      const quarter = getCurrentQuarter(activeCycle);
      setCurrentQuarter(quarter);

      // Thrust areas map
      const { data: areaRows, error: areasErr } = await supabase
        .from('thrust_areas')
        .select('id, name')
        .eq('cycle_id', activeCycle.id);
      console.log('error:', areasErr);
      const areaMap = {};
      (areaRows ?? []).forEach(a => { areaMap[a.id] = a.name; });
      setThrustAreaMap(areaMap);

      // Goals for this sheet
      const { data: goalRows, error: goalsErr } = await supabase
        .from('goals')
        .select('id, title, description, uom_type, target, target_date, weightage, thrust_area_id')
        .eq('sheet_id', sheetId)
        .order('created_at');
      console.log('error:', goalsErr);

      if (!goalRows || goalRows.length === 0) {
        setLoading(false);
        return;
      }

      // Achievements for these goals for the current quarter
      let achieveMap = {};
      if (quarter) {
        const goalIds = goalRows.map(g => g.id);
        const { data: achieveRows, error: achieveErr } = await supabase
          .from('achievements')
          .select('goal_id, actual_value, completion_date, progress_score, status')
          .in('goal_id', goalIds)
          .eq('quarter', quarter);
        console.log('error:', achieveErr);
        (achieveRows ?? []).forEach(a => { achieveMap[a.goal_id] = a; });
      }

      setGoals(goalRows.map(g => ({ ...g, achievement: achieveMap[g.id] ?? null })));

      // Existing checkin comment for this sheet+quarter
      if (quarter) {
        const { data: checkinRow, error: checkinErr } = await supabase
          .from('checkins')
          .select('comment')
          .eq('sheet_id', sheetId)
          .eq('quarter', quarter)
          .maybeSingle();
        console.log('error:', checkinErr);
        if (checkinRow?.comment) {
          setComment(checkinRow.comment);
          setExistingComment(checkinRow.comment);
        }
      }

      setLoading(false);
    }
    load();
  }, [sheetId]);

  // ── Save check-in comment ─────────────────────────────────────────────────────
  async function saveComment() {
    if (!comment.trim()) {
      setSaveError('Comment cannot be empty.');
      return;
    }
    if (!currentQuarter) {
      setSaveError('No check-in window is currently open.');
      return;
    }

    setIsSaving(true);
    setSaveError('');
    setSaveSuccess(false);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error: upsertErr } = await supabase
        .from('checkins')
        .upsert(
          { sheet_id: sheetId, manager_id: user.id, quarter: currentQuarter, comment: comment.trim() },
          { onConflict: 'sheet_id,quarter' }
        );
      console.log('error:', upsertErr);
      if (upsertErr) throw new Error(upsertErr.message);

      setExistingComment(comment.trim());
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err.message ?? 'Failed to save comment.');
    } finally {
      setIsSaving(false);
    }
  }

  // ─── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-slate-400 text-sm">Loading check-in…</p>
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

  const logsTotal = goals.filter(g => g.achievement).length;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <AtomIcon size={28} />
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              {currentQuarter ?? '—'} Check-in Review
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {employee?.full_name ?? '—'}
              {employee?.department ? ` · ${employee.department}` : ''}
              {cycle ? ` · ${cycle.name}` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push('/manager/dashboard')}
          className="text-slate-500 hover:text-slate-300 text-xs mb-8 transition-colors"
        >
          ← Back to team
        </button>

        {/* No check-in window banner */}
        {!currentQuarter && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <p className="text-amber-400 text-sm">No check-in window is currently open. You can view goals but cannot save a comment.</p>
          </div>
        )}

        {/* Summary bar */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl px-6 py-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-0.5">Goals Logged</p>
            <p className="text-2xl font-bold text-white tabular-nums">{logsTotal} <span className="text-slate-500 text-base font-normal">/ {goals.length}</span></p>
          </div>
          {existingComment && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Comment saved for {currentQuarter}
            </div>
          )}
        </div>

        {/* Goal cards — planned vs actual */}
        {goals.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">No goals found for this sheet.</p>
        ) : (
          <div className="space-y-4 mb-6">
            {goals.map((goal, i) => {
              const a = goal.achievement;
              const hasAchievement = !!a;

              return (
                <div
                  key={goal.id}
                  id={`checkin-row-${i}`}
                  className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6"
                >
                  {/* Goal title row */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                          {thrustAreaMap[goal.thrust_area_id] ?? '—'}
                        </span>
                        <span className="text-slate-700">·</span>
                        <span className="text-xs text-slate-500">{UOM_LABEL[goal.uom_type] ?? goal.uom_type}</span>
                        <span className="text-slate-700">·</span>
                        <span className="text-xs text-slate-500">{goal.weightage}%</span>
                      </div>
                      <p className="text-sm font-semibold text-white">{goal.title}</p>
                    </div>

                    {/* Progress score badge */}
                    {hasAchievement ? (
                      <div className="shrink-0 text-right">
                        <p className={`text-xl font-bold tabular-nums ${scoreColor(a.progress_score)}`}>
                          {formatScore(a.progress_score)}
                        </p>
                        <p className="text-xs text-slate-500">progress score</p>
                      </div>
                    ) : (
                      <span className="shrink-0 text-xs text-slate-600 italic">Not logged yet</span>
                    )}
                  </div>

                  {/* Planned vs Actual table */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Planned */}
                    <div className="rounded-lg bg-slate-900/40 border border-slate-700/40 px-4 py-3">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Target</p>
                      <p className="text-sm font-medium text-slate-300">
                        {goal.uom_type === 'timeline'
                          ? (goal.target_date ? new Date(goal.target_date).toLocaleDateString('en-IN') : '—')
                          : goal.uom_type === 'zero'
                            ? '0 incidents'
                            : goal.target ?? '—'}
                      </p>
                    </div>

                    {/* Actual */}
                    <div className={`rounded-lg border px-4 py-3 ${hasAchievement ? 'bg-slate-900/40 border-slate-700/40' : 'bg-slate-800/20 border-slate-700/20'}`}>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Actual</p>
                      {hasAchievement ? (
                        <>
                          <p className="text-sm font-medium text-white">
                            {goal.uom_type === 'timeline'
                              ? (a.completion_date ? new Date(a.completion_date).toLocaleDateString('en-IN') : '—')
                              : a.actual_value ?? '—'}
                          </p>
                          {a.status && (
                            <p className="text-xs text-slate-500 mt-0.5 capitalize">{a.status.replace('_', ' ')}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-slate-600 italic">—</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Manager comment */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white mb-1">
            {currentQuarter ? `${currentQuarter} Manager Comment` : 'Manager Comment'}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            This comment is visible to the employee on their dashboard.
          </p>

          <textarea
            id="manager-checkin-comment"
            rows={4}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Write structured feedback — what's on track, what needs attention, suggested actions…"
            disabled={isSaving || !currentQuarter}
            className="w-full px-4 py-3 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm resize-none disabled:opacity-50"
          />

          {/* Error / Success */}
          {saveError && (
            <p role="alert" id="comment-error" className="mt-2 text-xs text-red-400 flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
              </svg>
              {saveError}
            </p>
          )}

          {saveSuccess && (
            <p role="status" id="comment-success" className="mt-2 text-xs text-emerald-400 flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Comment saved — visible to employee.
            </p>
          )}

          <div className="flex justify-end mt-4">
            <button
              id="save-comment-btn"
              type="button"
              onClick={saveComment}
              disabled={isSaving || !currentQuarter}
              className="px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving ? <><Spinner />Saving…</> : existingComment ? 'Update Comment' : 'Save Comment'}
            </button>
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
