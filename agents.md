# AGENTS.md
Behavioral guidelines + project context for the AtomQuest Goal Tracking Portal.
Built on top of Karpathy's CLAUDE.md philosophy — read that first if present.

---

## 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If something is unclear, stop and ask. Don't guess at business logic.
- Business rules in Section 6 are non-negotiable. Never simplify them away.

## 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- Supabase client calls replace custom CRUD — don't write what Supabase already does.
- If you write 200 lines and it could be 50, rewrite it.

## 3. Surgical Changes
- Touch only what you must.
- Match existing style even if you'd do it differently.
- Every changed line should trace directly to the request.

## 4. Goal-Driven Execution
Transform tasks into verifiable goals. For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

---

## 5. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Database + Auth | Supabase (PostgreSQL + Supabase Auth) |
| Deployment | Vercel |

### Project Structure
```
/app
  /login              → login page (email+password, Supabase Auth)
  /dashboard          → role-aware redirect after login
  /employee           → employee-only pages
  /manager            → manager-only pages
  /admin              → admin-only pages
  /api                → Next.js API routes for custom logic
/components           → shared UI components
/lib
  supabase.js         → Supabase client (browser + server)
  scores.js           → progress score computation (see Section 6.3)
```

### Dev Commands
```bash
npm run dev           # start local dev server at localhost:3000
npm run build         # production build
npm run lint          # eslint check
```

### Environment Variables (never hardcode these)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # only in API routes, never client-side
```

---

## 6. Business Rules — NEVER violate or simplify these

These are eval criteria. Breaking them = failing the hackathon.

### 6.1 Goal Validation (enforce on client AND server)
- Total weightage across all goals for one employee MUST equal exactly 100%
- Minimum weightage per individual goal: 10%
- Maximum goals per employee per cycle: 8
- Validate before every save/submit. Show clear inline error messages.

### 6.2 Goal Lifecycle & Locking
```
draft → submitted → approved (locked)
                 ↘ returned (back to draft)
```
- Goals are LOCKED (`is_locked = true`) when manager approves the sheet
- Locked goals: employee cannot edit title, description, target, weightage, UoM
- Only Admin can unlock a goal (`is_locked = false`)
- Every change made after lock date MUST be written to `audit_logs` table
- Shared goals: recipients can only edit weightage — title and target are read-only always

### 6.3 Progress Score Formulas (implement in `/lib/scores.js`)
```typescript
// Min — higher achievement is better (e.g. Sales Revenue)
score_min = actual / target

// Max — lower achievement is better (e.g. TAT, Cost)
score_max = target / actual

// Timeline — date-based completion
score_timeline = completion_date <= deadline ? 1 : 0

// Zero — zero equals success (e.g. Safety incidents)
score_zero = actual === 0 ? 1 : 0
```
- Store computed score in `achievements.progress_score` on every save
- Never hardcode scores — always run through these formulas

### 6.4 Shared Goals
- Admin or manager pushes a goal to multiple employees
- Creates copies in each recipient's goal sheet with `is_shared = true` and `parent_goal_id` pointing to original
- When primary owner updates achievement → sync actual_value to all linked copies
- Recipients: weightage editable, title/target read-only

### 6.5 Check-in Windows (read from `goal_cycles` table, never hardcode dates)
| Period | Window Opens |
|---|---|
| Goal Setting | May 1 |
| Q1 Check-in | July 1 |
| Q2 Check-in | October 1 |
| Q3 Check-in | January 1 |
| Q4 / Annual | March 1 |

---

## 7. User Roles & Access Control

Role is stored in `profiles.role`. Read it from Supabase session after login.
Redirect unauthorized users — never just hide UI elements, check role server-side too.

| Page / Action | employee | manager | admin |
|---|---|---|---|
| Create/edit own goals | ✅ (draft only) | ❌ | ✅ |
| Submit goal sheet | ✅ | ❌ | ✅ |
| Approve / return sheet | ❌ | ✅ (own team) | ✅ |
| Inline edit goals during approval | ❌ | ✅ | ✅ |
| Log quarterly achievement | ✅ (own) | ❌ | ✅ |
| Add check-in comment | ❌ | ✅ (own team) | ✅ |
| View team dashboard | ❌ | ✅ (own team) | ✅ |
| Unlock goals | ❌ | ❌ | ✅ |
| Manage cycles & thrust areas | ❌ | ❌ | ✅ |
| View audit logs | ❌ | ❌ | ✅ |
| Export CSV report | ❌ | ✅ (own team) | ✅ |
| Push shared goals | ❌ | ✅ | ✅ |

---

## 8. Database Schema (source of truth)

```sql
profiles          -- extends auth.users; has role, manager_id, department
goal_cycles       -- admin-configured FY cycles with quarter open dates
thrust_areas      -- goal categories, linked to a cycle
goal_sheets       -- one per employee per cycle; status: draft/submitted/approved/returned
goals             -- individual goals in a sheet; has weightage, uom_type, is_locked, is_shared
achievements      -- quarterly actuals per goal; has progress_score
checkins          -- manager quarterly comment per sheet
audit_logs        -- all post-lock changes: who, what, when, old/new value as jsonb
```

### Key constraints (already enforced in DB, also enforce in UI)
- `goals.weightage` check: >= 10 and <= 100
- `goals.uom_type` check: one of 'min', 'max', 'timeline', 'zero'
- `goal_sheets` unique on (employee_id, cycle_id) — one sheet per person per cycle
- `achievements` unique on (goal_id, quarter)
- `checkins` unique on (sheet_id, quarter)

---

## 9. Demo Credentials (create these in Supabase Auth → Users)

| Role | Email | Password |
|---|---|---|
| Admin | admin@atomquest.com | Admin@123 |
| Manager | manager@atomquest.com | Manager@123 |
| Employee | employee@atomquest.com | Employee@123 |

After creating auth users, insert matching rows into `profiles` table with correct roles and set `employee.manager_id = manager's profile id`.

---

## 10. What NOT to do
- Never let an employee edit a locked goal (check `is_locked` before rendering edit UI)
- Never save a goal sheet where weightage sum ≠ 100
- Never expose another employee's data (RLS handles DB layer, also guard in UI)
- Never skip writing to `audit_logs` when a post-lock change happens
- Never hardcode cycle dates — always read from `goal_cycles` table
- Never use `SUPABASE_SERVICE_ROLE_KEY` in client-side code
- Never store computed progress scores in component state only — persist to DB

---

## 11. Debugging

- Always destructure both `data` and `error` from every Supabase query and `console.log('error:', error)` during development. Never ignore the error return. The network tab only shows HTTP status codes, not the actual PostgREST error message.
- The `error` object has `.message`, `.code`, `.hint`, and `.details` — all more useful than the HTTP 400/500 status alone.
- Use `.maybeSingle()` instead of `.single()` when a row may legitimately not exist — `.single()` throws on zero rows.
- Inline PostgREST joins (`table(col)`) require a foreign key declared in the DB schema. If a join causes a 400, replace it with a separate flat query and build a lookup map in JS.
