/**
 * @file lib/types.js
 * JSDoc type definitions that mirror the AtomQuest database schema.
 * Import these via @typedef references — no runtime code is exported.
 *
 * DB schema source of truth: AGENTS.md § 8
 */

// ---------------------------------------------------------------------------
// Enums (string literals)
// ---------------------------------------------------------------------------

/**
 * Role assigned to a user in the system.
 * Stored in profiles.role.
 * @typedef {'employee' | 'manager' | 'admin'} Role
 */

/**
 * Lifecycle status of a goal sheet.
 * @typedef {'draft' | 'submitted' | 'approved' | 'returned'} SheetStatus
 */

/**
 * Unit-of-measure type used to determine which progress score formula to apply.
 * @typedef {'min' | 'max' | 'timeline' | 'zero'} UomType
 */

/**
 * Check-in quarter identifier.
 * @typedef {'Q1' | 'Q2' | 'Q3' | 'Q4'} Quarter
 */

// ---------------------------------------------------------------------------
// Table: profiles
// Extends auth.users. One row per registered user.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Profile
 * @property {string}      id           - UUID, matches auth.users.id
 * @property {string}      full_name
 * @property {string}      email
 * @property {Role}        role
 * @property {string|null} manager_id   - UUID → profiles.id of this user's manager
 * @property {string|null} department
 * @property {string}      created_at   - ISO 8601 timestamp
 */

// ---------------------------------------------------------------------------
// Table: goal_cycles
// Admin-configured financial year cycles. Never hardcode dates — always read
// from this table (AGENTS.md § 6.5).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GoalCycle
 * @property {string}      id                 - UUID
 * @property {string}      name               - e.g. "FY 2025-26"
 * @property {string}      fy_start           - ISO date, financial year start
 * @property {string}      fy_end             - ISO date, financial year end
 * @property {string}      goal_setting_open  - ISO date, May 1 of that FY
 * @property {string}      q1_open            - ISO date, July 1
 * @property {string}      q2_open            - ISO date, October 1
 * @property {string}      q3_open            - ISO date, January 1
 * @property {string}      q4_open            - ISO date, March 1
 * @property {boolean}     is_active
 * @property {string}      created_at         - ISO 8601 timestamp
 */

// ---------------------------------------------------------------------------
// Table: thrust_areas
// Goal categories tied to a cycle.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ThrustArea
 * @property {string}      id         - UUID
 * @property {string}      cycle_id   - UUID → goal_cycles.id
 * @property {string}      name
 * @property {string|null} description
 * @property {string}      created_at - ISO 8601 timestamp
 */

// ---------------------------------------------------------------------------
// Table: goal_sheets
// One per employee per cycle. Unique on (employee_id, cycle_id).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GoalSheet
 * @property {string}      id          - UUID
 * @property {string}      employee_id - UUID → profiles.id
 * @property {string}      cycle_id    - UUID → goal_cycles.id
 * @property {SheetStatus} status      - lifecycle state
 * @property {string}      created_at  - ISO 8601 timestamp
 * @property {string}      updated_at  - ISO 8601 timestamp
 */

// ---------------------------------------------------------------------------
// Table: goals
// Individual goals inside a sheet.
// Constraints:
//   weightage >= 10 AND <= 100
//   uom_type IN ('min','max','timeline','zero')
//   Sum of weightage per sheet MUST equal 100 (enforced in UI + API)
//   Max 8 goals per sheet (enforced in UI + API)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Goal
 * @property {string}      id             - UUID
 * @property {string}      sheet_id       - UUID → goal_sheets.id
 * @property {string}      thrust_area_id - UUID → thrust_areas.id
 * @property {string}      title
 * @property {string|null} description
 * @property {number}      target         - numeric target value
 * @property {number}      weightage      - 10–100; sheet total must = 100
 * @property {UomType}     uom_type       - determines scoring formula
 * @property {boolean}     is_locked      - true after manager approves sheet
 * @property {boolean}     is_shared      - true if pushed from another owner
 * @property {string|null} parent_goal_id - UUID → goals.id of the original shared goal
 * @property {string}      created_at     - ISO 8601 timestamp
 * @property {string}      updated_at     - ISO 8601 timestamp
 */

// ---------------------------------------------------------------------------
// Table: achievements
// Quarterly actuals per goal. Unique on (goal_id, quarter).
// progress_score is always persisted — never kept only in component state.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Achievement
 * @property {string}      id             - UUID
 * @property {string}      goal_id        - UUID → goals.id
 * @property {Quarter}     quarter        - Q1 | Q2 | Q3 | Q4
 * @property {number}      actual_value   - actual achieved value
 * @property {string|null} completion_date - ISO date; used for 'timeline' UoM
 * @property {number}      progress_score  - computed via lib/scores.js; persisted to DB
 * @property {string}      created_at     - ISO 8601 timestamp
 * @property {string}      updated_at     - ISO 8601 timestamp
 */

// ---------------------------------------------------------------------------
// Table: checkins
// Manager quarterly comment per sheet. Unique on (sheet_id, quarter).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Checkin
 * @property {string}  id         - UUID
 * @property {string}  sheet_id   - UUID → goal_sheets.id
 * @property {string}  manager_id - UUID → profiles.id
 * @property {Quarter} quarter
 * @property {string}  comment
 * @property {string}  created_at - ISO 8601 timestamp
 * @property {string}  updated_at - ISO 8601 timestamp
 */

// ---------------------------------------------------------------------------
// Table: audit_logs
// Every post-lock change must be written here (AGENTS.md § 6.2).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AuditLog
 * @property {string} id          - UUID
 * @property {string} actor_id    - UUID → profiles.id (who made the change)
 * @property {string} goal_id     - UUID → goals.id (which goal was changed)
 * @property {string} field_name  - name of the column that changed
 * @property {*}      old_value   - previous value (stored as jsonb in DB)
 * @property {*}      new_value   - new value (stored as jsonb in DB)
 * @property {string} created_at  - ISO 8601 timestamp
 */

// This file contains only JSDoc — no runtime exports are needed.
export {};
