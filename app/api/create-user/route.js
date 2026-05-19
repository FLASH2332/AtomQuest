import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase';

export async function POST(request) {
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

    // 3. Extract & Validate Body Parameters
    const body = await request.json();
    const { fullName, email, password, role, department, managerId } = body;

    if (!fullName || !fullName.trim()) {
      return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
    }
    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Email address is required.' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long.' }, { status: 400 });
    }
    if (!role || !['employee', 'manager', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Invalid or missing role selection.' }, { status: 400 });
    }

    // 4. Create Service-Role Admin Client (Bypasses RLS strictly on Server-Side)
    const adminSupabase = createAdminClient();

    // 5. Create Auth User (Confirming email automatically)
    const { data: authUser, error: createUserErr } = await adminSupabase.auth.admin.createUser({
      email: email.trim(),
      password: password,
      email_confirm: true,
      user_metadata: { full_name: fullName.trim() }
    });

    if (createUserErr || !authUser?.user) {
      console.error('Auth User Creation Error:', createUserErr);
      return NextResponse.json({ error: createUserErr?.message || 'Failed to create system user account.' }, { status: 400 });
    }

    // 6. Create Profile Entry (Use Upsert to avoid unique constraint collisions or trigger overlap)
    const profilePayload = {
      id: authUser.user.id,
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      role: role,
      department: department?.trim() || null,
      manager_id: role === 'employee' ? (managerId || null) : null
    };

    const { error: insertProfileErr } = await adminSupabase
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' });

    if (insertProfileErr) {
      console.error('Profile Insertion Error (Rolling Back):', insertProfileErr);
      
      // Rollback newly created Auth user on profile insertion failure
      const { error: rollbackErr } = await adminSupabase.auth.admin.deleteUser(authUser.user.id);
      if (rollbackErr) {
        console.error('Fatal: Failed to rollback user deletion after profile insert error:', rollbackErr);
      }
      
      return NextResponse.json({ error: `User created, but profile mapping failed: ${insertProfileErr.message}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, userId: authUser.user.id });

  } catch (err) {
    console.error('Unhandled User Creation API Error:', err);
    return NextResponse.json({ error: err.message || 'An unexpected error occurred during user creation.' }, { status: 500 });
  }
}
