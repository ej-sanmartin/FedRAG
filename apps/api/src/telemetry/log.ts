export interface RequestTelemetryEvent {
  correlationId: string;
  guardrailId?: string;
  isCompliance: boolean;
  blockedByGuardrail: boolean;
  topicHits: string[];
  piiEntitiesDetected: number;
  kbDegraded: boolean;
  retryCountKb: number;
  retryCountInvoke: number;
  latencyMsTotal: number;
  latencyMsKb?: number;
  latencyMsInvoke?: number;
}

export interface WeeklyCounterSummary {
  guardrail_id: string;
  week_start: string;
  total_requests: number;
  blocked_requests: number;
  compliance_requests: number;
  blocked_compliance_requests: number;
  pii_entities_detected: number;
  kb_degraded_count: number;
  topic_hits: Record<string, number>;
}

const MAX_TRACKED_WEEKS = 12;

function getIsoWeekStart(date: Date): string {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = utcDate.getUTCDay();
  const diff = (day + 6) % 7; // Convert so Monday is start of week
  utcDate.setUTCDate(utcDate.getUTCDate() - diff);
  return utcDate.toISOString().slice(0, 10);
}

function cloneTopicCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts));
}

export class WeeklyTelemetryAggregator {
  private readonly counters = new Map<string, WeeklyCounterSummary>();

  record(event: RequestTelemetryEvent, timestamp = new Date()): void {
    const guardrailId = event.guardrailId ?? "unknown";
    const weekStart = getIsoWeekStart(timestamp);
    const key = `${guardrailId}::${weekStart}`;

    let summary = this.counters.get(key);
    if (!summary) {
      summary = {
        guardrail_id: guardrailId,
        week_start: weekStart,
        total_requests: 0,
        blocked_requests: 0,
        compliance_requests: 0,
        blocked_compliance_requests: 0,
        pii_entities_detected: 0,
        kb_degraded_count: 0,
        topic_hits: {},
      };
      this.counters.set(key, summary);
    }

    summary.total_requests += 1;
    if (event.blockedByGuardrail) {
      summary.blocked_requests += 1;
      if (event.isCompliance) {
        summary.blocked_compliance_requests += 1;
      }
    }
    if (event.isCompliance) {
      summary.compliance_requests += 1;
    }
    summary.pii_entities_detected += Math.max(0, event.piiEntitiesDetected);
    if (event.kbDegraded) {
      summary.kb_degraded_count += 1;
    }

    for (const topic of event.topicHits) {
      const normalized = topic.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      summary.topic_hits[normalized] = (summary.topic_hits[normalized] || 0) + 1;
    }

    this.pruneOldEntries(timestamp);
  }

  snapshotFor(guardrailId: string): WeeklyCounterSummary[] {
    const targetId = guardrailId || "unknown";
    return Array.from(this.counters.values())
      .filter((summary) => summary.guardrail_id === targetId)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .map((summary) => ({
        ...summary,
        topic_hits: cloneTopicCounts(summary.topic_hits),
      }));
  }

  reset(): void {
    this.counters.clear();
  }

  private pruneOldEntries(reference: Date): void {
    const threshold = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate())
    );
    threshold.setUTCDate(threshold.getUTCDate() - MAX_TRACKED_WEEKS * 7);

    for (const [key, summary] of this.counters.entries()) {
      const weekDate = new Date(summary.week_start + "T00:00:00Z");
      if (weekDate < threshold) {
        this.counters.delete(key);
      }
    }
  }
}

const aggregator = new WeeklyTelemetryAggregator();

export function emitRequestTelemetry(event: RequestTelemetryEvent): void {
  aggregator.record(event);

  const payload = {
    event_type: "request_telemetry" as const,
    timestamp: new Date().toISOString(),
    correlation_id: event.correlationId,
    guardrail_id: event.guardrailId ?? null,
    blocked_by_guardrail: event.blockedByGuardrail,
    is_compliance: event.isCompliance,
    topic_hits: [
      ...new Set(event.topicHits.map((topic) => topic.trim().toLowerCase()).filter(Boolean)),
    ],
    pii_entities_detected: event.piiEntitiesDetected,
    kb_degraded: event.kbDegraded,
    retry_count_kb: event.retryCountKb,
    retry_count_invoke: event.retryCountInvoke,
    latency_ms_total: event.latencyMsTotal,
    latency_ms_kb: event.latencyMsKb ?? null,
    latency_ms_invoke: event.latencyMsInvoke ?? null,
    weekly_counters: aggregator.snapshotFor(event.guardrailId ?? "unknown"),
  } satisfies Record<string, unknown>;

  console.log(JSON.stringify(payload));
}

export function resetTelemetryAggregates(): void {
  aggregator.reset();
}
