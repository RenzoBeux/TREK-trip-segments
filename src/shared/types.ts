import type { Tone } from './host-types';

/** A row exactly as it lives in our own SQLite table. */
export interface SegmentRow {
  id: number;
  trip_id: number;
  name: string;
  /** Canonical #RRGGBB used by this plugin and the day-tint provider. */
  color: string;
  /** Nearest legacy host tone for map layers and schedule banners. */
  tone: Tone;
  start_day: number;
  end_day: number;
  created_at: string;
  updated_at: string;
}

/** What the user is editing, before it has an id. */
export interface SegmentInput {
  name: string;
  color: string;
  start_day: number;
  end_day: number;
}

/**
 * `ok`          — the range fits the trip as it stands.
 * `clipped`     — it starts inside the trip but runs past the last day; we use
 *                 the clamped end everywhere and tell the user.
 * `out_of_range`— it starts past the last day, so it has no days at all. It is
 *                 greyed in the UI and contributes to NO hook.
 */
export type SegmentStatus = 'ok' | 'clipped' | 'out_of_range';

/** How much of the trip a leg contains. */
export interface SegmentCounts {
  places: number;
  bookings: number;
  stays: number;
}

/** A row resolved against the trip's current day list. */
export interface SegmentView extends SegmentRow {
  /** 0-based position in the sorted list — "leg 3 of 7". */
  index: number;
  status: SegmentStatus;
  /** Effective, clamped bounds. Null exactly when status is `out_of_range`. */
  effStart: number | null;
  effEnd: number | null;
  /** Number of days actually covered; 0 when out of range. */
  effLength: number;
  startDate: string | null;
  endDate: string | null;
  /** Present on the overview; omitted on the detail payload, which lists the real rows. */
  counts?: SegmentCounts;
}

/**
 * Positions are 1-based ordinals into the trip's day array — NOT `day_number`,
 * which develops gaps when a day is deleted, and not dates, which are nullable.
 */
export interface DayIndex {
  count: number;
  /** day id → 1-based position. */
  posByDayId: Map<number, number>;
  /** [position - 1] → day id. */
  dayIdByPos: number[];
  /** [position - 1] → ISO date or null. */
  dateByPos: Array<string | null>;
}

/** An inclusive `[from, to]` run of day positions. */
export type DayRange = [number, number];

export interface OverviewDay {
  id: number;
  /** 1-based ordinal — what the planner shows as "Day N". */
  pos: number;
  date: string | null;
  title: string | null;
  assignmentCount: number;
}

export interface OverviewTrip {
  id: number;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface OverviewPayload {
  trip: OverviewTrip;
  dayCount: number;
  days: OverviewDay[];
  segments: SegmentView[];
  /** Day ranges not covered by any leg. */
  uncovered: DayRange[];
  /** Things we could not place on the timeline at all, so the UI can say so. */
  unassigned: { bookings: number; stays: number };
}

export interface DetailPlace {
  name: string | null;
  time: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

export interface DetailDay {
  id: number;
  pos: number;
  date: string | null;
  title: string | null;
  places: DetailPlace[];
  notes: Array<{ text: string; time: string | null }>;
}

export interface DetailBooking {
  id: number;
  title: string;
  type: string | null;
  status: string | null;
  time: string | null;
  confirmation: string | null;
  fromPos: number;
  toPos: number;
  /** True when the booking also belongs to another leg — e.g. the train between two. */
  spansLegs: boolean;
}

export interface DetailStay {
  id: number;
  placeName: string | null;
  address: string | null;
  checkIn: string | null;
  checkOut: string | null;
  confirmation: string | null;
  fromPos: number;
  toPos: number;
  nights: number;
  /** Titles of every booking linked to this stay (a stay can have more than one). */
  bookingTitles: string[];
}

export interface DetailPayload {
  segment: SegmentView;
  dayCount: number;
  days: DetailDay[];
  bookings: DetailBooking[];
  stays: DetailStay[];
}

/**
 * Which regions of a day the tint hook paints, chosen per user in plugin settings.
 *
 * `full-day` uses the host's `color` shorthand, which `normalize()` spreads across
 * badge + header + activity server-side — identical output to naming all three and
 * a smaller payload. The others name regions explicitly.
 *
 * Every mode except `off` includes the badge, deliberately: mobile paints ONLY the
 * badge region, so a mode without it would be a silent no-op on phones.
 */
export type TintMode = 'full-day' | 'header-badge' | 'badge-only' | 'off';

/** What 1.2.0 shipped. Upgrades must look identical until the user chooses otherwise. */
export const DEFAULT_TINT_MODE: TintMode = 'header-badge';

/**
 * The stored value is an arbitrary string from the host's settings table. The host
 * filters writes to declared keys, but a value stored under an option a later
 * manifest removes survives, so never trust it — anything unrecognised, missing or
 * of the wrong type falls back to the default rather than to a louder mode.
 */
export function coerceTintMode(value: unknown): TintMode {
  return value === 'full-day' || value === 'header-badge' || value === 'badge-only' || value === 'off'
    ? value
    : DEFAULT_TINT_MODE;
}

/**
 * What the map line of each leg follows, chosen per user in plugin settings.
 *
 * `with-stays` threads each night's accommodation in after that day's stops, so a
 * leg based in one city with day trips out of it reads as spokes from the hotel
 * rather than a zig-zag between the day trips. `off` removes the layer entirely.
 */
export type MapLineMode = 'with-stays' | 'stops-only' | 'off';

export const DEFAULT_MAP_LINE_MODE: MapLineMode = 'with-stays';

/** Same distrust as coerceTintMode: anything unrecognised gets the default. */
export function coerceMapLineMode(value: unknown): MapLineMode {
  return value === 'with-stays' || value === 'stops-only' || value === 'off' ? value : DEFAULT_MAP_LINE_MODE;
}
