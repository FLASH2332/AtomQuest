'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { computeScore } from '@/lib/scores';

// ─── Quarter helpers ──────────────────────────────────────────────────────────

/**
 * Determine the currently open check-in quarter from cycle dates.
 * Returns 'Q1'|'Q2'|'Q3'|'Q4', or null if still in goal-setting phase.
 * Never hardcodes dates — reads from goal_cycles row (AGENTS.md §6.5).
 *
 * @param {{ q1_open: string, q2_open: string, q3_open: string, q4_open: string }} cycle
 * @returns {'Q1'|'Q2'|'Q3'|'Q4'|null}
 */
function getCurrentQuarter(cycle) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Walk from latest to earliest — first match wins
  const milestones = [
    { quarter: 'Q4', date: new Date(cycle.q4_open) },
    { quarter: 'Q3', date: new Date(cycle.q3_open) },
    { quarter: 'Q2', date: new Date(cycle.q2_open) },
    { quarter: 'Q1', date: new Date(cycle.q1_open) },
  ];
  for (const { quarter, date } of milestones) {
    if (today >= date) return quarter;
  }
  return null; // before Q1 open — still in goal-setting phase
}

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

const UOM_LABEL    = { min: 'Min ↑ (higher is better)', max: 'Max ↓ (lower is better)', timeline: 'Timeline', zero: 'Zero incidents' };
const STATUS_OPTS  = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'on_track',    label: 'On Track' },
  { value: 'completed',   label: 'Completed' },
];

/**
 * Format a computed progress_score for display.
 * - timeline/zero: 0 or 1 → "0%" / "100%"
 * - min/max: ratio → e.g. "85.00%" (capped display at 200% to prevent absurd numbers)
 */
function formatScore(score) {
  if (score === null || score === undefined || isNaN(score)) return '—';
  return `${Math.min(score * 100, 999).toFixed(1)}%`;
}

