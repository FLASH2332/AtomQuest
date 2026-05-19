'use client';

import { useState, useEffect, useTransition } from 'react';
import { createClient } from '@/lib/supabase-browser';

function Spinner({ size = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${size} text-current`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export default function AdminEscalationsPage() {
  const supabase = createClient();
  const [escalations, setEscalations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningCheck, setRunningCheck] = useState(false);
  const [actioningId, setActioningId] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Run escalation check and fetch data on mount
  useEffect(() => {
    async function initCheckAndFetch() {
      try {
        setRunningCheck(true);
        // Automatically trigger the background escalations engine to discover new violations
        const checkRes = await fetch('/api/escalation-check');
        const checkData = await checkRes.json();
        if (!checkRes.ok) throw new Error(checkData.error || 'Failed to trigger escalation check.');
      } catch (err) {
        console.error('Background check failed:', err.message);
      } finally {
        setRunningCheck(false);
        await fetchEscalations();
      }
    }
    initCheckAndFetch();
  }, []);

  async function fetchEscalations() {
    try {
      setLoading(true);
      setError('');
      const { data, error: fetchErr } = await supabase
        .from('escalations')
        .select(`
          id,
          type,
          days_overdue,
          employee:employee_id(full_name),
          manager:manager_id(full_name)
        `)
        .eq('resolved', false)
        .order('days_overdue', { ascending: false });

      if (fetchErr) throw new Error(fetchErr.message);
      setEscalations(data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch escalations.');
    } finally {
      setLoading(false);
    }
  }

  // 2. Resolve escalation
  async function handleResolve(id) {
    try {
      setActioningId(id);
      setError('');
      setSuccessMsg('');

      const { error: updateErr } = await supabase
        .from('escalations')
        .update({ resolved: true })
        .eq('id', id);

      if (updateErr) throw new Error(updateErr.message);

      setSuccessMsg('Escalation marked as resolved successfully.');
      // Optimistic filter
      setEscalations(prev => prev.filter(esc => esc.id !== id));
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to mark escalation resolved.');
    } finally {
      setActioningId(null);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">System Escalations</h1>
          <p className="text-slate-400 text-sm mt-1.5">
            Identify overdue employee goal sheets and manager sheet approval delays.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            setSuccessMsg('Running fresh compliance check...');
            setRunningCheck(true);
            try {
              const res = await fetch('/api/escalation-check');
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Check failed.');
              setSuccessMsg(`Fresh check complete! registered ${data.insertedCount || 0} new escalations.`);
              await fetchEscalations();
            } catch (err) {
              setError(err.message);
            } finally {
              setRunningCheck(false);
              setTimeout(() => setSuccessMsg(''), 4000);
            }
          }}
          disabled={loading || runningCheck}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 hover:text-white font-medium text-xs rounded-lg transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {runningCheck ? <Spinner /> : (
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          )}
          Run Escalation Check
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Table */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Spinner size="h-8 w-8" />
          <p className="text-slate-400 text-sm">Loading unresolved escalations…</p>
        </div>
      ) : escalations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 bg-slate-800/40 border border-slate-800/80 rounded-2xl text-center">
          <div className="p-4 bg-slate-800/80 border border-slate-700/50 rounded-full text-indigo-400 mb-4">
            <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-white mb-1">System in Full Compliance</h3>
          <p className="text-slate-400 text-sm max-w-sm">
            All employee goal sheets are successfully submitted, and managers have approved all sheets on schedule.
          </p>
        </div>
      ) : (
        <div className="bg-slate-800/30 border border-slate-850/80 rounded-2xl overflow-hidden backdrop-blur-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-800/50 text-slate-300 font-semibold text-xs uppercase tracking-wider">
                  <th className="py-4 px-5">Employee Name</th>
                  <th className="py-4 px-5">Manager Name</th>
                  <th className="py-4 px-5">Escalation Type</th>
                  <th className="py-4 px-5">Days Overdue</th>
                  <th className="py-4 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {escalations.map((esc) => {
                  const isGoalNotSubmitted = esc.type === 'goal_not_submitted';
                  return (
                    <tr key={esc.id} className="hover:bg-slate-800/20 transition text-sm">
                      <td className="py-4 px-5 font-medium text-white">
                        {esc.employee?.full_name || 'System User'}
                      </td>
                      <td className="py-4 px-5 text-slate-300">
                        {esc.manager?.full_name || 'No Manager Assigned'}
                      </td>
                      <td className="py-4 px-5">
                        {isGoalNotSubmitted ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                            Goal Sheet Not Submitted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                            Manager Approval Pending
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-5">
                        <span className="text-slate-200 font-bold">
                          {esc.days_overdue} {esc.days_overdue === 1 ? 'day' : 'days'}
                        </span>
                        <span className="text-xs text-slate-500 ml-1.5">overdue</span>
                      </td>
                      <td className="py-4 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => handleResolve(esc.id)}
                          disabled={actioningId === esc.id}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-medium text-xs rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer ml-auto"
                        >
                          {actioningId === esc.id ? <Spinner /> : (
                            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          Mark Resolved
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
