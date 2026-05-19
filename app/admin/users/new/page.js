'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useToast } from '@/components/ToastProvider';

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="shrink-0">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
      </svg>
      {message}
    </p>
  );
}

function AtomIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true" className="text-indigo-400 animate-pulse">
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" transform="rotate(60 18 18)" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2" transform="rotate(120 18 18)" />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

export default function NewUserPage() {
  const router = useRouter();
  const supabase = createClient();
  const { showToast } = useToast();

  const [managers, setManagers] = useState([]);
  const [loadingManagers, setLoadingManagers] = useState(true);

  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('employee');
  const [department, setDepartment] = useState('');
  const [managerId, setManagerId] = useState('');

  // Validation & Submit states
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Load managers on mount
  useEffect(() => {
    async function fetchManagers() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, department')
          .eq('role', 'manager')
          .order('full_name');

        if (error) {
          console.error('Error fetching managers:', error);
          showToast('Failed to load managers directory.');
        } else {
          setManagers(data || []);
        }
      } catch (err) {
        console.error('Managers loading error:', err);
      } finally {
        setLoadingManagers(false);
      }
    }
    fetchManagers();
  }, [supabase]);

  // Form field validations
  const validateForm = () => {
    const errors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!fullName.trim()) {
      errors.fullName = 'Full name is required.';
    }

    if (!email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!emailRegex.test(email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    if (!role) {
      errors.role = 'Role selection is required.';
    }

    if (role === 'employee' && !managerId) {
      errors.managerId = 'An employee must be assigned to a manager.';
    }

    setFieldErrors(errors);
    const isValid = Object.keys(errors).length === 0;
    if (!isValid) {
      showToast('Please correct form errors.');
    }
    return isValid;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setSubmitError('');

    startTransition(async () => {
      try {
        const res = await fetch('/api/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            email: email.trim(),
            password: password,
            role: role,
            department: department.trim() || null,
            managerId: role === 'employee' ? managerId : null,
          }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data.error || 'Failed to register user.');
        }

        setSubmitSuccess(true);
        showToast('User created successfully and profile initialized!', 'success');
        
        // Wait 2 seconds to redirect so they can see the success state
        setTimeout(() => {
          router.push('/admin/dashboard');
        }, 2000);

      } catch (err) {
        console.error('Submit Error:', err);
        setSubmitError(err.message || 'An unexpected error occurred.');
        showToast(err.message || 'Failed to create new user account.');
        setIsSubmitting(false);
      }
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        
        {/* Breadcrumbs / Back button */}
        <button
          type="button"
          onClick={() => router.push('/admin/dashboard')}
          disabled={isSubmitting || submitSuccess}
          className="text-slate-500 hover:text-slate-300 text-xs mb-6 transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Admin Dashboard
        </button>

        {/* Page Header */}
        <div className="flex items-center gap-3 mb-8">
          <AtomIcon size={32} />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Create System User</h1>
            <p className="text-slate-400 text-sm mt-0.5">Register new employees, managers, or administrators.</p>
          </div>
        </div>

        {/* Global Submission Alerts */}
        {submitError && (
          <div role="alert" className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
            </svg>
            <span>{submitError}</span>
          </div>
        )}

        {submitSuccess && (
          <div role="status" className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            <svg className="w-4 h-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>User successfully registered! Redirecting to hub...</span>
          </div>
        )}

        {/* Form Container */}
        <form onSubmit={handleSubmit} noValidate className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6 md:p-8 shadow-2xl space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Full Name */}
            <div>
              <label htmlFor="fullName" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Full Name <span className="text-indigo-400">*</span>
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                disabled={isSubmitting || submitSuccess}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
              />
              <FieldError message={fieldErrors.fullName} />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Email Address <span className="text-indigo-400">*</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. rahul@atomquest.com"
                disabled={isSubmitting || submitSuccess}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
              />
              <FieldError message={fieldErrors.email} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Password <span className="text-indigo-400">*</span>
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                disabled={isSubmitting || submitSuccess}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
              />
              <FieldError message={fieldErrors.password} />
            </div>

            {/* Role dropdown */}
            <div>
              <label htmlFor="role" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Role Type <span className="text-indigo-400">*</span>
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  // Reset manager when switching away from employee
                  if (e.target.value !== 'employee') {
                    setManagerId('');
                  }
                }}
                disabled={isSubmitting || submitSuccess}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
              >
                <option value="employee">Employee (Goal sheet tracking)</option>
                <option value="manager">Manager (Team evaluation)</option>
                <option value="admin">Administrator (Core configuration)</option>
              </select>
              <FieldError message={fieldErrors.role} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Department */}
            <div>
              <label htmlFor="department" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Department <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                id="department"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Sales, Technology, HR"
                disabled={isSubmitting || submitSuccess}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
              />
            </div>

            {/* Manager selection - only when role is employee */}
            {role === 'employee' && (
              <div>
                <label htmlFor="manager" className="block text-sm font-semibold text-slate-300 mb-1.5">
                  Assigned Manager <span className="text-indigo-400">*</span>
                </label>
                <select
                  id="manager"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  disabled={isSubmitting || submitSuccess || loadingManagers}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:opacity-50"
                >
                  <option value="">— Select Manager —</option>
                  {managers.map((mgr) => (
                    <option key={mgr.id} value={mgr.id}>
                      {mgr.full_name} {mgr.department ? `(${mgr.department})` : ''}
                    </option>
                  ))}
                </select>
                {loadingManagers && (
                  <p className="text-slate-500 text-xs mt-1 animate-pulse">Loading manager accounts...</p>
                )}
                <FieldError message={fieldErrors.managerId} />
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => router.push('/admin/dashboard')}
              disabled={isSubmitting || submitSuccess}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-700/40 transition-all focus:outline-none disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || submitSuccess}
              className="px-8 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold text-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Spinner />
                  Registering User…
                </>
              ) : (
                'Create User'
              )}
            </button>
          </div>

        </form>

        <p className="text-center text-slate-600 text-xs mt-10">
          © {new Date().getFullYear()} AtomQuest · Internal use only
        </p>
      </div>
    </main>
  );
}
