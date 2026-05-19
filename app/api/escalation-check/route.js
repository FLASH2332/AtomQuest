import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase';
import { Resend } from 'resend';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    // 1. Verify Authentication
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized: Please log in.' }, { status: 401 });
    }

    // 2. Verify Caller has Admin role
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admins only.' }, { status: 403 });
    }

    // Admin client is required to bypass RLS policies and retrieve organization-wide state
    const adminSupabase = createAdminClient();
    const resend = new Resend(process.env.RESEND_API_KEY);

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

    // 2. Fetch all profiles to build lookup mapping (including emails)
    const { data: allProfiles, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, full_name, email, manager_id, role');

    if (profErr) throw new Error(`Profiles fetch failed: ${profErr.message}`);

    const profileMap = {};
    const employees = [];
    (allProfiles || []).forEach(p => {
      profileMap[p.id] = p;
      if (p.role === 'employee') {
        employees.push(p);
      }
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
          const emp = profileMap[sheet.employee_id];
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

      // 6. Send email notifications using Resend
      if (process.env.RESEND_API_KEY) {
        for (const esc of inserts) {
          try {
            if (esc.type === 'goal_not_submitted') {
              const emp = profileMap[esc.employee_id];
              if (emp && emp.email) {
                await resend.emails.send({
                  from: 'onboarding@resend.dev',
                  to: emp.email,
                  subject: 'Action Required — Goals Not Submitted',
                  text: `Hi ${emp.full_name},\n\nThis is an automated system notification. Please submit your goals for the active goal cycle (${activeCycle.name || 'current cycle'}) as soon as possible.\n\nThank you,\nAtomQuest Team`,
                });
              }
            } else if (esc.type === 'approval_pending') {
              const emp = profileMap[esc.employee_id];
              const manager = profileMap[esc.manager_id];
              if (manager && manager.email) {
                await resend.emails.send({
                  from: 'onboarding@resend.dev',
                  to: manager.email,
                  subject: 'Action Required — Goal Sheet Awaiting Approval',
                  text: `Hi ${manager.full_name},\n\nThis is an automated system notification. The goal sheet submitted by ${emp?.full_name || 'an employee'} has been awaiting your approval for more than 5 days. Please review and approve it at your earliest convenience.\n\nThank you,\nAtomQuest Team`,
                });
              }
            }
          } catch (emailErr) {
            console.error('Failed to send email escalation notification:', emailErr.message);
          }
        }
      }
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
