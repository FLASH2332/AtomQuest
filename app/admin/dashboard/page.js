'use client';

import { useState, useEffect } from 'react';
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

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [adminProfile, setAdminProfile] = useState(null);
  const [cycle, setCycle]               = useState(null);
  const [employees, setEmployees]       = useState([]);
  const [expandedEmpId, setExpandedEmpId] = useState(null);
  
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Layout will handle redirect
      setAdminProfile({ id: user.id, full_name: 'Admin' });


      // Active cycle
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('goal_cycles')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();
      console.log('error:', cycleErr);
      if (!activeCycle) {
        setLoadError('No active goal cycle found.');
        setLoading(false);
        return;
      }
      setCycle(activeCycle);

      // All employees
      const { data: emps, error: empsErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, department')
        .eq('role', 'employee')
        .order('full_name');
      console.log('error:', empsErr);

      if (!emps || emps.length === 0) {
        setEmployees([]);
        setLoading(false);
        return;
      }

      // Goal sheets for all employees
      const empIds = emps.map(e => e.id);
      const { data: sheets, error: sheetsErr } = await supabase
        .from('goal_sheets')
        .select('id, employee_id, status')
        .in('employee_id', empIds)
        .eq('cycle_id', activeCycle.id);
      console.log('error:', sheetsErr);

      const sheetIds = (sheets || []).map(s => s.id);
      
      // Goals for these sheets
      let allGoals = [];
      if (sheetIds.length > 0) {
        const { data: goalRows, error: goalsErr } = await supabase
          .from('goals')
          .select('id, sheet_id, title, target, uom_type, weightage, is_locked')
          .in('sheet_id', sheetIds)
          .order('created_at');
        console.log('error:', goalsErr);
        allGoals = goalRows || [];
      }

      // Assemble data
      const sheetMap = {};
      (sheets || []).forEach(s => {
        sheetMap[s.employee_id] = { ...s, goals: [] };
      });
      allGoals.forEach(g => {
        const sheet = Object.values(sheetMap).find(s => s.id === g.sheet_id);
        if (sheet) sheet.goals.push(g);
      });

      setEmployees(emps.map(e => ({
        ...e,
        sheet: sheetMap[e.id] ?? null
      })));

      setLoading(false);
    }
    load();
  }, []);



  async function handleUnlockGoal(goal) {
    if (!confirm(`Are you sure you want to unlock the goal: "${goal.title}"? The employee will be able to edit it again.`)) return;

    setActionError('');
    setActionSuccess('');

    try {
      // 1. Update goal is_locked = false
      const { error: updateErr } = await supabase
        .from('goals')
        .update({ is_locked: false })
        .eq('id', goal.id);
      console.log('error:', updateErr);
      if (updateErr) throw new Error(`Failed to unlock goal: ${updateErr.message}`);

      // 1.5 Update sheet status to returned
      const { error: sheetErr } = await supabase
        .from('goal_sheets')
        .update({ status: 'returned' })
        .eq('id', goal.sheet_id);
      console.log('error:', sheetErr);
      if (sheetErr) throw new Error(`Failed to set sheet status to returned: ${sheetErr.message}`);

      // 2. Insert audit log
      console.log('adminProfile:', adminProfile);
      const { error: auditErr } = await supabase
      .from('audit_logs')
      .insert({
        changed_by: adminProfile.id,
        goal_id: goal.id,
        change_type: 'unlock',
        old_value: { is_locked: true },
        new_value: { is_locked: false },
        reason: 'Admin unlock'
      });
      console.log('error:', auditErr);
      if (auditErr) console.log('audit error detail:', JSON.stringify(auditErr));
      if (auditErr) throw new Error(`Goal unlocked, but failed to write audit log: ${auditErr.message}`);

      // 3. Update local state
      setEmployees(prev => prev.map(emp => {
        if (emp.sheet && emp.sheet.id === goal.sheet_id) {
          return {
            ...emp,
            sheet: {
              ...emp.sheet,
              status: 'returned',
              goals: emp.sheet.goals.map(g => g.id === goal.id ? { ...g, is_locked: false } : g)
            }
          };
        }
        return emp;
      }));

      setActionSuccess('Goal unlocked successfully and logged to audit trails.');
      setTimeout(() => setActionSuccess(''), 3000);
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleUnlockSheet(emp) {
    if (!emp.sheet) return;
    
    const lockedGoals = emp.sheet.goals.filter(g => g.is_locked);
    if (lockedGoals.length === 0) return;

    if (!confirm(`Are you sure you want to unlock ALL goals for ${emp.full_name}? The employee will be able to edit them again.`)) return;

    setActionError('');
    setActionSuccess('');

    try {
      const lockedGoalIds = lockedGoals.map(g => g.id);

      // 1. Update goals is_locked = false
      const { error: updateErr } = await supabase
        .from('goals')
        .update({ is_locked: false })
        .in('id', lockedGoalIds);
      if (updateErr) throw new Error(`Failed to unlock goals: ${updateErr.message}`);

      // 1.5 Update sheet status to returned
      const { error: sheetErr } = await supabase
        .from('goal_sheets')
        .update({ status: 'returned' })
        .eq('id', emp.sheet.id);
      if (sheetErr) throw new Error(`Failed to set sheet status to returned: ${sheetErr.message}`);

      // 2. Insert audit logs
      const auditPayloads = lockedGoals.map(g => ({
        changed_by: adminProfile.id,
        goal_id: g.id,
        change_type: 'unlock',
        old_value: { is_locked: true },
        new_value: { is_locked: false },
        reason: 'Admin bulk unlock'
      }));

      const { error: auditErr } = await supabase
        .from('audit_logs')
        .insert(auditPayloads);
      if (auditErr) throw new Error(`Goals unlocked, but failed to write audit logs: ${auditErr.message}`);

      // 3. Update local state
      setEmployees(prev => prev.map(e => {
        if (e.id === emp.id) {
          return {
            ...e,
            sheet: {
              ...e.sheet,
              status: 'returned',
              goals: e.sheet.goals.map(g => ({ ...g, is_locked: false }))
            }
          };
        }
        return e;
      }));

      setActionSuccess('All goals unlocked successfully and logged to audit trails.');
      setTimeout(() => setActionSuccess(''), 3000);
    } catch (err) {
      setActionError(err.message);
    }
  }

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-slate-400 text-sm">Loading admin dashboard…</p>
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

  const formatDate = (isoString) => {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <AtomIcon size={32} />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Admin Dashboard</h1>
              <p className="text-slate-400 text-sm mt-0.5">{adminProfile?.full_name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/admin/push-goal')}
            className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800 flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Push Shared Goal
          </button>
        </div>

        {/* Action alerts */}
        {actionError && (
          <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {actionError}
          </div>
        )}
        {actionSuccess && (
          <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            {actionSuccess}
          </div>
        )}

        {/* Cycle Information */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-xl p-5 mb-8">
          <h2 className="text-sm font-semibold text-white mb-4">Active Cycle: {cycle?.name}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">FY Period</p>
              <p className="text-slate-300">{formatDate(cycle?.goal_setting_open)} — {formatDate(cycle?.q4_open)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Goal Setting Opens</p>
              <p className="text-slate-300">{formatDate(cycle?.goal_setting_open)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Q1 Opens</p>
              <p className="text-slate-300">{formatDate(cycle?.q1_open)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Q2 Opens</p>
              <p className="text-slate-300">{formatDate(cycle?.q2_open)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Q3 Opens</p>
              <p className="text-slate-300">{formatDate(cycle?.q3_open)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Q4 Opens</p>
              <p className="text-slate-300">{formatDate(cycle?.q4_open)}</p>
            </div>
          </div>
        </div>

        {/* Employee List */}
        <div>
          <h2 className="text-sm font-semibold text-white mb-3">Employees ({employees.length})</h2>
          <div className="space-y-3">
            {employees.length === 0 ? (
              <p className="text-slate-500 text-sm">No employees found in the system.</p>
            ) : (
              employees.map((emp) => {
                const isExpanded = expandedEmpId === emp.id;
                return (
                  <div key={emp.id} className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-xl overflow-hidden transition-all">
                    {/* Employee Row */}
                    <button
                      type="button"
                      onClick={() => setExpandedEmpId(isExpanded ? null : emp.id)}
                      className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-700/30 transition-colors focus:outline-none"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{emp.full_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{emp.department ?? emp.email}</p>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <StatusBadge status={emp.sheet?.status} />
                        <svg className={`w-5 h-5 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {/* Goals Details Panel */}
                    {isExpanded && (
                      <div className="px-5 pb-5 pt-2 border-t border-slate-700/60 bg-slate-900/20">
                        {!emp.sheet ? (
                          <p className="text-xs text-slate-500 italic py-2">No goal sheet created yet.</p>
                        ) : emp.sheet.goals.length === 0 ? (
                          <p className="text-xs text-slate-500 italic py-2">No goals added to this sheet.</p>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between mb-3 mt-1">
                              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Goals ({emp.sheet.goals.length})</h3>
                              {emp.sheet.goals.some(g => g.is_locked) && (
                                <button
                                  type="button"
                                  onClick={() => handleUnlockSheet(emp)}
                                  className="px-3 py-1.5 rounded text-xs font-medium text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                                >
                                  Unlock Entire Sheet
                                </button>
                              )}
                            </div>
                            <div className="space-y-3">
                              {emp.sheet.goals.map((g) => (
                                <div key={g.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-800/80 border border-slate-700">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      {g.is_locked ? (
                                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">Locked</span>
                                      ) : (
                                        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">Unlocked</span>
                                      )}
                                      <span className="text-xs text-slate-400">{g.weightage}%</span>
                                    </div>
                                    <p className="text-sm text-slate-200 truncate">{g.title}</p>
                                  </div>
                                  {g.is_locked && (
                                    <button
                                      type="button"
                                      onClick={() => handleUnlockGoal(g)}
                                      className="shrink-0 px-3 py-1.5 rounded text-xs font-medium text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                                    >
                                      Unlock
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
