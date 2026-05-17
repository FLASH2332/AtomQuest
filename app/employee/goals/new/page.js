'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_GOALS = 8;
const MIN_WEIGHTAGE = 10;
const UOM_OPTIONS = [
  { value: 'min', label: 'Min — higher is better (e.g. Revenue)' },
  { value: 'max', label: 'Max — lower is better (e.g. Cost, TAT)' },
  { value: 'timeline', label: 'Timeline — date-based completion' },
  { value: 'zero', label: 'Zero — zero equals success (e.g. Incidents)' },
];

function emptyGoal() {
  return {
    thrust_area_id: '',
    title: '',
    description: '',
    uom_type: 'min',
    target: '',
    target_date: '',
    weightage: '',
  };
}

// ─── Inline error component ───────────────────────────────────────────────────
function FieldError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-red-400 flex items-center gap-1">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
      </svg>
      {message}
    </p>
  );
}

// ─── Atom icon (matches login page) ──────────────────────────────────────────
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

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

// ─── Validate all goals ───────────────────────────────────────────────────────
// requireTotal: true = also fail when sum ≠ 100 (used for Submit)
// requireTotal: false = only check per-field errors (used for Save Draft)
function validateGoals(goals, { requireTotal = true } = {}) {
  const errors = goals.map((g, i) => {
    const e = {};
    if (!g.thrust_area_id) e.thrust_area_id = 'Select a thrust area.';
    if (!g.title.trim()) e.title = 'Title is required.';
    if (!g.uom_type) e.uom_type = 'Select a UoM type.';

    const w = Number(g.weightage);
    if (!g.weightage) e.weightage = 'Weightage is required.';
    else if (isNaN(w) || w < MIN_WEIGHTAGE) e.weightage = `Minimum weightage is ${MIN_WEIGHTAGE}%.`;
    else if (w > 100) e.weightage = 'Weightage cannot exceed 100%.';

    if (g.uom_type === 'timeline') {
      if (!g.target_date) e.target_date = 'Target date is required for Timeline goals.';
    } else if (g.uom_type !== 'zero') {
      const tv = Number(g.target);
      if (!g.target) e.target = 'Target value is required.';
      else if (isNaN(tv) || tv <= 0) e.target = 'Target must be a positive number.';
    } else {
      // zero type: target is always 0, no input needed
    }
    return e;
  });

  const totalWeightage = goals.reduce((sum, g) => sum + (Number(g.weightage) || 0), 0);
  const weightageError = totalWeightage !== 100
    ? `Total weightage is ${totalWeightage}%. It must equal exactly 100%.`
    : null;

  const hasFieldErrors = errors.some(e => Object.keys(e).length > 0);
  return {
    errors,
    weightageError,
    isValid: !hasFieldErrors && (!requireTotal || !weightageError),
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function NewGoalsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [thrustAreas, setThrustAreas] = useState([]);
  const [activeCycle, setActiveCycle] = useState(null);
  const [sheetStatus, setSheetStatus] = useState(null); // null = no sheet yet
  const [sheetId, setSheetId] = useState(null);         // persisted across saves
  const [goals, setGoals] = useState([emptyGoal()]);
  const [fieldErrors, setFieldErrors] = useState([{}]);
  const [weightageError, setWeightageError] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  // Goals are read-only once submitted or approved
  const isReadOnly = sheetStatus === 'submitted' || sheetStatus === 'approved';

  // ── Load active cycle, thrust areas, and any existing draft ─────────────────
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      // Active cycle
      const { data: cycle, error: cycleErr } = await supabase
        .from('goal_cycles')
        .select('id, name')
        .eq('is_active', true)
        .single();

      if (cycleErr || !cycle) {
        setLoadError('No active goal cycle found. Please contact your administrator.');
        return;
      }
      setActiveCycle(cycle);

      // Thrust areas for this cycle
      const { data: areas, error: areasErr } = await supabase
        .from('thrust_areas')
        .select('id, name')
        .eq('cycle_id', cycle.id)
        .order('name');

      if (areasErr) {
        setLoadError('Failed to load thrust areas. Please refresh.');
        return;
      }
      setThrustAreas(areas ?? []);

      // Check for an existing draft or returned sheet for this user + cycle
      const { data: sheet } = await supabase
        .from('goal_sheets')
        .select('id, status')
        .eq('employee_id', user.id)
        .eq('cycle_id', cycle.id)
        .in('status', ['draft', 'returned'])
        .maybeSingle();

      if (sheet) {
        setSheetStatus(sheet.status);
        setSheetId(sheet.id);

        // Fetch goals for that sheet
        const { data: existingGoals } = await supabase
          .from('goals')
          .select('thrust_area_id, title, description, uom_type, target, target_date, weightage')
          .eq('sheet_id', sheet.id)
          .order('created_at');

        if (existingGoals && existingGoals.length > 0) {
          const formGoals = existingGoals.map(g => ({
            thrust_area_id: g.thrust_area_id ?? '',
            title: g.title ?? '',
            description: g.description ?? '',
            uom_type: g.uom_type ?? 'min',
            target: g.uom_type === 'timeline' || g.uom_type === 'zero'
              ? ''
              : String(g.target ?? ''),
            target_date: g.uom_type === 'timeline' ? (g.target_date ?? '') : '',
            weightage: String(g.weightage ?? ''),
          }));
          setGoals(formGoals);
          setFieldErrors(formGoals.map(() => ({})));
        }
      } else {
        // Also check for submitted/approved sheet so we can show read-only view
        const { data: lockedSheet } = await supabase
          .from('goal_sheets')
          .select('id, status')
          .eq('employee_id', user.id)
          .eq('cycle_id', cycle.id)
          .in('status', ['submitted', 'approved'])
          .maybeSingle();

        if (lockedSheet) {
          setSheetStatus(lockedSheet.status);
          setSheetId(lockedSheet.id);

          const { data: existingGoals } = await supabase
            .from('goals')
            .select('thrust_area_id, title, description, uom_type, target, target_date, weightage')
            .eq('sheet_id', lockedSheet.id)
            .order('created_at');

          if (existingGoals && existingGoals.length > 0) {
            const formGoals = existingGoals.map(g => ({
              thrust_area_id: g.thrust_area_id ?? '',
              title: g.title ?? '',
              description: g.description ?? '',
              uom_type: g.uom_type ?? 'min',
              target: g.uom_type === 'timeline' || g.uom_type === 'zero'
                ? ''
                : String(g.target ?? ''),
              target_date: g.uom_type === 'timeline' ? (g.target_date ?? '') : '',
              weightage: String(g.weightage ?? ''),
            }));
            setGoals(formGoals);
            setFieldErrors(formGoals.map(() => ({})));
          }
        }
      }
    }
    load();
  }, []);

  // ── Live validation when user has interacted ─────────────────────────────────
  useEffect(() => {
    if (!touched) return;
    const { errors, weightageError: we } = validateGoals(goals);
    setFieldErrors(errors);
    setWeightageError(we);
  }, [goals, touched]);

  // ── Goal field update ────────────────────────────────────────────────────────
  const updateGoal = useCallback((index, field, value) => {
    setTouched(true);
    setGoals(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // Reset target fields when uom_type changes
      if (field === 'uom_type') {
        next[index].target = '';
        next[index].target_date = '';
      }
      return next;
    });
  }, []);

  const addGoal = () => {
    if (goals.length >= MAX_GOALS) return;
    setGoals(prev => [...prev, emptyGoal()]);
    setFieldErrors(prev => [...prev, {}]);
  };

  const removeGoal = (index) => {
    if (goals.length === 1) return;
    setGoals(prev => prev.filter((_, i) => i !== index));
    setFieldErrors(prev => prev.filter((_, i) => i !== index));
  };

  // ── Total weightage meter ────────────────────────────────────────────────────
  const totalWeightage = goals.reduce((sum, g) => sum + (Number(g.weightage) || 0), 0);
  const meterColor = totalWeightage === 100
    ? 'bg-emerald-500'
    : totalWeightage > 100
      ? 'bg-red-500'
      : 'bg-indigo-500';

  // ── Submit sheet (status → submitted, requires total = 100%) ────────────────
  async function submitSheet() {
    setTouched(true);
    const { errors, weightageError: we, isValid } = validateGoals(goals, { requireTotal: true });
    setFieldErrors(errors);
    setWeightageError(we);
    if (!isValid) return;

    setIsSubmitting(true);
    setSubmitError('');

    startTransition(async () => {
      try {
        // Must have a saved sheet to submit
        if (!sheetId) throw new Error('Save as draft first before submitting.');

        // Update sheet status → submitted
        const { error: statusErr } = await supabase
          .from('goal_sheets')
          .update({ status: 'submitted' })
          .eq('id', sheetId);

        if (statusErr) throw new Error(statusErr.message);

        setSheetStatus('submitted');
        setIsSubmitted(true);
        setTimeout(() => router.push('/employee/dashboard'), 1500);
      } catch (err) {
        setSubmitError(err.message ?? 'An unexpected error occurred.');
      } finally {
        setIsSubmitting(false);
      }
    });
  }

  // ── Save as draft ────────────────────────────────────────────────────────────
  async function saveDraft() {
    setTouched(true);
    // Draft allows incomplete weightage — only per-field errors block save.
    const { errors, weightageError: we, isValid } = validateGoals(goals, { requireTotal: false });
    setFieldErrors(errors);
    setWeightageError(we);
    if (!isValid) return;

    setIsSaving(true);
    setSubmitError('');

    startTransition(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push('/login'); return; }

        // Fetch existing sheet (draft or returned) or create a new one.
        // We avoid upsert here because Supabase upsert may not return the
        // existing row id reliably across all versions — explicit fetch is safer.
        let sheetId;

        const { data: existingSheet } = await supabase
          .from('goal_sheets')
          .select('id')
          .eq('employee_id', user.id)
          .eq('cycle_id', activeCycle.id)
          .in('status', ['draft', 'returned'])
          .maybeSingle();

        if (existingSheet) {
          sheetId = existingSheet.id;
          setSheetId(sheetId);
        } else {
          const { data: newSheet, error: insertSheetErr } = await supabase
            .from('goal_sheets')
            .insert({ employee_id: user.id, cycle_id: activeCycle.id, status: 'draft' })
            .select('id')
            .single();
          if (insertSheetErr) throw new Error(insertSheetErr.message);
          sheetId = newSheet.id;
          setSheetId(sheetId);
        }

        // Delete ALL existing goals for this sheet — runs every time, unconditionally.
        console.log('deleting goals for sheetId:', sheetId);
        const { error: deleteErr } = await supabase
          .from('goals')
          .delete()
          .eq('sheet_id', sheetId);
        console.log('delete result:', deleteErr);

        if (deleteErr) throw new Error(deleteErr.message);

        // Insert all goals
        const goalsPayload = goals.map(g => ({
          sheet_id: sheetId,
          thrust_area_id: g.thrust_area_id,
          title: g.title.trim(),
          description: g.description.trim() || null,
          uom_type: g.uom_type,
          target: g.uom_type === 'timeline'
            ? null
            : g.uom_type === 'zero'
              ? 0
              : Number(g.target),
          target_date: g.uom_type === 'timeline' ? g.target_date : null,
          weightage: Number(g.weightage),
          is_locked: false,
          is_shared: false,
          parent_goal_id: null,
        }));

        const { error: goalsErr } = await supabase
          .from('goals')
          .insert(goalsPayload);

        if (goalsErr) throw new Error(goalsErr.message);

        setSubmitSuccess(true);
        setTimeout(() => router.push('/employee/dashboard'), 1500);
      } catch (err) {
        setSubmitError(err.message ?? 'An unexpected error occurred. Please try again.');
      } finally {
        setIsSaving(false);
      }
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
        <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-8 max-w-md text-center">
          <p className="text-red-400 font-medium">{loadError}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <AtomIcon size={32} />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Set My Goals</h1>
            {activeCycle && (
              <p className="text-slate-400 text-sm mt-0.5">{activeCycle.name} · Draft</p>
            )}
          </div>
        </div>

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
              className={`h-2 rounded-full transition-all duration-300 ${meterColor}`}
              style={{ width: `${Math.min(totalWeightage, 100)}%` }}
            />
          </div>
          {weightageError && touched && (
            <p role="alert" id="weightage-error" className="mt-2 text-xs text-red-400 flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
              </svg>
              {weightageError}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-2">
            {goals.length}/{MAX_GOALS} goals · Each goal min {MIN_WEIGHTAGE}% · Total must equal 100%
          </p>
        </div>

        {/* Goal cards */}
        <div className="space-y-4">
          {goals.map((goal, index) => {
            const errs = fieldErrors[index] ?? {};
            const isTimeline = goal.uom_type === 'timeline';
            const isZero = goal.uom_type === 'zero';

            return (
              <div
                key={index}
                id={`goal-card-${index}`}
                className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6 shadow-lg"
              >
                {/* Card header */}
                <div className="flex items-center justify-between mb-5">
                  <span className="text-sm font-semibold text-indigo-400 uppercase tracking-wider">
                    Goal {index + 1}
                  </span>
                  {goals.length > 1 && (
                    <button
                      id={`remove-goal-${index}`}
                      type="button"
                      onClick={() => removeGoal(index)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-400/10"
                      aria-label={`Remove goal ${index + 1}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {/* Thrust Area */}
                  <div>
                    <label htmlFor={`thrust-${index}`} className="block text-sm font-medium text-slate-300 mb-1.5">
                      Thrust Area <span className="text-red-400">*</span>
                    </label>
                    <select
                      id={`thrust-${index}`}
                      value={goal.thrust_area_id}
                      onChange={e => updateGoal(index, 'thrust_area_id', e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                      disabled={isSaving || thrustAreas.length === 0}
                    >
                      <option value="">— Select thrust area —</option>
                      {thrustAreas.map(area => (
                        <option key={area.id} value={area.id}>{area.name}</option>
                      ))}
                    </select>
                    <FieldError message={errs.thrust_area_id} />
                  </div>

                  {/* Title */}
                  <div>
                    <label htmlFor={`title-${index}`} className="block text-sm font-medium text-slate-300 mb-1.5">
                      Goal Title <span className="text-red-400">*</span>
                    </label>
                    <input
                      id={`title-${index}`}
                      type="text"
                      value={goal.title}
                      onChange={e => updateGoal(index, 'title', e.target.value)}
                      placeholder="e.g. Achieve Q2 Sales Revenue Target"
                      className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                      disabled={isSaving}
                      maxLength={200}
                    />
                    <FieldError message={errs.title} />
                  </div>

                  {/* Description */}
                  <div>
                    <label htmlFor={`desc-${index}`} className="block text-sm font-medium text-slate-300 mb-1.5">
                      Description <span className="text-slate-500 font-normal">(optional)</span>
                    </label>
                    <textarea
                      id={`desc-${index}`}
                      value={goal.description}
                      onChange={e => updateGoal(index, 'description', e.target.value)}
                      placeholder="Describe what success looks like…"
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm resize-none disabled:opacity-50"
                      disabled={isSaving}
                      maxLength={1000}
                    />
                  </div>

                  {/* UoM + Target (2-col on md+) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* UoM Type */}
                    <div>
                      <label htmlFor={`uom-${index}`} className="block text-sm font-medium text-slate-300 mb-1.5">
                        UoM Type <span className="text-red-400">*</span>
                      </label>
                      <select
                        id={`uom-${index}`}
                        value={goal.uom_type}
                        onChange={e => updateGoal(index, 'uom_type', e.target.value)}
                        className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                        disabled={isSaving}
                      >
                        {UOM_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <FieldError message={errs.uom_type} />
                    </div>

                    {/* Target — conditional on UoM */}
                    <div>
                      {isTimeline ? (
                        <>
                          <label htmlFor={`target-date-${index}`} className="block text-sm font-medium text-slate-300 mb-1.5">
                            Target Date <span className="text-red-400">*</span>
                          </label>
                          <input
                            id={`target-date-${index}`}
                            type="date"
                            value={goal.target_date}
                            onChange={e => updateGoal(index, 'target_date', e.target.value)}
                            className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50 [color-scheme:dark]"
                            disabled={isSaving}
                          />
                          <FieldError message={errs.target_date} />
                        </>
                      ) : isZero ? (
                        <>
                          <label className="block text-sm font-medium text-slate-300 mb-1.5">Target</label>
                          <div className="w-full px-4 py-2.5 rounded-lg bg-slate-700/30 border border-slate-700 text-slate-400 text-sm select-none">
                            Zero incidents (fixed target)
                          </div>
                        </>
                      ) : (
                        <>
                          <label htmlFor={`target-val-${index}`} className="block text-sm font-medium text-slate-300 mb-1.5">
                            Target Value <span className="text-red-400">*</span>
                          </label>
                          <input
                            id={`target-val-${index}`}
                            type="number"
                            min="0"
                            step="any"
                            value={goal.target}
                            onChange={e => updateGoal(index, 'target', e.target.value)}
                            placeholder="e.g. 1000000"
                            className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                            disabled={isSaving}
                          />
                          <FieldError message={errs.target} />
                        </>
                      )}
                    </div>
                  </div>

                  {/* Weightage */}
                  <div className="md:w-1/2">
                    <label htmlFor={`weightage-${index}`} className="block text-sm font-medium text-slate-300 mb-1.5">
                      Weightage (%) <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id={`weightage-${index}`}
                        type="number"
                        min={MIN_WEIGHTAGE}
                        max="100"
                        step="1"
                        value={goal.weightage}
                        onChange={e => updateGoal(index, 'weightage', e.target.value)}
                        placeholder="e.g. 25"
                        className="w-full px-4 py-2.5 pr-10 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                        disabled={isSaving}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">%</span>
                    </div>
                    <FieldError message={errs.weightage} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add goal button */}
        {goals.length < MAX_GOALS && (
          <button
            id="add-goal-btn"
            type="button"
            onClick={addGoal}
            disabled={isSaving}
            className="mt-4 w-full py-3 px-4 rounded-xl border-2 border-dashed border-slate-600 hover:border-indigo-500 text-slate-400 hover:text-indigo-400 transition-colors text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Goal ({goals.length}/{MAX_GOALS})
          </button>
        )}

        {/* Submit error */}
        {submitError && (
          <div role="alert" id="submit-error" className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
            </svg>
            <span>{submitError}</span>
          </div>
        )}

        {/* Draft saved success */}
        {submitSuccess && !isSubmitted && (
          <div role="status" id="submit-success" className="mt-5 flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Goals saved as draft! Redirecting…
          </div>
        )}

        {/* Submitted success */}
        {isSubmitted && (
          <div role="status" id="submit-sheet-success" className="mt-5 flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Goal sheet submitted for approval! Redirecting…
          </div>
        )}

        {/* Read-only banner when already submitted/approved */}
        {isReadOnly && !isSubmitted && (
          <div className="mt-5 flex items-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            This goal sheet is <strong className="font-semibold">{sheetStatus}</strong> and cannot be edited.
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <button
            id="back-dashboard-btn"
            type="button"
            onClick={() => router.push('/employee/dashboard')}
            disabled={isSaving || isSubmitting}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors disabled:opacity-50"
          >
            ← Dashboard
          </button>

          {!isReadOnly && (
            <div className="flex items-center gap-3">
              <button
                id="save-draft-btn"
                type="button"
                onClick={saveDraft}
                disabled={isSaving || isSubmitting || submitSuccess || isSubmitted}
                className="px-6 py-2.5 rounded-lg border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSaving ? <><Spinner />Saving…</> : 'Save Draft'}
              </button>

              <button
                id="submit-sheet-btn"
                type="button"
                onClick={submitSheet}
                disabled={isSaving || isSubmitting || submitSuccess || isSubmitted}
                className="px-8 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? <><Spinner />Submitting…</> : 'Submit for Approval'}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-8">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
