const { MIN_SAMPLE_JOBS, ZONE_HEALTH } = require('../config/marketplace');

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function classifyHealth(metrics) {
  if (!metrics || metrics.sample_size < MIN_SAMPLE_JOBS) return 'INSUFFICIENT';
  const strong = metrics.median_accept_minutes != null
    && metrics.median_accept_minutes < ZONE_HEALTH.median_accept_minutes_strong
    && metrics.accept_rate >= ZONE_HEALTH.accept_rate_strong
    && metrics.completion_rate >= ZONE_HEALTH.completion_rate_strong
    && metrics.dispute_rate <= ZONE_HEALTH.dispute_rate_strong_max;
  if (strong) return 'GREEN';
  const early = metrics.median_accept_minutes != null
    && metrics.median_accept_minutes < ZONE_HEALTH.median_accept_minutes_early
    && metrics.accept_rate >= ZONE_HEALTH.accept_rate_early
    && metrics.completion_rate >= ZONE_HEALTH.completion_rate_early
    && metrics.dispute_rate <= ZONE_HEALTH.dispute_rate_early_max;
  return early ? 'YELLOW' : 'RED';
}

function buildMetrics({ days, counts, disputedJobs, acceptMinutes }) {
  const sample = Number(counts?.jobs_paid || 0);
  const accepted = Number(counts?.jobs_accepted || 0);
  const completed = Number(counts?.jobs_completed || 0);
  const metrics = {
    window_days: days, sample_size: sample, jobs_created: Number(counts?.jobs_created || 0), jobs_paid: sample,
    jobs_accepted: accepted, jobs_completed: completed, jobs_cancelled: Number(counts?.jobs_cancelled || 0),
    jobs_disputed: Number(disputedJobs || 0), median_accept_minutes: median(acceptMinutes || []),
    accept_rate: sample ? accepted / sample : null, completion_rate: accepted ? completed / accepted : null,
    dispute_rate: accepted ? Number(disputedJobs || 0) / accepted : null,
  };
  metrics.color = classifyHealth(metrics);
  if (metrics.sample_size < MIN_SAMPLE_JOBS) metrics.status = 'Insufficient data';
  return metrics;
}

function rollupMetricSets(metricSets, days) {
  const sets = metricSets.filter(Boolean);
  const aggregate = sets.reduce((a, m) => ({
    jobs_created: a.jobs_created + m.jobs_created, jobs_paid: a.jobs_paid + m.jobs_paid,
    jobs_accepted: a.jobs_accepted + m.jobs_accepted, jobs_completed: a.jobs_completed + m.jobs_completed,
    jobs_cancelled: a.jobs_cancelled + m.jobs_cancelled, jobs_disputed: a.jobs_disputed + m.jobs_disputed,
  }), { jobs_created: 0, jobs_paid: 0, jobs_accepted: 0, jobs_completed: 0, jobs_cancelled: 0, jobs_disputed: 0 });
  const acceptValues = sets.map(m => m.median_accept_minutes).filter(Number.isFinite);
  const result = { window_days: days, sample_size: aggregate.jobs_paid, ...aggregate, median_accept_minutes: median(acceptValues),
    accept_rate: aggregate.jobs_paid ? aggregate.jobs_accepted / aggregate.jobs_paid : null,
    completion_rate: aggregate.jobs_accepted ? aggregate.jobs_completed / aggregate.jobs_accepted : null,
    dispute_rate: aggregate.jobs_accepted ? aggregate.jobs_disputed / aggregate.jobs_accepted : null };
  result.color = classifyHealth(result);
  if (result.sample_size < MIN_SAMPLE_JOBS) result.status = 'Insufficient data';
  return result;
}

module.exports = { median, classifyHealth, buildMetrics, rollupMetricSets };