function scoreColor(score) {
  if (score === null || score === undefined || isNaN(score)) return 'text-slate-500';
  if (score >= 1) return 'text-emerald-400';
  if (score >= 0.75) return 'text-indigo-400';
  if (score >= 0.5) return 'text-amber-400';
  return 'text-red-400';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CheckInPage() {
  const router  = useRouter();
  const supabase = createClient();

  const [cycle, setCycle]                   = useState(null);
  const [currentQuarter, setCurrentQuarter] = useState(null);
  const [goals, setGoals]                   = useState([]);  // augmented with form state
  const [thrustAreaMap, setThrustAreaMap]   = useState({});
  const [loading, setLoading]               = useState(true);
  const [loadError, setLoadError]           = useState('');
  const [saveState, setSaveState]           = useState({}); // goalId → {saving, error, success}
  const [managerComment, setManagerComment] = useState(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Layout will redirect

      // Active cycle (with all quarter open-dates for quarter determination)
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('goal_cycles')
        .select('id, name, q1_open, q2_open, q3_open, q4_open')
        .eq('is_active', true)
        .maybeSingle();
      console.log('error:', cycleErr);

      if (cycleErr || !activeCycle) {
        setLoadError(cycleErr?.message || 'No active goal cycle. Contact your administrator.');
        setLoading(false);
        return;
      }
      setCycle(activeCycle);

      const quarter = getCurrentQuarter(activeCycle);
      setCurrentQuarter(quarter);

      if (!quarter) {
        // Goal-setting phase — no check-in available yet
        setLoading(false);
        return;
      }

      // Approved goal sheet for this employee
      const { data: sheet, error: sheetErr } = await supabase
        .from('goal_sheets')
        .select('id')
        .eq('employee_id', user.id)
        .eq('cycle_id', activeCycle.id)
        .eq('status', 'approved')
        .maybeSingle();
      console.log('error:', sheetErr);

      if (!sheet) {
        setLoading(false);
        return; // no approved sheet yet — message shown in render
      }

      // Thrust areas map for this cycle
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
        .select('id, title, description, uom_type, target, target_date, weightage, thrust_area_id, parent_goal_id')
        .eq('sheet_id', sheet.id)
        .order('created_at');
      console.log('error:', goalsErr);

      if (!goalRows || goalRows.length === 0) {
        setLoading(false);
        return;
      }

      // Existing achievements for these goals this quarter (pre-populate form)
      const goalIds = goalRows.map(g => g.id);
      const { data: achievementRows, error: achieveErr } = await supabase
        .from('achievements')
        .select('goal_id, actual_value, completion_date, progress_score')
        .in('goal_id', goalIds)
        .eq('quarter', quarter);
      console.log('error:', achieveErr);

      const achieveMap = {};
      (achievementRows ?? []).forEach(a => { achieveMap[a.goal_id] = a; });

      // Augment goals with editable form state
      setGoals(goalRows.map(g => {
        const existing = achieveMap[g.id];
        return {
          ...g,
          // Form fields
          actualValue:     existing
            ? (g.uom_type === 'timeline' ? '' : String(existing.actual_value ?? ''))
            : '',
          completionDate:  existing?.completion_date ?? '',
          status:          existing?.status ?? 'on_track',
          // Saved score (for display)
          savedScore:      existing?.progress_score ?? null,
        };
      }));

      // Fetch manager comment for this quarter
      const { data: checkinData, error: checkinErr } = await supabase
        .from('checkins')
        .select('comment')
        .eq('sheet_id', sheet.id)
        .eq('quarter', quarter)
        .maybeSingle();
      console.log('error:', checkinErr);
      if (checkinData) {
        setManagerComment(checkinData.comment);
      }

      setLoading(false);
    }
    load();
  }, []);

  // ── Field update ─────────────────────────────────────────────────────────────
  function updateGoal(id, field, value) {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, [field]: value } : g));
  }

  // ── Save single goal achievement ──────────────────────────────────────────────
  async function saveAchievement(goal) {
    setSaveState(prev => ({ ...prev, [goal.id]: { saving: true, error: '', success: false } }));

    try {
      // Compute progress_score via lib/scores.js
      let score;
      if (goal.uom_type === 'timeline') {
        if (!goal.completionDate) throw new Error('Completion date is required for Timeline goals.');
        if (!goal.target_date) throw new Error('This goal has no target date set.');
        score = computeScore('timeline', goal.completionDate, goal.target_date);
      } else if (goal.uom_type === 'zero') {
        const actual = Number(goal.actualValue);
        if (goal.actualValue === '' || isNaN(actual) || actual < 0) {
          throw new Error('Enter the number of incidents (0 or more).');
        }
        score = computeScore('zero', actual, null);
      } else {
        // min or max
        const actual = Number(goal.actualValue);
        const target = Number(goal.target);
        if (goal.actualValue === '' || isNaN(actual)) {
          throw new Error('Actual value is required.');
        }
        if (goal.uom_type === 'max' && actual === 0) {
          throw new Error('Actual cannot be 0 for Max-type goals (division by zero).');
        }
        score = computeScore(goal.uom_type, actual, target);
      }

      // Upsert into achievements table (unique on goal_id, quarter)
      const payload = {
        goal_id:         goal.id,
        quarter:         currentQuarter,
        actual_value:    goal.uom_type === 'timeline' ? null : Number(goal.actualValue),
        completion_date: goal.uom_type === 'timeline' ? goal.completionDate : null,
        progress_score:  score,
        status:          goal.status,
      };

      const { error: upsertErr } = await supabase
        .from('achievements')
        .upsert(payload, { onConflict: 'goal_id,quarter' });
      console.log('error:', upsertErr);
      if (upsertErr) throw new Error(upsertErr.message);

      // Sync to child goals if this is a parent goal
      const { data: children } = await supabase
        .from('goals')
        .select('id, target')
        .eq('parent_goal_id', goal.id);
      
      if (children && children.length > 0) {
        for (const child of children) {
          let childScore = score;
          // Recompute score for child just in case
          if (goal.uom_type === 'timeline') {
            childScore = computeScore('timeline', goal.completionDate, goal.target_date);
          } else if (goal.uom_type === 'zero') {
            childScore = computeScore('zero', Number(goal.actualValue), null);
          } else {
            if (!(goal.uom_type === 'max' && Number(goal.actualValue) === 0)) {
               childScore = computeScore(goal.uom_type, Number(goal.actualValue), Number(child.target));
            }
          }
          
          await supabase.from('achievements').upsert({
            goal_id: child.id,
            quarter: currentQuarter,
            actual_value: goal.uom_type === 'timeline' ? null : Number(goal.actualValue),
            completion_date: goal.uom_type === 'timeline' ? goal.completionDate : null,
            progress_score: childScore,
            status: goal.status
          }, { onConflict: 'goal_id,quarter' });
        }
      }

      // Update local savedScore
      setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, savedScore: score } : g));
      setSaveState(prev => ({ ...prev, [goal.id]: { saving: false, error: '', success: true } }));

      // Clear success after 3s
      setTimeout(() => {
        setSaveState(prev => ({ ...prev, [goal.id]: { saving: false, error: '', success: false } }));
      }, 3000);
    } catch (err) {
      console.log('error:', err);
      setSaveState(prev => ({ ...prev, [goal.id]: { saving: false, error: err.message ?? 'Failed to save.', success: false } }));
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

  // ─── No check-in window open yet ─────────────────────────────────────────────
  if (!currentQuarter) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
        <div className="max-w-md text-center">
          <AtomIcon size={36} />
          <h1 className="text-xl font-bold text-white mt-4 mb-2">No Check-in Window Open</h1>
          <p className="text-slate-400 text-sm">
            The Q1 check-in window opens on{' '}
            {cycle?.q1_open ? new Date(cycle.q1_open).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}.
            Come back then to log your quarterly achievements.
          </p>
          <button
            type="button"
            onClick={() => router.push('/employee/dashboard')}
            className="mt-6 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // ─── No approved sheet yet ────────────────────────────────────────────────────
  if (goals.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
        <div className="max-w-md text-center">
          <AtomIcon size={36} />
          <h1 className="text-xl font-bold text-white mt-4 mb-2">No Approved Goals Yet</h1>
          <p className="text-slate-400 text-sm">
            Your goal sheet must be approved by your manager before you can log check-in achievements.
          </p>
          <button
            type="button"
            onClick={() => router.push('/employee/dashboard')}
            className="mt-6 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <AtomIcon size={32} />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {currentQuarter} Check-in
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">{cycle?.name} · Log your quarterly achievements</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/employee/dashboard')}
          className="text-slate-500 hover:text-slate-300 text-xs mb-8 transition-colors"
        >
          ← Back to Dashboard
        </button>

        {/* Goal cards */}
        <div className="space-y-5">
          {goals.map((goal, i) => {
            const state   = saveState[goal.id] ?? { saving: false, error: '', success: false };
            const isTimeline = goal.uom_type === 'timeline';
            const isZero     = goal.uom_type === 'zero';

            return (
              <div
                key={goal.id}
                id={`checkin-card-${i}`}
                className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6"
              >
                {/* Goal header */}
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                        {thrustAreaMap[goal.thrust_area_id] ?? '—'}
                      </span>
                      <span className="text-slate-700">·</span>
                      <span className="text-xs text-slate-500">{UOM_LABEL[goal.uom_type] ?? goal.uom_type}</span>
                      {goal.parent_goal_id && (
                        <>
                          <span className="text-slate-700">·</span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 uppercase tracking-wider border border-indigo-500/20">
                            Shared Goal
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-white">{goal.title}</p>
                    {goal.parent_goal_id ? (
                      <p className="text-xs text-indigo-300 mt-1 italic">
                        This shared goal is automatically synchronized with the primary owner&apos;s achievements.
                      </p>
                    ) : (
                      goal.description && (
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{goal.description}</p>
                      )
                    )}
                  </div>
                  {/* Saved score badge */}
                  {goal.savedScore !== null && (
                    <div className="shrink-0 text-right">
                      <p className={`text-lg font-bold tabular-nums ${scoreColor(goal.savedScore)}`}>
                        {formatScore(goal.savedScore)}
                      </p>
                      <p className="text-xs text-slate-500">score</p>
                    </div>
                  )}
                </div>

                {/* Target info */}
                <div className="mb-4 px-4 py-3 rounded-lg bg-slate-900/40 border border-slate-700/40 text-xs text-slate-400">
                  <span className="font-medium text-slate-300">Target: </span>
                  {isTimeline
                    ? (goal.target_date ? new Date(goal.target_date).toLocaleDateString('en-IN') : '—')
                    : isZero
                      ? '0 incidents'
                      : `${goal.target ?? '—'}`}
                  <span className="ml-3 font-medium text-slate-300">Weight: </span>{goal.weightage}%
                </div>

                {/* Achievement inputs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {/* Actual / Completion date */}
                  <div>
                    {isTimeline ? (
                      <>
                        <label htmlFor={`completion-date-${i}`} className="block text-xs font-medium text-slate-400 mb-1.5">
                          Completion Date <span className="text-red-400">*</span>
                        </label>
                        <input
                          id={`completion-date-${i}`}
                          type="date"
                          value={goal.completionDate}
                          onChange={e => updateGoal(goal.id, 'completionDate', e.target.value)}
                          disabled={state.saving || !!goal.parent_goal_id}
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 [color-scheme:dark]"
                        />
                      </>
                    ) : (
                      <>
                        <label htmlFor={`actual-${i}`} className="block text-xs font-medium text-slate-400 mb-1.5">
                          {isZero ? 'Incidents (actual count)' : 'Actual Value'}{' '}
                          <span className="text-red-400">*</span>
                        </label>
                        <input
                          id={`actual-${i}`}
                          type="number"
                          min="0"
                          step="any"
                          value={goal.actualValue}
                          onChange={e => updateGoal(goal.id, 'actualValue', e.target.value)}
                          placeholder={isZero ? '0 = no incidents' : 'Enter achieved value'}
                          disabled={state.saving || !!goal.parent_goal_id}
                          className="w-full px-3 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                        />
                      </>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <label htmlFor={`status-${i}`} className="block text-xs font-medium text-slate-400 mb-1.5">
                      Status
                    </label>
                    <select
                      id={`status-${i}`}
                      value={goal.status}
                      onChange={e => updateGoal(goal.id, 'status', e.target.value)}
                      disabled={state.saving || !!goal.parent_goal_id}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                    >
                      {STATUS_OPTS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Score preview — computed locally before saving */}
                {(() => {
                  try {
                    let preview;
                    if (isTimeline && goal.completionDate && goal.target_date) {
                      preview = computeScore('timeline', goal.completionDate, goal.target_date);
                    } else if (isZero && goal.actualValue !== '') {
                      preview = computeScore('zero', Number(goal.actualValue), null);
                    } else if (!isTimeline && !isZero && goal.actualValue !== '' && goal.target) {
                      if (goal.uom_type === 'max' && Number(goal.actualValue) === 0) return null;
                      preview = computeScore(goal.uom_type, Number(goal.actualValue), Number(goal.target));
                    } else {
                      return null;
                    }
                    return (
                      <p className="text-xs text-slate-500 mb-3">
                        Projected score:{' '}
                        <span className={`font-semibold ${scoreColor(preview)}`}>{formatScore(preview)}</span>
                      </p>
                    );
                  } catch {
                    return null;
                  }
                })()}

                {/* Inline error / success */}
                {state.error && (
                  <p role="alert" className="mb-3 text-xs text-red-400 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
                    </svg>
                    {state.error}
                  </p>
                )}
                {state.success && (
                  <p role="status" className="mb-3 text-xs text-emerald-400 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Achievement saved — score: {formatScore(goal.savedScore)}
                  </p>
                )}

                {/* Save button */}
                <div className="flex justify-end">
                  {!goal.parent_goal_id ? (
                    <button
                      id={`save-achievement-${i}`}
                      type="button"
                      onClick={() => saveAchievement(goal)}
                      disabled={state.saving}
                      className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {state.saving ? <><Spinner />Saving…</> : 'Save Achievement'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500 italic">Managed by Primary Owner</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Manager Feedback */}
        <div className="mt-8 bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white mb-3">Manager Feedback</h2>
          {managerComment ? (
            <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-4 text-sm text-slate-300 whitespace-pre-wrap">
              {managerComment}
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">No feedback yet for this quarter.</p>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
