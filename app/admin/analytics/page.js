'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useToast } from '@/components/ToastProvider';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

function Spinner() {
  return (
    <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

// Curated colors for the Pie chart cells
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6', '#14b8a6', '#f43f5e'];

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const supabase = createClient();
  const { showToast } = useToast();

  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCycle, setActiveCycle] = useState(null);

  // Aggregated data states
  const [averageScores, setAverageScores] = useState([]);
  const [goalsByThrustArea, setGoalsByThrustArea] = useState([]);
  const [managerRates, setManagerRates] = useState([]);

  // Summary counts
  const [summary, setSummary] = useState({
    totalGoals: 0,
    totalSheets: 0,
    totalManagers: 0,
    averageGlobalScore: 0
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    async function loadAnalytics() {
      try {
        // 1. Verify caller session and role
        const { data: { user }, error: authErr } = await supabase.auth.getUser();
        if (authErr || !user) {
          router.push('/login');
          return;
        }

        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (profileErr || !profile || profile.role !== 'admin') {
          showToast('Access denied: Admins only.');
          router.push('/dashboard');
          return;
        }

        // 2. Fetch Active Goal Cycle
        const { data: cycleRow, error: cycleErr } = await supabase
          .from('goal_cycles')
          .select('id, name')
          .eq('is_active', true)
          .maybeSingle();

        if (cycleErr) console.log('error:', cycleErr);
        
        let targetCycleId = cycleRow?.id;
        if (!targetCycleId) {
          // Fallback to latest cycle if no active cycle flag is found
          const { data: latestCycle } = await supabase
            .from('goal_cycles')
            .select('id, name')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          targetCycleId = latestCycle?.id;
          setActiveCycle(latestCycle);
        } else {
          setActiveCycle(cycleRow);
        }

        if (!targetCycleId) {
          setLoading(false);
          return;
        }

        // 3. Fetch Data in Parallel
        const [
          achievementsRes,
          goalsRes,
          thrustAreasRes,
          profilesRes,
          sheetsRes
        ] = await Promise.all([
          supabase.from('achievements').select('quarter, progress_score'),
          supabase.from('goals').select('id, thrust_area_id, uom_type, sheet_id'),
          supabase.from('thrust_areas').select('id, name').eq('cycle_id', targetCycleId),
          supabase.from('profiles').select('id, full_name, role, manager_id'),
          supabase.from('goal_sheets').select('id, employee_id').eq('cycle_id', targetCycleId)
        ]);

        if (achievementsRes.error) console.log('error:', achievementsRes.error);
        if (goalsRes.error) console.log('error:', goalsRes.error);
        if (thrustAreasRes.error) console.log('error:', thrustAreasRes.error);
        if (profilesRes.error) console.log('error:', profilesRes.error);
        if (sheetsRes.error) console.log('error:', sheetsRes.error);

        const achievementsList = achievementsRes.data ?? [];
        const goalsList = goalsRes.data ?? [];
        const thrustAreasList = thrustAreasRes.data ?? [];
        const profilesList = profilesRes.data ?? [];
        const sheetsList = sheetsRes.data ?? [];

        // 4. Fetch Check-ins for Active Cycle Sheets
        const activeSheetIds = sheetsList.map(s => s.id);
        let checkinsList = [];
        if (activeSheetIds.length > 0) {
          const { data: checkinsData, error: checkinsErr } = await supabase
            .from('checkins')
            .select('sheet_id, quarter')
            .in('sheet_id', activeSheetIds);
          if (checkinsErr) console.log('error:', checkinsErr);
          checkinsList = checkinsData ?? [];
        }

        // 5. Aggregate: Bar Chart (Average Progress Score per Quarter)
        const avgChartData = quarters.map(q => {
          const qScores = achievementsList
            .filter(a => a.quarter === q && a.progress_score !== null)
            .map(a => Number(a.progress_score));
          const avg = qScores.length > 0 ? qScores.reduce((s, val) => s + val, 0) / qScores.length : 0;
          return {
            name: q,
            'Avg Score': parseFloat(avg.toFixed(2))
          };
        });
        setAverageScores(avgChartData);

        // 6. Aggregate: Pie Chart (Goal count by Thrust Area)
        const areaMap = {};
        thrustAreasList.forEach(t => { areaMap[t.id] = t.name; });

        const activeGoals = goalsList.filter(g => activeSheetIds.includes(g.sheet_id));
        const goalsByAreaCount = {};
        activeGoals.forEach(g => {
          if (!g.thrust_area_id) return;
          goalsByAreaCount[g.thrust_area_id] = (goalsByAreaCount[g.thrust_area_id] ?? 0) + 1;
        });

        const pieChartData = Object.keys(goalsByAreaCount).map(areaId => ({
          name: areaMap[areaId] ?? 'Other Category',
          value: goalsByAreaCount[areaId]
        }));
        setGoalsByThrustArea(pieChartData);

        // 7. Aggregate: Manager Completion Rate Table
        const managersList = profilesList.filter(p => p.role === 'manager');
        const employeesList = profilesList.filter(p => p.role === 'employee');

        const managerRatesData = managersList.map(mgr => {
          const directReportIds = employeesList
            .filter(e => e.manager_id === mgr.id)
            .map(e => e.id);

          const teamSheets = sheetsList.filter(s => directReportIds.includes(s.employee_id));
          const totalSheets = teamSheets.length;
          const teamSheetIds = teamSheets.map(s => s.id);

          const teamCheckins = checkinsList.filter(c => teamSheetIds.includes(c.sheet_id));

          const rates = {};
          quarters.forEach(q => {
            const completed = teamCheckins.filter(c => c.quarter === q).length;
            rates[q] = {
              completed,
              rate: totalSheets > 0 ? Math.round((completed / totalSheets) * 100) : 0
            };
          });

          return {
            id: mgr.id,
            name: mgr.full_name,
            totalSheets,
            rates
          };
        });
        setManagerRates(managerRatesData);

        // 8. Aggregate Summary metrics
        const allScores = achievementsList
          .filter(a => a.progress_score !== null)
          .map(a => Number(a.progress_score));
        const globalAvg = allScores.length > 0 ? allScores.reduce((s, val) => s + val, 0) / allScores.length : 0;

        setSummary({
          totalGoals: activeGoals.length,
          totalSheets: sheetsList.length,
          totalManagers: managersList.length,
          averageGlobalScore: parseFloat(globalAvg.toFixed(2))
        });

      } catch (err) {
        console.error(err);
        showToast('Error loading analytics data.');
      } finally {
        setLoading(false);
      }
    }

    loadAnalytics();
  }, [router, supabase, showToast]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-slate-400 text-sm">Aggregating analytics data…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-indigo-400">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              Portal System Analytics
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Performance metrics for goal cycle: <span className="text-indigo-400 font-semibold">{activeCycle?.name ?? 'No active cycle configured'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/admin/dashboard')}
            className="self-start md:self-auto px-4 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white font-semibold text-xs transition-colors flex items-center gap-2"
          >
            ← Back to Dashboard
          </button>
        </div>

        {/* Summary Indicators */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-5 shadow-lg">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider block">Active Goals</span>
            <span className="text-2xl font-bold text-white mt-1 block tabular-nums">{summary.totalGoals}</span>
          </div>
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-5 shadow-lg">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider block">Active Sheets</span>
            <span className="text-2xl font-bold text-white mt-1 block tabular-nums">{summary.totalSheets}</span>
          </div>
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-5 shadow-lg">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider block">Active Teams</span>
            <span className="text-2xl font-bold text-white mt-1 block tabular-nums">{summary.totalManagers}</span>
          </div>
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-5 shadow-lg">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider block">Global Achievement Score</span>
            <span className="text-2xl font-bold text-indigo-400 mt-1 block tabular-nums">
              {summary.averageGlobalScore > 0 ? `${summary.averageGlobalScore * 100}%` : '—'}
            </span>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          
          {/* Bar Chart: Progress Averages */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 shadow-lg">
            <h2 className="text-sm font-semibold text-slate-200 mb-6 uppercase tracking-wider">
              Average Progress Score per Quarter
            </h2>
            <div className="h-96 w-full flex items-center justify-center">
              {mounted && averageScores.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={averageScores} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        borderColor: '#475569',
                        borderRadius: '0.75rem',
                        color: '#f8fafc',
                        fontSize: '12px'
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '15px', paddingTop: '15px' }} />
                    <Bar dataKey="Avg Score" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-500 text-s">No progress achievements logged.</p>
              )}
            </div>
          </div>

          {/* Pie Chart: Goals Distribution */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 shadow-lg">
            <h2 className="text-sm font-semibold text-slate-200 mb-6 uppercase tracking-wider">
              Goal Distribution by Thrust Area
            </h2>
            <div className="h-96 w-full flex items-center justify-center">
              {mounted && goalsByThrustArea.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={goalsByThrustArea}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={110}
                      paddingAngle={4}
                      dataKey="value"
                      label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                      labelLine={true}
                    >
                      {goalsByThrustArea.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        borderColor: '#475569',
                        borderRadius: '0.75rem',
                        color: '#f8fafc',
                        fontSize: '12px'
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={48}
                      iconType="circle"
                      wrapperStyle={{ fontSize: '15px', color: '#cbd5e1', paddingTop: '15px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-500 text-xs">No goals mapped to active thrust areas.</p>
              )}
            </div>
          </div>
        </div>

        {/* Manager check-in rate matrix */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-700/50">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Manager Check-in Completion Rate
            </h2>
            <p className="text-slate-500 text-xs mt-1">
              Percentage of direct report goal sheets check-ins completed per quarter
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 border-b border-slate-700/50">
                <tr>
                  <th scope="col" className="px-6 py-4">Manager Name</th>
                  <th scope="col" className="px-6 py-4 text-center">Team Sheets</th>
                  <th scope="col" className="px-6 py-4 text-center">Q1</th>
                  <th scope="col" className="px-6 py-4 text-center">Q2</th>
                  <th scope="col" className="px-6 py-4 text-center">Q3</th>
                  <th scope="col" className="px-6 py-4 text-center">Q4</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {managerRates.length > 0 ? (
                  managerRates.map(mgr => (
                    <tr key={mgr.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 font-semibold text-white">{mgr.name}</td>
                      <td className="px-6 py-4 text-center font-medium tabular-nums">{mgr.totalSheets}</td>
                      {quarters.map(q => {
                        const cell = mgr.rates[q];
                        const rateColor =
                          cell.rate === 100 ? 'text-emerald-400 bg-emerald-500/10' :
                          cell.rate > 0 ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 bg-slate-800/40';
                        return (
                          <td key={q} className="px-6 py-4 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold tabular-nums ${rateColor}`}>
                              {cell.rate}% ({cell.completed}/{mgr.totalSheets})
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500 text-xs">
                      No managers registered in profiles.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-12">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>

      </div>
    </main>
  );
}
