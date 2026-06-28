// leadday domain logic — ported verbatim from the tested src/leadday.js.
// Pure functions, source of truth (SPEC.md). Exposed as window.leadday.
(function (global) {
  const START_SOON_WINDOW = 3;
  const SPRINT_MAX = 120; // minutes
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // final_deadline minus lead_days calendar days.
  function autoDeadline(finalDeadline, leadDays) {
    return new Date(finalDeadline.getTime() - leadDays * MS_PER_DAY);
  }

  function urgency(autoDeadlineDate, today, status) {
    if (status === 'done') return 'DONE';
    const days = Math.round((autoDeadlineDate.getTime() - today.getTime()) / MS_PER_DAY);
    if (days < 0) return 'PAST_DUE';
    if (days === 0) return 'DUE_TODAY';
    if (days === 1) return 'DUE_TOMORROW';
    if (days <= START_SOON_WINDOW) return 'BETTER_START_SOON';
    return 'ON_TRACK';
  }

  // whole calendar days from today until the auto-deadline (signed).
  function daysLeft(autoDeadlineDate, today) {
    return Math.round((autoDeadlineDate.getTime() - today.getTime()) / MS_PER_DAY);
  }

  function sprintLoad(tasks) {
    const sums = new Map();
    for (const t of tasks) {
      sums.set(t.sprint, (sums.get(t.sprint) ?? 0) + t.estimated_minutes);
    }
    const result = {};
    for (const [sprint, sum] of sums) {
      result[sprint] = { sprint, sum, over: sum > SPRINT_MAX };
    }
    return result;
  }

  function calibration(doneTasks) {
    const groups = new Map();
    for (const t of doneTasks) {
      const key = t.template_task ?? t.sprint;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t.actual_minutes / t.estimated_minutes);
    }
    function multiplier(groupKey) {
      const ratios = groups.get(groupKey);
      if (!ratios || ratios.length === 0) return 1.0;
      return ratios.reduce((a, b) => a + b, 0) / ratios.length;
    }
    function suggestedEstimate(raw, groupKey) {
      return raw * multiplier(groupKey);
    }
    return { multiplier, suggestedEstimate };
  }

  function validateDeps(tasks) {
    const byName = new Map(tasks.map((t) => [t.name, t]));
    const violations = [];
    for (const b of tasks) {
      if (b.depends_on == null) continue;
      const a = byName.get(b.depends_on);
      if (!a) continue;
      if (!(a.lead_days > b.lead_days)) {
        violations.push({ task: b.name, dependsOn: a.name });
      }
    }
    return violations;
  }

  global.leadday = {
    START_SOON_WINDOW, SPRINT_MAX,
    autoDeadline, urgency, daysLeft, sprintLoad, calibration, validateDeps,
  };
})(window);
