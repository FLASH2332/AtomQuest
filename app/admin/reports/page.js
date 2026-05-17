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

function CompletionPill({ completed }) {
  if (completed) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
        Yes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-400 border border-slate-500/30">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
      No
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminReports() {
  const router = useRouter();
  const supabase = createClient();

  const [adminProfile, setAdminProfile] = useState(null);
  const [cycle, setCycle]               = useState(null);
  const [reportData, setReportData]     = useState([]);
  
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');
  const [exporting, setExporting]     = useState(false);

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
      
      if (!activeCycle) {
        setLoadError('No active goal cycle found.');
        setLoading(false);
        return;
      }
      setCycle(activeCycle);

      // All profiles
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, role, manager_id');
      const employees = profiles.filter(p => p.role === 'employee');
      const profileMap = {};
      profiles.forEach(p => profileMap[p.id] = p);

      const empIds = employees.map(e => e.id);
      
      // Goal sheets
      const { data: sheets } = await supabase
        .from('goal_sheets')
        .select('id, employee_id')
        .in('employee_id', empIds)
        .eq('cycle_id', activeCycle.id);

      const sheetIds = (sheets || []).map(s => s.id);

      // Checkins
      let checkins = [];
      if (sheetIds.length > 0) {
        const { data: fetchedCheckins } = await supabase
          .from('checkins')
          .select('sheet_id, quarter')
          .in('sheet_id', sheetIds);
        checkins = fetchedCheckins || [];
      }

      // Goals & Achievements
      let goals = [];
      if (sheetIds.length > 0) {
        const { data: fetchedGoals } = await supabase
          .from('goals')
          .select('id, sheet_id')
          .in('sheet_id', sheetIds);
        goals = fetchedGoals || [];
      }
      const goalIds = goals.map(g => g.id);

      let achievements = [];
      if (goalIds.length > 0) {
        const { data: fetchedAchievements } = await supabase
          .from('achievements')
          .select('goal_id, quarter')
          .in('goal_id', goalIds);
        achievements = fetchedAchievements || [];
      }

      // Build data model
      const sheetToEmployee = {};
      (sheets || []).forEach(s => sheetToEmployee[s.id] = s.employee_id);
      
      const goalToSheet = {};
      (goals || []).forEach(g => goalToSheet[g.id] = g.sheet_id);

      // We want achievements by sheet_id and quarter
      const sheetAchievements = {};
      achievements.forEach(a => {
        const sheetId = goalToSheet[a.goal_id];
        if (!sheetId) return;
        if (!sheetAchievements[sheetId]) sheetAchievements[sheetId] = {};
        sheetAchievements[sheetId][a.quarter] = true;
      });

      // Checkins by sheet_id and quarter
      const sheetCheckins = {};
      checkins.forEach(c => {
        if (!sheetCheckins[c.sheet_id]) sheetCheckins[c.sheet_id] = {};
        sheetCheckins[c.sheet_id][c.quarter] = true;
      });

      // Build final rows
      const data = employees.map(emp => {
        const sheet = (sheets || []).find(s => s.employee_id === emp.id);
        const mgr = emp.manager_id ? profileMap[emp.manager_id] : null;

        const getStatus = (q) => {
          if (!sheet) return { emp: false, mgr: false };
          const empCompleted = !!(sheetAchievements[sheet.id] && sheetAchievements[sheet.id][q]);
          const mgrCompleted = !!(sheetCheckins[sheet.id] && sheetCheckins[sheet.id][q]);
          return { emp: empCompleted, mgr: mgrCompleted };
        };

        return {
          id: emp.id,
          empName: emp.full_name,
          mgrName: mgr ? mgr.full_name : '—',
          q1: getStatus('Q1'),
          q2: getStatus('Q2'),
          q3: getStatus('Q3'),
          q4: getStatus('Q4'),
        };
      });

      // Sort by employee name
      data.sort((a, b) => a.empName.localeCompare(b.empName));
      setReportData(data);
      setLoading(false);
    }
    load();
  }, []);

  async function handleExport() {
    try {
      setExporting(true);
      const res = await fetch('/api/export');
      if (!res.ok) throw new Error('Failed to download CSV');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'atomquest_export.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting(false);
    }
  }

  // ─── UI ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-slate-400 text-sm">Loading reports dashboard…</p>
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

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <AtomIcon size={32} />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Completion Reports</h1>
              <p className="text-slate-400 text-sm mt-0.5">Cycle: {cycle?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? <Spinner /> : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => router.push('/admin/dashboard')}
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900/50 text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700/60">
                <tr>
                  <th className="px-5 py-4">Employee</th>
                  <th className="px-5 py-4">Manager</th>
                  <th className="px-5 py-4 text-center">Q1</th>
                  <th className="px-5 py-4 text-center">Q2</th>
                  <th className="px-5 py-4 text-center">Q3</th>
                  <th className="px-5 py-4 text-center">Q4</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {reportData.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-5 py-8 text-center text-slate-500 italic">
                      No employees found for this cycle.
                    </td>
                  </tr>
                ) : (
                  reportData.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-5 py-4 font-medium text-white">{row.empName}</td>
                      <td className="px-5 py-4">{row.mgrName}</td>
                      {['q1', 'q2', 'q3', 'q4'].map(q => (
                        <td key={q} className="px-5 py-4 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            <div className="flex items-center justify-between w-[90px] text-[10px] text-slate-400 uppercase tracking-wide">
                              <span>Emp</span>
                              <CompletionPill completed={row[q].emp} />
                            </div>
                            <div className="flex items-center justify-between w-[90px] text-[10px] text-slate-400 uppercase tracking-wide">
                              <span>Mgr</span>
                              <CompletionPill completed={row[q].mgr} />
                            </div>
                          </div>
                        </td>
                      ))}
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
