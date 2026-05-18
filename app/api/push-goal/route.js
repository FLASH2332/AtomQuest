import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase';

export async function POST(request) {
  try {
    const supabase = await createServerSupabaseClient();
    const adminSupabase = createAdminClient();

    // Verify auth
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify role (admin or manager)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      cycleId,
      primaryOwner,
      recipients,
      thrustAreaId,
      title,
      description,
      uomType,
      target,
      targetDate,
      weightage,
      allUsers
    } = body;

    if (!cycleId || !primaryOwner || !recipients || !recipients.length || !allUsers) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Fetch sheets for all involved users using admin client (bypasses RLS)
    const { data: existingSheets, error: sheetsErr } = await adminSupabase
      .from('goal_sheets')
      .select('id, employee_id, status')
      .in('employee_id', allUsers)
      .eq('cycle_id', cycleId);
    
    if (sheetsErr) throw new Error(sheetsErr.message);

    const sheetMap = {};
    (existingSheets || []).forEach(s => sheetMap[s.employee_id] = s);

    // 2. Count goals per sheet to enforce max 8 goals
    const sheetIds = (existingSheets || []).map(s => s.id);
    let goalCounts = {};
    
    if (sheetIds.length > 0) {
      const { data: existingGoals, error: goalsErr } = await adminSupabase
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
          // fetch name for error message
          const { data: emp } = await adminSupabase.from('profiles').select('full_name').eq('id', empId).single();
          throw new Error(`Cannot push goal: ${emp?.full_name || 'An employee'} already has the maximum of 8 goals. Please return their sheet and ask them to remove a goal first.`);
        }
      }
    }

    // 3. Ensure all users have a sheet
    for (const empId of allUsers) {
      if (!sheetMap[empId]) {
        const { data: newSheet, error: insertSheetErr } = await adminSupabase
          .from('goal_sheets')
          .insert({ employee_id: empId, cycle_id: cycleId, status: 'draft' })
          .select('id, employee_id, status')
          .single();
        if (insertSheetErr) throw new Error(insertSheetErr.message);
        sheetMap[empId] = newSheet;
      }
    }

    // 4. Update status to 'returned' for any submitted/approved sheets
    const sheetsToReturn = Object.values(sheetMap).filter(s => s.status === 'submitted' || s.status === 'approved');
    if (sheetsToReturn.length > 0) {
      const sheetIdsToReturn = sheetsToReturn.map(s => s.id);
      
      const { error: updateSheetsErr } = await adminSupabase
        .from('goal_sheets')
        .update({ status: 'returned' })
        .in('id', sheetIdsToReturn);
      if (updateSheetsErr) throw new Error(updateSheetsErr.message);

      // If any of these sheets were approved, their goals are locked. We must unlock them so the employee can adjust weightages.
      const approvedSheets = sheetsToReturn.filter(s => s.status === 'approved').map(s => s.id);
      if (approvedSheets.length > 0) {
        const { error: unlockErr } = await adminSupabase
          .from('goals')
          .update({ is_locked: false })
          .in('sheet_id', approvedSheets);
        if (unlockErr) throw new Error(unlockErr.message);
      }
    }

    // 5. Insert Primary Goal
    const primaryPayload = {
      sheet_id: sheetMap[primaryOwner].id,
      thrust_area_id: thrustAreaId,
      title: title,
      description: description,
      uom_type: uomType,
      target: target,
      target_date: targetDate,
      weightage: Number(weightage),
      is_shared: true,
      parent_goal_id: null,
    };

    const { data: insertedPrimary, error: primaryErr } = await adminSupabase
      .from('goals')
      .insert(primaryPayload)
      .select('id')
      .single();
      
    if (primaryErr) throw new Error(primaryErr.message);

    // 6. Insert Copy Goals
    const copyPayloads = recipients.map(recipientId => ({
      sheet_id: sheetMap[recipientId].id,
      thrust_area_id: thrustAreaId,
      title: title,
      description: description,
      uom_type: uomType,
      target: target,
      target_date: targetDate,
      weightage: Number(weightage),
      is_shared: true,
      parent_goal_id: insertedPrimary.id,
    }));

    const { error: copiesErr } = await adminSupabase
      .from('goals')
      .insert(copyPayloads);
      
    if (copiesErr) throw new Error(copiesErr.message);

    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Push Goal Error:', err);
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 400 });
  }
}
