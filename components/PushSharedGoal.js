'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

const UOM_OPTIONS = [
  { value: 'min', label: 'Min — higher is better (e.g. Revenue)' },
  { value: 'max', label: 'Max — lower is better (e.g. Cost, TAT)' },
  { value: 'timeline', label: 'Timeline — date-based completion' },
  { value: 'zero', label: 'Zero — zero equals success (e.g. Incidents)' },
];

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

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

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

export default function PushSharedGoal({ scope, backPath }) {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  
  const [cycle, setCycle] = useState(null);
  const [thrustAreas, setThrustAreas] = useState([]);
  const [employees, setEmployees] = useState([]);

  // Form State
  const [thrustAreaId, setThrustAreaId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [uomType, setUomType] = useState('min');
  const [target, setTarget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [weightage, setWeightage] = useState('10');
  
  const [primaryOwner, setPrimaryOwner] = useState('');
  const [recipients, setRecipients] = useState([]); // array of employee IDs

  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Active cycle
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('goal_cycles')
        .select('id, name')
        .eq('is_active', true)
        .maybeSingle();

      if (cycleErr || !activeCycle) {
        setLoadError('No active goal cycle found. Contact your administrator.');
        setLoading(false);
        return;
      }
      setCycle(activeCycle);

      // 2. Thrust Areas
      const { data: areas } = await supabase
        .from('thrust_areas')
        .select('id, name')
        .eq('cycle_id', activeCycle.id)
        .order('name');
      setThrustAreas(areas ?? []);

      // 3. Employees (based on scope)
      let query = supabase.from('profiles').select('id, full_name, email, department').eq('role', 'employee').order('full_name');
      if (scope === 'manager') {
        query = query.eq('manager_id', user.id);
      }
      
      const { data: emps, error: empsErr } = await query;
      if (empsErr) {
        setLoadError('Failed to load employees.');
        setLoading(false);
        return;
      }
      setEmployees(emps ?? []);
      setLoading(false);
    }
    load();
  }, [scope]);

  const toggleRecipient = (id) => {
    setRecipients(prev => 
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  const validateForm = () => {
    const e = {};
    if (!thrustAreaId) e.thrustAreaId = 'Select a thrust area.';
    if (!title.trim()) e.title = 'Title is required.';
    if (!uomType) e.uomType = 'Select a UoM type.';

    const w = Number(weightage);
    if (!weightage) e.weightage = 'Weightage is required.';
    else if (isNaN(w) || w < 10) e.weightage = `Minimum weightage is 10%.`;
    else if (w > 100) e.weightage = 'Weightage cannot exceed 100%.';

    if (uomType === 'timeline') {
      if (!targetDate) e.targetDate = 'Target date is required for Timeline goals.';
    } else if (uomType !== 'zero') {
      const tv = Number(target);
      if (!target) e.target = 'Target value is required.';
      else if (isNaN(tv) || tv <= 0) e.target = 'Target must be a positive number.';
    }

    if (!primaryOwner) e.primaryOwner = 'Select a primary owner.';
    if (recipients.length === 0) e.recipients = 'Select at least one recipient.';
    if (recipients.includes(primaryOwner)) {
      e.recipients = 'Primary owner cannot also be in the recipients list.';
    }

    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    setSubmitError('');

    startTransition(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const allUsers = [primaryOwner, ...recipients];

        // 1. Fetch sheets for all involved users
        const { data: existingSheets, error: sheetsErr } = await supabase
          .from('goal_sheets')
          .select('id, employee_id, status')
          .in('employee_id', allUsers)
          .eq('cycle_id', cycle.id);
        
        if (sheetsErr) throw new Error(sheetsErr.message);

        const sheetMap = {}; // employee_id -> sheet object
        (existingSheets || []).forEach(s => sheetMap[s.employee_id] = s);

        // 2. Count goals per sheet to enforce max 8 goals
        const sheetIds = (existingSheets || []).map(s => s.id);
        let goalCounts = {};
        
        if (sheetIds.length > 0) {
          const { data: existingGoals, error: goalsErr } = await supabase
            .from('goals')
            .select('id, sheet_id')
            .in('sheet_id', sheetIds);
            
          if (goalsErr) throw new Error(goalsErr.message);
          
          (existingGoals || []).forEach(g => {
            goalCounts[g.sheet_id] = (goalCounts[g.sheet_id] || 0) + 1;
          });
        }

        // Validate max goals
        for (const empId of allUsers) {
          const sheet = sheetMap[empId];
          if (sheet) {
            const count = goalCounts[sheet.id] || 0;
            if (count >= 8) {
              const empName = employees.find(e => e.id === empId)?.full_name || 'An employee';
              throw new Error(`Cannot push goal: ${empName} already has the maximum of 8 goals. Please return their sheet and ask them to remove a goal first.`);
            }
          }
        }

        // 3. Ensure all users have a sheet
        for (const empId of allUsers) {
          if (!sheetMap[empId]) {
            const { data: newSheet, error: insertSheetErr } = await supabase
              .from('goal_sheets')
              .insert({ employee_id: empId, cycle_id: cycle.id, status: 'draft' })
              .select('id, employee_id, status')
              .single();
            if (insertSheetErr) throw new Error(insertSheetErr.message);
            sheetMap[empId] = newSheet;
          }
        }

        // 4. Update status to 'returned' for any submitted/approved sheets
        const sheetsToReturn = Object.values(sheetMap).filter(s => s.status === 'submitted' || s.status === 'approved');
        if (sheetsToReturn.length > 0) {
          const { error: updateSheetsErr } = await supabase
            .from('goal_sheets')
            .update({ status: 'returned' })
            .in('id', sheetsToReturn.map(s => s.id));
          if (updateSheetsErr) throw new Error(updateSheetsErr.message);
        }

        // 5. Insert Primary Goal
        const targetVal = uomType === 'timeline' ? null : uomType === 'zero' ? 0 : Number(target);
        const targetDateVal = uomType === 'timeline' ? targetDate : null;

        const primaryPayload = {
          sheet_id: sheetMap[primaryOwner].id,
          thrust_area_id: thrustAreaId,
          title: title.trim(),
          description: description.trim() || null,
          uom_type: uomType,
          target: targetVal,
          target_date: targetDateVal,
          weightage: Number(weightage),
          is_shared: true,
          parent_goal_id: null,
        };

        const { data: insertedPrimary, error: primaryErr } = await supabase
          .from('goals')
          .insert(primaryPayload)
          .select('id')
          .single();
          
        if (primaryErr) throw new Error(primaryErr.message);

        // 6. Insert Copy Goals
        const copyPayloads = recipients.map(recipientId => ({
          sheet_id: sheetMap[recipientId].id,
          thrust_area_id: thrustAreaId,
          title: title.trim(),
          description: description.trim() || null,
          uom_type: uomType,
          target: targetVal,
          target_date: targetDateVal,
          weightage: Number(weightage),
          is_shared: true,
          parent_goal_id: insertedPrimary.id,
        }));

        const { error: copiesErr } = await supabase
          .from('goals')
          .insert(copyPayloads);
          
        if (copiesErr) throw new Error(copiesErr.message);

        setSubmitSuccess(true);
        setTimeout(() => router.push(backPath), 2000);

      } catch (err) {
        setSubmitError(err.message ?? 'An unexpected error occurred.');
      } finally {
        setIsSubmitting(false);
      }
    });
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
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

  const isTimeline = uomType === 'timeline';
  const isZero = uomType === 'zero';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <AtomIcon size={32} />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Push Shared Goal</h1>
            <p className="text-slate-400 text-sm mt-0.5">{cycle?.name} · Departmental KPI</p>
          </div>
        </div>

        {submitError && (
          <div role="alert" className="mb-6 flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
            </svg>
            <span>{submitError}</span>
          </div>
        )}

        {submitSuccess && (
          <div role="status" className="mb-6 flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Shared Goal pushed successfully! Redirecting…
          </div>
        )}

        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6 shadow-lg space-y-6">
          
          {/* Section 1: Goal Details */}
          <div>
            <h2 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-4 border-b border-slate-700 pb-2">1. Goal Details</h2>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Thrust Area <span className="text-red-400">*</span>
                </label>
                <select
                  value={thrustAreaId}
                  onChange={e => setThrustAreaId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                  disabled={isSubmitting || submitSuccess}
                >
                  <option value="">— Select thrust area —</option>
                  {thrustAreas.map(area => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.thrustAreaId} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Goal Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Department Sales Revenue Target"
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                  disabled={isSubmitting || submitSuccess}
                  maxLength={200}
                />
                <FieldError message={fieldErrors.title} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Description <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe the KPI…"
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm resize-none disabled:opacity-50"
                  disabled={isSubmitting || submitSuccess}
                  maxLength={1000}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    UoM Type <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={uomType}
                    onChange={e => {
                      setUomType(e.target.value);
                      setTarget('');
                      setTargetDate('');
                    }}
                    className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                    disabled={isSubmitting || submitSuccess}
                  >
                    {UOM_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <FieldError message={fieldErrors.uomType} />
                </div>

                <div>
                  {isTimeline ? (
                    <>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">
                        Target Date <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="date"
                        value={targetDate}
                        onChange={e => setTargetDate(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50 [color-scheme:dark]"
                        disabled={isSubmitting || submitSuccess}
                      />
                      <FieldError message={fieldErrors.targetDate} />
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
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">
                        Target Value <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        placeholder="e.g. 1000000"
                        className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                        disabled={isSubmitting || submitSuccess}
                      />
                      <FieldError message={fieldErrors.target} />
                    </>
                  )}
                </div>
              </div>
              
              <div className="md:w-1/2">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Default Weightage (%) <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="10"
                    max="100"
                    step="1"
                    value={weightage}
                    onChange={e => setWeightage(e.target.value)}
                    placeholder="e.g. 25"
                    className="w-full px-4 py-2.5 pr-10 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                    disabled={isSubmitting || submitSuccess}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">%</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">Recipients can adjust this in their own sheet.</p>
                <FieldError message={fieldErrors.weightage} />
              </div>

            </div>
          </div>

          {/* Section 2: Assignments */}
          <div>
            <h2 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-4 border-b border-slate-700 pb-2 mt-8">2. Assignments</h2>
            
            <div className="grid grid-cols-1 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Primary Owner <span className="text-red-400">*</span>
                </label>
                <select
                  value={primaryOwner}
                  onChange={e => setPrimaryOwner(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                  disabled={isSubmitting || submitSuccess}
                >
                  <option value="">— Select Primary Owner —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.department || 'No Dept'})</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">The primary owner logs the actual achievement which syncs to all recipients.</p>
                <FieldError message={fieldErrors.primaryOwner} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Recipients <span className="text-red-400">*</span>
                </label>
                <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                  {employees.filter(emp => emp.id !== primaryOwner).map(emp => (
                    <label key={emp.id} className="flex items-center gap-3 cursor-pointer p-1.5 hover:bg-slate-700/50 rounded transition-colors">
                      <input
                        type="checkbox"
                        checked={recipients.includes(emp.id)}
                        onChange={() => toggleRecipient(emp.id)}
                        disabled={isSubmitting || submitSuccess}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-500 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800"
                      />
                      <span className="text-sm text-white">{emp.full_name} <span className="text-slate-500 text-xs">({emp.department || 'No Dept'})</span></span>
                    </label>
                  ))}
                  {employees.filter(emp => emp.id !== primaryOwner).length === 0 && (
                    <p className="text-sm text-slate-500 p-2">No other employees available.</p>
                  )}
                </div>
                <FieldError message={fieldErrors.recipients} />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(backPath)}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || submitSuccess}
            className="px-8 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? <><Spinner />Pushing Goal…</> : 'Push Shared Goal'}
          </button>
        </div>

        <p className="text-center text-slate-600 text-xs mt-8">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
