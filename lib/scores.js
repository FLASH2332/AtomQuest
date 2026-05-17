/**
 * @file lib/scores.js
 * Progress score formulas for AtomQuest goal achievements.
 *
 * Source of truth: AGENTS.md § 6.3
 *
 * Rules:
 * - Every formula returns a numeric score. Scores are NOT capped by default;
 *   over-achievement is represented as > 1 for min/max types.
 * - Store the result in achievements.progress_score on every save — never
 *   keep it only in component state.
 * - Never hardcode scores. Always call computeScore() or the individual
 *   formula functions.
 */

// ---------------------------------------------------------------------------
// Individual formula functions
// ---------------------------------------------------------------------------

/**
 * Min formula — higher achievement is better (e.g. Sales Revenue).
 * score = actual / target
 *
 * @param {number} actual  - achieved value
 * @param {number} target  - target value
 * @returns {number} progress score
 * @throws {Error} if target is zero (division by zero)
 */
export function scoreMin(actual, target) {
  if (target === 0) throw new Error('scoreMin: target cannot be zero.');
  return actual / target;
}

/**
 * Max formula — lower achievement is better (e.g. TAT, Cost).
 * score = target / actual
 *
 * @param {number} actual  - achieved value
 * @param {number} target  - target value
 * @returns {number} progress score
 * @throws {Error} if actual is zero (division by zero)
 */
export function scoreMax(actual, target) {
  if (actual === 0) throw new Error('scoreMax: actual cannot be zero.');
  return target / actual;
}

/**
 * Timeline formula — date-based completion.
 * score = 1 if completed on or before deadline, else 0.
 *
 * @param {string|Date} completionDate - actual completion date (ISO string or Date)
 * @param {string|Date} deadline       - target deadline (ISO string or Date)
 * @returns {0 | 1} 1 if on time, 0 if late
 */
export function scoreTimeline(completionDate, deadline) {
  const completed = new Date(completionDate);
  const due = new Date(deadline);

  if (isNaN(completed.getTime())) {
    throw new Error('scoreTimeline: completionDate is not a valid date.');
  }
  if (isNaN(due.getTime())) {
    throw new Error('scoreTimeline: deadline is not a valid date.');
  }

  return completed <= due ? 1 : 0;
}

/**
 * Zero formula — zero equals success (e.g. Safety incidents).
 * score = 1 if actual === 0, else 0.
 *
 * @param {number} actual - achieved value
 * @returns {0 | 1} 1 if zero incidents, 0 otherwise
 */
export function scoreZero(actual) {
  return actual === 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

/**
 * Computes the progress score for a goal achievement based on its UoM type.
 * Use this as the single entry-point so callers don't switch on uom_type.
 *
 * For 'timeline', pass completionDate as `actual` and deadline as `target`.
 *
 * @param {import('./types.js').UomType} uomType
 * @param {number|string|Date}           actual   - achieved value or completion date
 * @param {number|string|Date}           target   - target value or deadline
 * @returns {number} computed progress score
 * @throws {Error} if uomType is unrecognised or inputs are invalid
 *
 * @example
 * // Sales revenue: achieved 120, target 100 → score 1.2
 * computeScore('min', 120, 100);
 *
 * @example
 * // Cost target 50, actual 60 → score 0.833
 * computeScore('max', 60, 50);
 *
 * @example
 * // Completed 2025-06-28, deadline 2025-06-30 → score 1
 * computeScore('timeline', '2025-06-28', '2025-06-30');
 *
 * @example
 * // Safety incidents: 0 → score 1
 * computeScore('zero', 0, null);
 */
export function computeScore(uomType, actual, target) {
  switch (uomType) {
    case 'min':
      return scoreMin(Number(actual), Number(target));

    case 'max':
      return scoreMax(Number(actual), Number(target));

    case 'timeline':
      // actual = completionDate, target = deadline
      return scoreTimeline(actual, target);

    case 'zero':
      return scoreZero(Number(actual));

    default:
      throw new Error(
        `computeScore: unknown uom_type "${uomType}". ` +
          "Expected one of: 'min', 'max', 'timeline', 'zero'."
      );
  }
}
