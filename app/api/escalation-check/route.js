import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET() {
  try {
    // Admin client is required to bypass RLS policies and retrieve organization-wide state
    const adminSupabase = createAdminClient();

    // 1. Fetch active goal cycle
    const { data: activeCycle, error: cycleErr } = await adminSupabase
      .from('goal_cycles')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (cycleErr) throw new Error(`Cycle fetch failed: ${cycleErr.message}`);
    if (!activeCycle) {
      return NextResponse.json({ message: 'No active goal cycle found.' }, { status: 200 });
    }

    // 2. Fetch all employees
    const { data: employees, error: empErr } = await adminSupabase
      .from('profiles')
      .select('id, full_name, manager_id, role')
      .eq('role', 'employee');

    if (empErr) throw new Error(`Employees fetch failed: ${empErr.message}`);

    const employeeMap = {};
    (employees || []).forEach(emp => {
      employeeMap[emp.id] = emp;
    });

    // 3. Fetch goal sheets for the active cycle
    const { data: sheets, error: sheetsErr } = await adminSupabase
      .from('goal_sheets')
      .select('*')
      .eq('cycle_id', activeCycle.id);

    if (sheetsErr) throw new Error(`Sheets fetch failed: ${sheetsErr.message}`);

    const sheetMap = {};
    (sheets || []).forEach(sheet => {
      sheetMap[sheet.employee_id] = sheet;
    });

    // 4. Fetch existing unresolved escalations to avoid duplicates
    const { data: unresolvedEscalations, error: escErr } = await adminSupabase
      .from('escalations')
      .select('employee_id, type')
      .eq('resolved', false);

    if (escErr) throw new Error(`Escalations lookup failed: ${escErr.message}`);

    const existingEscMap = new Set();
    (unresolvedEscalations || []).forEach(esc => {
      existingEscMap.add(`${esc.employee_id}_${esc.type}`);
    });

    const now = new Date();
    const inserts = [];

    // -------------------------------------------------------------------------
    // Rule 1: 'goal_not_submitted' (Draft or No Sheet past 7 days of cycle open)
    // -------------------------------------------------------------------------
    const openDate = new Date(activeCycle.goal_setting_open);
    const msSinceOpen = now - openDate;
    const daysSinceOpen = Math.floor(msSinceOpen / (1000 * 60 * 60 * 24));

    if (daysSinceOpen > 7) {
      const daysOverdue = daysSinceOpen - 7;

      for (const emp of employees) {
        const sheet = sheetMap[emp.id];
        // Trigger if: no sheet exists, or sheet is in 'draft' or 'returned' state
        if (!sheet || sheet.status === 'draft' || sheet.status === 'returned') {
          const escKey = `${emp.id}_goal_not_submitted`;
          if (!existingEscMap.has(escKey)) {
            inserts.push({
              employee_id: emp.id,
              manager_id: emp.manager_id,
              sheet_id: sheet?.id || null,
              type: 'goal_not_submitted',
              days_overdue: daysOverdue,
              resolved: false
            });
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // Rule 2: 'approval_pending' (Submitted sheet past 5 days of submission)
    // -------------------------------------------------------------------------
    for (const sheet of (sheets || [])) {
      if (sheet.status === 'submitted' && sheet.submitted_at) {
        const submittedDate = new Date(sheet.submitted_at);
        const msSinceSubmission = now - submittedDate;
        const daysSubmitted = Math.floor(msSinceSubmission / (1000 * 60 * 60 * 24));

        if (daysSubmitted > 5) {
          const daysOverdue = daysSubmitted - 5;
          const emp = employeeMap[sheet.employee_id];
          const escKey = `${sheet.employee_id}_approval_pending`;

          if (emp && !existingEscMap.has(escKey)) {
            inserts.push({
              employee_id: sheet.employee_id,
              manager_id: emp.manager_id,
              sheet_id: sheet.id,
              type: 'approval_pending',
              days_overdue: daysOverdue,
              resolved: false
            });
          }
        }
      }
    }

    // 5. Perform batch inserts if there are any new escalations
    if (inserts.length > 0) {
      const { error: insertErr } = await adminSupabase
        .from('escalations')
        .insert(inserts);

      if (insertErr) throw new Error(`Escalation inserts failed: ${insertErr.message}`);
    }

    return NextResponse.json({
      success: true,
      message: `Escalation check complete. Registered ${inserts.length} new escalations.`,
      insertedCount: inserts.length
    }, { status: 200 });

  } catch (err) {
    console.error('Escalation Check Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
