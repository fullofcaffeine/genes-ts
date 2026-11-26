import type { DevelopmentEvent, JsonValue } from "./types.js";

/**
 * Time statistics of one kind of feedback, in milliseconds.
 *
 * `medianMs` is the middle value (the mean of the two middle values for an
 * even count); `p95Ms` is the nearest-rank 95th percentile.
 */
export interface TimingStatistics {
  readonly count: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

/**
 * The feedback of one build of the module-first path: the edit of
 * `revision`, what the build showed first, and when.
 *
 * `previewMs` and `acceptedMs` are measured from the `inputs-changed` event
 * of `revision` (the session's observation of the save, not the editor's
 * write) to the `preview-generated` event and to the first
 * `generation-accepted` event whose revision is `revision` or later.
 */
export interface PreviewTimingRow {
  readonly revision: number;
  /** The previewed or refused module; null when the session found none. */
  readonly module: string | null;
  readonly outcome: "preview" | "refused";
  /** The refusal code of a refused build, else null. */
  readonly code: string | null;
  readonly previewMs: number | null;
  readonly acceptedMs: number | null;
  /**
   * For a preview: true after `preview-confirmed`, false after
   * `preview-corrected`, null while neither came. Null for a refusal.
   */
  readonly confirmed: boolean | null;
}

/** The result of `summarizePreviewTimings`. */
export interface PreviewTimingSummary {
  readonly rows: readonly PreviewTimingRow[];
  readonly previews: number;
  readonly refusals: number;
  /** `previews / rows.length`, or 0 without rows. */
  readonly previewShare: number;
  /** `preview-corrected` events with `cause: "differs"` (Genes defects). */
  readonly differences: number;
  /** Over the rows with a preview; null without one. */
  readonly timeToPreview: TimingStatistics | null;
  /** Over every row with an accepted generation; null without one. */
  readonly timeToAcceptance: TimingStatistics | null;
}

/**
 * Returns the statistics of a list of durations, or null when it is empty.
 */
function statistics(values: readonly number[]): TimingStatistics | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
  return Object.freeze({
    count: sorted.length,
    medianMs: median,
    p95Ms: sorted[rank - 1]!,
    maxMs: sorted.at(-1)!,
  });
}

/**
 * Measures the module-first path from the events of one development
 * session: for each build that showed a preview or refused one, the time
 * to the preview against the time to the accepted generation.
 *
 * Why: the module-first path is worth its cost only when a preview comes
 * much sooner than the accepted generation, and only when it is the common
 * case. A host or a benchmark can call this on the events it recorded,
 * instead of matching log lines. Example: a benchmark makes 30 edits,
 * records every event, and prints `timeToPreview.medianMs`,
 * `timeToAcceptance.medianMs` and `previewShare`.
 *
 * Limits: the times start at the session's `inputs-changed` event, so the
 * time from the editor's write to the watcher's event is not in them; a
 * benchmark adds it from its own clock. A build that merged several saves
 * is one row, keyed by the newest revision.
 */
export function summarizePreviewTimings(
  events: readonly DevelopmentEvent<JsonValue>[],
): PreviewTimingSummary {
  const changedAt = new Map<number, number>();
  const rows: Array<{
    revision: number;
    module: string | null;
    outcome: "preview" | "refused";
    code: string | null;
    previewAt: number | null;
    acceptedAt: number | null;
    confirmed: boolean | null;
  }> = [];
  let differences = 0;
  for (const record of events) {
    const event = record.event;
    switch (event.kind) {
      case "inputs-changed":
        changedAt.set(event.revision, record.at);
        break;
      case "preview-generated":
        rows.push({
          revision: event.revision,
          module: event.module,
          outcome: "preview",
          code: null,
          previewAt: record.at,
          acceptedAt: null,
          confirmed: null,
        });
        break;
      case "preview-refused":
        rows.push({
          revision: event.revision,
          module: event.module,
          outcome: "refused",
          code: event.code,
          previewAt: null,
          acceptedAt: null,
          confirmed: null,
        });
        break;
      case "generation-accepted":
        for (const row of rows) {
          if (row.acceptedAt === null && row.revision <= event.accepted.revision) {
            row.acceptedAt = record.at;
          }
        }
        break;
      case "preview-confirmed":
      case "preview-corrected": {
        if (event.kind === "preview-corrected" && event.cause === "differs") {
          differences += 1;
        }
        const row = rows.find(
          (candidate) =>
            candidate.outcome === "preview" &&
            candidate.revision === event.revision &&
            candidate.module === event.module,
        );
        if (row !== undefined) row.confirmed = event.kind === "preview-confirmed";
        break;
      }
      default:
        break;
    }
  }
  const finished = rows.map((row) => {
    const start = changedAt.get(row.revision);
    const since = (at: number | null): number | null =>
      at === null || start === undefined ? null : at - start;
    return Object.freeze({
      revision: row.revision,
      module: row.module,
      outcome: row.outcome,
      code: row.code,
      previewMs: since(row.previewAt),
      acceptedMs: since(row.acceptedAt),
      confirmed: row.confirmed,
    });
  });
  const previews = finished.filter((row) => row.outcome === "preview").length;
  return Object.freeze({
    rows: Object.freeze(finished),
    previews,
    refusals: finished.length - previews,
    previewShare: finished.length === 0 ? 0 : previews / finished.length,
    differences,
    timeToPreview: statistics(
      finished.flatMap((row) => (row.previewMs === null ? [] : [row.previewMs])),
    ),
    timeToAcceptance: statistics(
      finished.flatMap((row) => (row.acceptedMs === null ? [] : [row.acceptedMs])),
    ),
  });
}
