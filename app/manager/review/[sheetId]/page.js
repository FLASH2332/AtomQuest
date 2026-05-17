'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

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

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-xs text-red-400">{message}</p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManagerReviewPage({ params }) {
  const { sheetId } = use(params);
  const router = useRouter();
  const supabase = createClient();

  const [sheet, setSheet]           = useState(null);
  const [employee, setEmployee]     = useState(null);
  const [goals, setGoals]           = useState([]);
  const [comment, setComment]       = useState('');
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState('');
  const [isActing, setIsActing]     = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Sheet is read-only once approved
  const isApproved = sheet?.status === 'approved';

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Layout will handle redirect

      // Sheet
      const { data: sheetRow, error: sheetErr } = await supabase
        .from('goal_sheets')
        .select('id, status, employee_id, cycle_id')
        .eq('id', sheetId)
        .maybeSingle();
      console.log('error:', sheetErr);
      if (!sheetRow) {
        setLoadError('Goal sheet not found.');
        setLoading(false);
        return;
      }
      setSheet(sheetRow);

      // Employee profile
      const { data: emp, error: empErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, department')
        .eq('id', sheetRow.employee_id)
        .maybeSingle();
      console.log('error:', empErr);
      setEmployee(emp);

      // Thrust areas → id:name map
      const { data: areaRows, error: areasErr } = await supabase
        .from('thrust_areas')
        .select('id, name')
        .eq('cycle_id', sheetRow.cycle_id);
      console.log('error:', areasErr);
      const areaMap = {};
      (areaRows ?? []).forEach(a => { areaMap[a.id] = a.name; });

      // Goals for this sheet
      const { data: goalRows, error: goalsErr } = await supabase
        .from('goals')
        .select('id, title, description, uom_type, target, target_date, weightage, thrust_area_id, is_locked')
        .eq('sheet_id', sheetId)
        .order('created_at');
      console.log('error:', goalsErr);

      setGoals((goalRows ?? []).map(g => ({
        ...g,
        thrustAreaName: areaMap[g.thrust_area_id] ?? '—',
        // Editable copies — manager can adjust target and weightage
        editTarget:     g.uom_type === 'timeline' || g.uom_type === 'zero' ? '' : String(g.target ?? ''),
        editTargetDate: g.uom_type === 'timeline' ? (g.target_date ?? '') : '',
        editWeightage:  String(g.weightage ?? ''),
        // Inline validation errors
        errTarget: '',
        errWeightage: '',
      })));

      setLoading(false);
    }
    load();
  }, [sheetId]);

  // ── Inline goal field update ───────────────────────────────────────────────
  function updateGoalField(index, field, value) {
    setGoals(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value, [`err${field.charAt(0).toUpperCase() + field.slice(1)}`]: '' };
      return next;
    });
  }

  // ── Local validation before acting ────────────────────────────────────────
  function validateEdits() {
    let valid = true;
    const updated = goals.map(g => {
      const errs = { errWeightage: '', errTarget: '' };
      const w = Number(g.editWeightage);
      if (!g.editWeightage || isNaN(w) || w < 10) {
        errs.errWeightage = 'Weightage must be ≥ 10.';
        valid = false;
      }
      if (g.uom_type !== 'timeline' && g.uom_type !== 'zero') {
        const tv = Number(g.editTarget);
        if (!g.editTarget || isNaN(tv) || tv <= 0) {
          errs.errTarget = 'Target must be a positive number.';
          valid = false;
        }
      }
      if (g.uom_type === 'timeline' && !g.editTargetDate) {
        errs.errTarget = 'Target date is required.';
        valid = false;
      }
      return { ...g, ...errs };
    });
    setGoals(updated);

    const totalW = updated.reduce((s, g) => s + (Number(g.editWeightage) || 0), 0);
    if (totalW !== 100) {
      setActionError(`Total weightage is ${totalW}%. Must equal 100% before approving.`);
      valid = false;
    }
    return valid;
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  async function handleApprove() {
    setActionError('');
    if (!validateEdits()) return;

    setIsActing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Save inline edits to each goal
      for (const g of goals) {
        const updates = { weightage: Number(g.editWeightage) };
        if (g.uom_type !== 'timeline' && g.uom_type !== 'zero') {
          updates.target = Number(g.editTarget);
        }
        if (g.uom_type === 'timeline') {
          updates.target_date = g.editTargetDate || null;
        }
        const { error: goalUpdateErr } = await supabase
          .from('goals')
          .update(updates)
          .eq('id', g.id);
        console.log('error:', goalUpdateErr);
        if (goalUpdateErr) throw new Error(goalUpdateErr.message);
      }

      // 2. Lock all goals in this sheet
      const goalIds = goals.map(g => g.id);
      const { error: lockErr } = await supabase
        .from('goals')
        .update({ is_locked: true })
        .in('id', goalIds);
      console.log('error:', lockErr);
      if (lockErr) throw new Error(lockErr.message);

      // 3. Set sheet status → approved
      const { error: approveErr } = await supabase
        .from('goal_sheets')
        .update({ status: 'approved' })
        .eq('id', sheetId);
      console.log('error:', approveErr);
      if (approveErr) throw new Error(approveErr.message);

      // 4. Write comment to checkins if provided
      if (comment.trim()) {
        const { error: checkinErr } = await supabase
          .from('checkins')
          .upsert(
            { sheet_id: sheetId, manager_id: user.id, quarter: 'Q1', comment: comment.trim() },
            { onConflict: 'sheet_id,quarter' }
          );
        console.log('error:', checkinErr);
        if (checkinErr) throw new Error(checkinErr.message);
      }

      setSheet(prev => ({ ...prev, status: 'approved' }));
      setActionSuccess('Sheet approved and all goals locked.');
      setTimeout(() => router.push('/manager/dashboard'), 1500);
    } catch (err) {
      setActionError(err.message ?? 'An unexpected error occurred.');
    } finally {
      setIsActing(false);
    }
  }

  // ── Return ────────────────────────────────────────────────────────────────
  async function handleReturn() {
    setActionError('');
    if (!comment.trim()) {
      setActionError('A comment is required when returning a sheet to the employee.');
      return;
    }

    setIsActing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Set sheet status → returned
      const { error: returnErr } = await supabase
        .from('goal_sheets')
        .update({ status: 'returned' })
        .eq('id', sheetId);
      console.log('error:', returnErr);
      if (returnErr) throw new Error(returnErr.message);

      // 2. Write return comment to checkins
      const { error: checkinErr } = await supabase
        .from('checkins')
        .upsert(
          { sheet_id: sheetId, manager_id: user.id, quarter: 'Q1', comment: comment.trim() },
          { onConflict: 'sheet_id,quarter' }
        );
      console.log('error:', checkinErr);
      if (checkinErr) throw new Error(checkinErr.message);

      setSheet(prev => ({ ...prev, status: 'returned' }));
      setActionSuccess('Sheet returned to employee with your comment.');
      setTimeout(() => router.push('/manager/dashboard'), 1500);
    } catch (err) {
      setActionError(err.message ?? 'An unexpected error occurred.');
    } finally {
      setIsActing(false);
    }
  }

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-slate-400 text-sm">Loading goal sheet…</p>
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

  const totalWeightage = goals.reduce((s, g) => s + (Number(g.editWeightage) || 0), 0);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <AtomIcon size={28} />
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Review: {employee?.full_name ?? '—'}
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {employee?.department ?? employee?.email ?? ''}
              {sheet?.status && (
                <span className={`ml-2 text-xs font-semibold ${
                  sheet.status === 'approved' ? 'text-emerald-400' :
                  sheet.status === 'returned' ? 'text-amber-400' : 'text-indigo-400'
                }`}>
                  · {sheet.status.charAt(0).toUpperCase() + sheet.status.slice(1)}
                </span>
              )}
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

        {/* Approved banner */}
        {isApproved && (
          <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            This sheet is approved. All goals are locked — view only.
          </div>
        )}

        {/* Weightage meter */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-300">Weightage</span>
            <span className={`text-sm font-bold tabular-nums ${totalWeightage === 100 ? 'text-emerald-400' : totalWeightage > 100 ? 'text-red-400' : 'text-indigo-400'}`}>
              Total: {totalWeightage}% / 100%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${totalWeightage === 100 ? 'bg-emerald-500' : totalWeightage > 100 ? 'bg-red-500' : 'bg-indigo-500'}`}
              style={{ width: `${Math.min(totalWeightage, 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">{goals.length} goal{goals.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Goals */}
        <div className="space-y-4 mb-6">
          {goals.map((goal, i) => (
            <div
              key={goal.id}
              id={`goal-review-${i}`}
              className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6"
            >
              {/* Goal header */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">{goal.thrustAreaName}</span>
                    <span className="text-slate-700">·</span>
                    <span className="text-xs text-slate-500">{UOM_LABEL[goal.uom_type] ?? goal.uom_type}</span>
                    {goal.is_locked && (
                      <span className="text-xs text-amber-500 font-medium">🔒 Locked</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-white">{goal.title}</p>
                  {goal.description && (
                    <p className="text-xs text-slate-400 mt-1">{goal.description}</p>
                  )}
                </div>
              </div>

              {/* Inline editable fields — hidden when approved */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Target */}
                <div>
                  {goal.uom_type === 'timeline' ? (
                    <>
                      <label htmlFor={`target-date-${i}`} className="block text-xs font-medium text-slate-400 mb-1.5">
                        Target Date
                      </label>
                      <input
                        id={`target-date-${i}`}
                        type="date"
                        value={goal.editTargetDate}
                        onChange={e => updateGoalField(i, 'editTargetDate', e.target.value)}
                        disabled={isApproved || isActing}
                        className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 [color-scheme:dark]"
                      />
                      <FieldError message={goal.errTarget} />
                    </>
                  ) : goal.uom_type === 'zero' ? (
                    <>
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">Target</label>
                      <div className="px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-700 text-slate-500 text-sm">
                        Zero incidents (fixed)
                      </div>
                    </>
                  ) : (
                    <>
                      <label htmlFor={`target-${i}`} className="block text-xs font-medium text-slate-400 mb-1.5">
                        Target Value
                      </label>
                      <input
                        id={`target-${i}`}
                        type="number"
                        min="0"
                        step="any"
                        value={goal.editTarget}
                        onChange={e => updateGoalField(i, 'editTarget', e.target.value)}
                        disabled={isApproved || isActing}
                        className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                      />
                      <FieldError message={goal.errTarget} />
                    </>
                  )}
                </div>

                {/* Weightage */}
                <div>
                  <label htmlFor={`weightage-${i}`} className="block text-xs font-medium text-slate-400 mb-1.5">
                    Weightage (%)
                  </label>
                  <div className="relative">
                    <input
                      id={`weightage-${i}`}
                      type="number"
                      min="10"
                      max="100"
                      step="1"
                      value={goal.editWeightage}
                      onChange={e => updateGoalField(i, 'editWeightage', e.target.value)}
                      disabled={isApproved || isActing}
                      className="w-full px-3 py-2 pr-8 rounded-lg bg-slate-700/60 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
                  </div>
                  <FieldError message={goal.errWeightage} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Comment */}
        {!isApproved && (
          <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6 mb-6">
            <label htmlFor="manager-comment" className="block text-sm font-medium text-slate-300 mb-2">
              Manager Comment
              <span className="text-slate-500 font-normal ml-1">(required for Return, optional for Approve)</span>
            </label>
            <textarea
              id="manager-comment"
              rows={3}
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add feedback for the employee…"
              disabled={isActing}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm resize-none disabled:opacity-50"
            />
          </div>
        )}

        {/* Errors / Success */}
        {actionError && (
          <div role="alert" id="action-error" className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
            </svg>
            <span>{actionError}</span>
          </div>
        )}

        {actionSuccess && (
          <div role="status" id="action-success" className="mb-5 flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {actionSuccess}
          </div>
        )}

        {/* Action buttons */}
        {!isApproved && sheet?.status !== 'returned' && (
          <div className="flex items-center justify-end gap-3">
            <button
              id="return-btn"
              type="button"
              onClick={handleReturn}
              disabled={isActing || !!actionSuccess}
              className="px-6 py-2.5 rounded-lg border border-amber-500/50 hover:border-amber-400 text-amber-400 hover:text-amber-300 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isActing ? <Spinner /> : null}
              Return to Employee
            </button>

            <button
              id="approve-btn"
              type="button"
              onClick={handleApprove}
              disabled={isActing || !!actionSuccess}
              className="px-8 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isActing ? <Spinner /> : null}
              Approve & Lock Goals
            </button>
          </div>
        )}

        {sheet?.status === 'returned' && !actionSuccess && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-3 text-sm text-amber-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 0 1 0 12h-3" />
            </svg>
            Sheet already returned — awaiting employee revision.
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
