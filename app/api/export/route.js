import { createServerSupabaseClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createServerSupabaseClient();

  // Verify auth & admin role
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    return NextResponse.json({ error: 'Forbidden: Admins or Managers only' }, { status: 403 });
  }

  // 1. Get active cycle
  const { data: activeCycle } = await supabase
    .from('goal_cycles')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();

  if (!activeCycle) {
    return NextResponse.json({ error: 'No active cycle found' }, { status: 400 });
  }

  // 2. Fetch all required data
  let empQuery = supabase
    .from('profiles')
    .select('id, full_name, department, manager_id')
    .eq('role', 'employee');

  if (profile.role === 'manager') {
    empQuery = empQuery.eq('manager_id', user.id);
  }

  const { data: employees } = await empQuery;

  const { data: managers } = await supabase
    .from('profiles')
    .select('id, full_name'); // fetch all profiles to map managers
    
  const managerMap = {};
  if (managers) {
    managers.forEach(m => managerMap[m.id] = m.full_name);
  }

  const { data: sheets } = await supabase
    .from('goal_sheets')
    .select('id, employee_id')
    .eq('cycle_id', activeCycle.id);

  const sheetIds = (sheets || []).map(s => s.id);
  
  let goals = [];
  if (sheetIds.length > 0) {
    const { data: fetchedGoals } = await supabase
      .from('goals')
      .select('id, sheet_id, title, uom_type, target, weightage, thrust_areas(name)')
      .in('sheet_id', sheetIds);
    goals = fetchedGoals || [];
  }

  const goalIds = goals.map(g => g.id);
  
  let achievements = [];
  if (goalIds.length > 0) {
    const { data: fetchedAchievements } = await supabase
      .from('achievements')
      .select('goal_id, quarter, actual_value, progress_score')
      .in('goal_id', goalIds);
    achievements = fetchedAchievements || [];
  }

  // 3. Assemble CSV data
  const headers = [
    'Employee',
    'Manager',
    'Department',
    'Thrust Area',
    'Goal Title',
    'UoM Type',
    'Target',
    'Weightage',
    'Q1 Actual',
    'Q1 Score',
    'Q2 Actual',
    'Q2 Score',
    'Q3 Actual',
    'Q3 Score',
    'Q4 Actual',
    'Q4 Score'
  ];

  const rows = [];
  
  // Helper to escape CSV cell
  const escapeCsv = (str) => {
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const sheetMap = {};
  (sheets || []).forEach(s => sheetMap[s.id] = s.employee_id);
  
  const empMap = {};
  (employees || []).forEach(e => empMap[e.id] = e);

  for (const goal of goals) {
    const empId = sheetMap[goal.sheet_id];
    const emp = empMap[empId];
    if (!emp) continue;
    
    const mgrName = emp.manager_id ? managerMap[emp.manager_id] || '' : '';
    const thrustArea = goal.thrust_areas ? goal.thrust_areas.name : '';

    const goalAchievements = achievements.filter(a => a.goal_id === goal.id);
    const getAch = (q) => goalAchievements.find(a => a.quarter === q);

    const q1 = getAch('Q1');
    const q2 = getAch('Q2');
    const q3 = getAch('Q3');
    const q4 = getAch('Q4');

    rows.push([
      escapeCsv(emp.full_name),
      escapeCsv(mgrName),
      escapeCsv(emp.department),
      escapeCsv(thrustArea),
      escapeCsv(goal.title),
      escapeCsv(goal.uom_type),
      escapeCsv(goal.target),
      escapeCsv(goal.weightage),
      escapeCsv(q1 ? q1.actual_value : ''),
      escapeCsv(q1 ? q1.progress_score : ''),
      escapeCsv(q2 ? q2.actual_value : ''),
      escapeCsv(q2 ? q2.progress_score : ''),
      escapeCsv(q3 ? q3.actual_value : ''),
      escapeCsv(q3 ? q3.progress_score : ''),
      escapeCsv(q4 ? q4.actual_value : ''),
      escapeCsv(q4 ? q4.progress_score : '')
    ]);
  }

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="atomquest_export.csv"',
    },
  });
}
