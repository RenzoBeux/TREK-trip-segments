import { buildDayIndex, resolveAll } from '../../shared/drift';
import {
  MAP_CIRCLE_RADIUS_M,
  MAP_FEATURE_VERTEX_MAX,
  MAP_POLYLINE_OPACITY,
  MAP_POLYLINE_VERTEX_BUDGET,
  MAP_POLYLINE_WIDTH,
} from '../../shared/limits';
import { accommodationSpan, dedupeAccommodations } from '../../shared/filter';
import { safeLabel } from '../../shared/format';
import { allocateBudget, cleanPath, decimate, isFiniteLatLng } from '../geometry';
import type { Point } from '../geometry';
import { listSegments } from '../repo';
import { ensureSchema } from '../schema';
import type {
  HostAccommodation,
  HostDay,
  MapLayerContribution,
  MapLayerFeature,
  PluginContext,
} from '../../shared/host-types';
import { DEFAULT_MAP_LINE_MODE, coerceMapLineMode } from '../../shared/types';
import type { DayIndex, MapLineMode, SegmentView } from '../../shared/types';

/** Where the traveller sleeps, keyed by the 1-based position of the day that night follows. */
export type NightStops = ReadonlyMap<number, Point>;

/**
 * Map each night of the trip to the stay that covers it.
 *
 * A stay's `end_day_id` is its CHECK-OUT day (TREK's DayHeadPills marks it so),
 * so it covers the nights of days lo..hi-1; a same-day stay still counts for its
 * one day. Where two stays overlap, the one that started first wins (id as the
 * tiebreak), which keeps the result independent of the host's row order.
 */
export function buildNightStops(accommodations: readonly HostAccommodation[], idx: DayIndex): Map<number, Point> {
  const stays = dedupeAccommodations(accommodations)
    .map((stay) => ({ stay, span: accommodationSpan(stay, idx) }))
    .filter((s) => s.span !== null && isFiniteLatLng(s.stay.place_lat, s.stay.place_lng))
    .sort((a, b) => a.span!.lo - b.span!.lo || a.stay.id - b.stay.id);

  const nights = new Map<number, Point>();
  for (const { stay, span } of stays) {
    const lastNight = Math.max(span!.lo, span!.hi - 1);
    for (let pos = span!.lo; pos <= lastNight; pos++) {
      if (!nights.has(pos)) nights.set(pos, [stay.place_lat as number, stay.place_lng as number]);
    }
  }
  return nights;
}

/**
 * The stops of one leg, in visiting order, as raw coordinate pairs — each day's
 * planned stops followed by that night's stay, when there is one.
 *
 * Only the evening stay is added: the night before a day is the previous day's
 * evening, so inside a leg the line already leaves from the hotel each morning.
 * A stay that is also the day's last (or the next day's first) stop costs nothing,
 * because cleanPath collapses consecutive duplicates.
 */
function legPoints(days: readonly HostDay[], start: number, end: number, nights: NightStops): Array<[unknown, unknown]> {
  const raw: Array<[unknown, unknown]> = [];
  for (let pos = start; pos <= end; pos++) {
    const day = days[pos - 1];
    if (!day) continue;
    for (const assignment of day.assignments ?? []) {
      raw.push([assignment.place?.lat, assignment.place?.lng]);
    }
    const stay = nights.get(pos);
    if (stay) raw.push(stay);
  }
  return raw;
}

/**
 * One coloured line per leg, following its stops in visiting order.
 *
 * Everything is pre-clipped so the host can never refuse a feature: it drops an
 * oversized shape whole rather than truncating it, and its 8000-vertex budget is
 * a running total, so one long leg could otherwise erase every leg after it.
 * With at most 40 legs sharing 7800 vertices plus one vertex per fallback
 * circle, the total stays under the cap by construction.
 */
export function buildFeatures(
  views: readonly SegmentView[],
  days: readonly HostDay[],
  nights: NightStops = new Map(),
): MapLayerFeature[] {
  const live: Array<{ view: SegmentView; path: ReturnType<typeof cleanPath> }> = [];
  for (const view of views) {
    if (view.effStart === null || view.effEnd === null) continue;
    live.push({ view, path: cleanPath(legPoints(days, view.effStart, view.effEnd, nights)) });
  }

  const allowance = allocateBudget(
    live.map((l) => l.path.length),
    MAP_POLYLINE_VERTEX_BUDGET,
    MAP_FEATURE_VERTEX_MAX,
  );

  const features: MapLayerFeature[] = [];

  live.forEach(({ view, path }, i) => {
    const label = safeLabel(view.name, view.index).slice(0, 80);
    const points = decimate(path, allowance[i] ?? 0);

    if (points.length >= 2) {
      features.push({
        type: 'polyline',
        points,
        tone: view.tone,
        width: MAP_POLYLINE_WIDTH,
        opacity: MAP_POLYLINE_OPACITY,
        dash: 'solid',
        label,
      });
      return;
    }

    // A leg with a single located stop cannot be a line; mark it instead. Costs
    // one vertex against the host's budget.
    const only = path[0];
    if (only) {
      features.push({
        type: 'circle',
        center: only,
        radiusM: MAP_CIRCLE_RADIUS_M,
        tone: view.tone,
        opacity: MAP_POLYLINE_OPACITY,
        fill: true,
        label,
      });
    }
  });

  return features;
}

/**
 * The viewer's chosen map-line mode. Its own try/catch for the same reason as
 * day-tint's readTintMode: a transient settings failure should fall back to the
 * default, not fall through to getLayers' catch and erase every line.
 */
async function readMapLineMode(ctx: PluginContext): Promise<MapLineMode> {
  try {
    return coerceMapLineMode(await ctx.settings?.get('mapLines'));
  } catch {
    return DEFAULT_MAP_LINE_MODE;
  }
}

export async function getLayers(tripId: number, ctx: PluginContext): Promise<MapLayerContribution[]> {
  try {
    await ensureSchema(ctx);

    const rows = await listSegments(ctx, tripId);
    if (rows.length === 0) return [];

    const mode = await readMapLineMode(ctx);
    if (mode === 'off') return [];

    const [days, accommodations] = await Promise.all([
      ctx.trips.getDays(tripId),
      mode === 'with-stays' ? ctx.trips.getAccommodations(tripId) : Promise.resolve([]),
    ]);
    const idx = buildDayIndex(days);
    const features = buildFeatures(resolveAll(rows, idx), days, buildNightStops(accommodations, idx));
    if (features.length === 0) return [];

    return [{ id: 'segments', name: 'Trip segments', features }];
  } catch (err) {
    ctx.log.warn('mapLayerProvider failed', {
      tripId,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
