/**
 * The slice of TREK's plugin contract this plugin depends on, declared here
 * rather than imported from `trek-plugin-sdk`.
 *
 * History, because the original reason is gone: day-schedule, day-tint and
 * map-layer ALL first ship in TREK 4.0.0. No 3.x release accepted any of them,
 * and trek-plugin-sdk 1.6.0 is the first SDK to type them. Earlier comments in
 * this repo claimed 3.4.x accepted two of the three; it did not.
 *
 * What still justifies local types: the SDK's `Day` carries id/trip_id/date/
 * title and then an index signature, so `assignments` and `notes_items` — which
 * the read model is built on — come back as `unknown`, and this repo compiles
 * with `noUncheckedIndexedAccess`. So the contracts live here, transcribed from
 * the host controllers, with each limit cited where it is enforced. Those
 * controllers live in server/src/nest/plugins/contributions/ as of 4.0.0, and
 * constants are cited by NAME rather than line: the line numbers rotted between
 * 3.4.1 and 4.0.0 while the values did not.
 *
 * These types are advisory in both directions: the host re-validates every
 * value at runtime and silently drops whatever fails, which is exactly why the
 * caps are written down next to the fields they constrain.
 */

/** Legacy semantic colour used by host surfaces without a hex channel. */
export type Tone = 'default' | 'success' | 'warn' | 'danger';

export const TONES: readonly Tone[] = ['default', 'success', 'warn', 'danger'];

// ---------------------------------------------------------------------------
// Rows as the host hands them to a plugin
// ---------------------------------------------------------------------------

export interface HostTrip {
  id: number;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  [k: string]: unknown;
}

export interface HostPlace {
  id: number;
  name?: string | null;
  /** Nullable — a place can exist without coordinates. */
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  place_time?: string | null;
  end_time?: string | null;
  category?: { id: number; name?: string | null; color?: string | null; icon?: string | null } | null;
  [k: string]: unknown;
}

export interface HostAssignment {
  id: number;
  day_id: number;
  place_id: number;
  order_index: number;
  assignment_time?: string | null;
  assignment_end_time?: string | null;
  notes?: string | null;
  place: HostPlace;
  [k: string]: unknown;
}

export interface HostDayNote {
  id: number;
  day_id: number;
  text: string;
  time?: string | null;
  icon?: string | null;
  sort_order?: number | null;
  [k: string]: unknown;
}

/**
 * days.service.ts:175-229. Ordered by `day_number ASC`; `assignments` by
 * `order_index ASC, created_at ASC`; `notes_items` by `sort_order ASC`.
 *
 * `day_number` is deliberately absent from this interface. `days.remove()` is a
 * bare DELETE with no renumber (days.service.ts:273), so day_number develops
 * gaps, and the planner labels days by array index + 1 (DayPlanSidebar.tsx:1518)
 * — not by day_number. Everything in this plugin anchors to ORDINAL POSITION in
 * this array, so reading day_number would be a bug.
 */
export interface HostDay {
  id: number;
  trip_id: number;
  /** Nullable: a trip can be planned before its dates are decided. */
  date?: string | null;
  title?: string | null;
  assignments: HostAssignment[];
  notes_items: HostDayNote[];
  [k: string]: unknown;
}

/** reservations.service.ts:352-392. */
export interface HostReservation {
  id: number;
  trip_id: number;
  /** Start day. Null when the booking is not attached to a day yet. */
  day_id?: number | null;
  /** End day for a multi-day booking. */
  end_day_id?: number | null;
  title: string;
  type?: string | null;
  status?: string | null;
  reservation_time?: string | null;
  reservation_end_time?: string | null;
  confirmation_number?: string | null;
  location?: string | null;
  place_name?: string | null;
  /**
   * Non-null only when this booking is the auto-created partner of an
   * accommodation (days.service.ts:562). Such rows must be excluded from the
   * bookings list or every stay is counted twice.
   */
  accommodation_id?: number | null;
  /**
   * Layout only — written when a card is dragged within one day
   * (reservations.service.ts:544), incomplete and never pruned. Useful for
   * ordering inside a day, useless for "which days is this on".
   */
  day_positions?: Record<string, number> | null;
  [k: string]: unknown;
}

/**
 * days.service.ts:517-527. NOTE the LEFT JOIN onto reservations: a stay with two
 * linked bookings is returned TWICE, differing only in `reservation_title`.
 */
export interface HostAccommodation {
  id: number;
  trip_id: number;
  place_id?: number | null;
  /** Both NOT NULL in the schema. */
  start_day_id: number;
  end_day_id: number;
  check_in?: string | null;
  check_out?: string | null;
  confirmation?: string | null;
  notes?: string | null;
  place_name?: string | null;
  place_address?: string | null;
  place_lat?: number | null;
  place_lng?: number | null;
  reservation_title?: string | null;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface PluginUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface PluginRequest {
  method: string;
  path: string;
  /** Raw Express query — every value is a string or string[]. */
  query: Record<string, unknown>;
  /** Parsed body, or null. Never undefined. */
  body: unknown;
  /** `{}` on authenticated routes. */
  headers: Record<string, string>;
  user: PluginUser | null;
}

export interface PluginResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * plugins-proxy.controller.ts:86 — matched by EXACT STRING EQUALITY against the
 * path after `/api/plugins/<id>`. There is no `:param` support and a trailing
 * slash is significant. Variables go in the query string or the body.
 *
 * A handler that throws becomes HTTP 502, so handlers must return explicit
 * statuses instead of throwing.
 */
export interface PluginRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  /** Defaults to true. */
  auth?: boolean;
  handler(req: PluginRequest, ctx: PluginContext): Promise<PluginResponse>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface PluginContext {
  /**
   * Per-USER settings, resolved against the acting user.
   *
   * Optional only so test doubles can omit it — the host builds this channel for
   * every plugin unconditionally, and `settings.get` is in UNCONDITIONAL_METHODS
   * (protocol/envelope.ts), so no grant gates it and the permission table needs
   * no new row.
   *
   * PER-USER, and there is no way to read anything else: the RPC handler is
   * `settings.readOne(ctx.pluginId, ctx.actingUserId, key)` (host/rpc/db.rpc.ts),
   * which reads storage keyed (plugin_id, user_id). A field declared
   * `scope:'instance'` is stored where no plugin method can reach it — those
   * exist for host-consumed config such as OAuth client credentials. Declaring
   * one here would read `undefined` forever, with no error.
   *
   * It resolves inside a hook because the day-tint controller threads the viewer
   * through: `this.hooks.dayTints(id, tripId, userId)`
   * (contributions/day-tints.controller.ts). A userless dispatch — a notification
   * channel, say — would get undefined instead.
   */
  settings?: {
    get(key: string): Promise<unknown>;
  };
  readonly id: string;
  db: {
    /**
     * Single statement, executed with `.iterate()` — so `INSERT ... RETURNING *`
     * is a reader and does return rows. Max 100k rows.
     */
    query<T = unknown>(sql: string, ...args: unknown[]): Promise<T[]>;
    /**
     * Multiple statements allowed ONLY when called with no bind arguments.
     * Returns `{ changes }` — there is no lastInsertRowid.
     */
    exec(sql: string, ...args: unknown[]): Promise<{ changes: number }>;
    /**
     * Idempotent per id in production, but `trek-plugin dev` tracks applied ids
     * in memory and re-runs them on every restart — so the SQL must be
     * `IF NOT EXISTS`-safe. Multiple statements are supported.
     */
    migrate(id: string, sql: string): Promise<{ applied: boolean }>;
    /** Atomic batch, max 100 ops. A RETURNING op yields `{ rows }`. */
    tx(ops: Array<{ sql: string; args?: unknown[] }>): Promise<{
      results: Array<{ changes?: number; rows?: unknown[] }>;
    }>;
  };
  /**
   * Every one of these THROWS `ForbiddenResource` when the acting user cannot
   * access the trip (rpc-host.ts:1167) — none of them return null for that case.
   * Since a route throw becomes a 502, every call must be wrapped.
   */
  trips: {
    getById(tripId: number, asUserId?: number): Promise<HostTrip | null>;
    getDays(tripId: number): Promise<HostDay[]>;
    getReservations(tripId: number, asUserId?: number): Promise<HostReservation[]>;
    getAccommodations(tripId: number): Promise<HostAccommodation[]>;
  };
  ws: {
    /** Delivered to the frame as `plugin:<pluginId>:<event>` — names only, the payload is dropped. */
    broadcastToTrip(tripId: number, event: string, data: Record<string, unknown>): Promise<void>;
  };
  log: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

// ---------------------------------------------------------------------------
// Provider hooks. Every one runs on a 5s timeout; a throw or a timeout
// contributes nothing and is not surfaced anywhere. Caps `break` in the order
// of the array you return, so the most important entries must come first.
// ---------------------------------------------------------------------------

/** day-schedule.controller.ts:47-76. Max 60 items per provider. */
export interface DayScheduleContribution {
  /** ≤64 chars. Empty after emoji-strip ⇒ the item is dropped. */
  id: string;
  /** Must be a real day of the requested trip, or the item is dropped. */
  dayId: number;
  /** Must be a real JS integer — a numeric string is rejected. */
  assignmentId?: number;
  reservationId?: number;
  position?: 'start' | 'end';
  /** 1..1440. Summed into the day's route-time total, so omit it unless it is really a duration. */
  minutes?: number;
  /** ≤120 chars, emoji-stripped. Empty after stripping ⇒ the item is dropped. */
  label: string;
  tone?: Tone;
}

/**
 * map-layers.controller.ts:54-143. Coordinates are `[lat, lng]`, not GeoJSON
 * order. An oversized feature is dropped WHOLE rather than truncated, and one
 * out-of-range vertex invalidates the entire feature.
 */
export interface MapLayerFeature {
  type: 'polyline' | 'polygon' | 'circle';
  /** polyline ≥2, polygon ≥3, max 2000 per feature and 8000 across the provider. */
  points?: Array<[number, number]>;
  center?: [number, number];
  /** 1..2_000_000 metres. Required for a circle; a missing value drops it. */
  radiusM?: number;
  tone?: Tone;
  /** Clamped 1..8, default 3. */
  width?: number;
  dash?: 'solid' | 'dash' | 'dot';
  /** Clamped 0.05..1, default 0.8. */
  opacity?: number;
  fill?: boolean;
  /** ≤80 chars. A feature without one is not interactive on the map. */
  label?: string;
}

/** Max 4 layers, 150 features and 8000 vertices per provider. */
export interface MapLayerContribution {
  /** ≤64 chars, required. */
  id: string;
  /** ≤60 chars. */
  name?: string;
  features: MapLayerFeature[];
}

/** pdf-sections.controller.ts:44-72. Max 5 sections per provider. */
export interface PdfSection {
  /** ≤120 chars, required — an empty title drops the section. */
  title: string;
  /** ≤20 entries of ≤2000 chars. */
  paragraphs?: string[];
  /** Headers are required (≤8 of ≤60 chars) or the whole table is dropped. Rows: ≤50, cells ≤200, clipped to the header count. */
  table?: { headers: string[]; rows: string[][] };
}

/** trip-card-contributions.controller.ts:54-80. Max 4 badges per trip per provider. */
export interface TripCardContribution {
  /** Must satisfy `typeof tripId === 'number'` — a numeric string is dropped. */
  tripId: number;
  /** ≤64 chars, required. */
  id: string;
  /** ≤64 chars, required. */
  label: string;
  /** ≤256 chars. */
  value?: string;
  /** A lucide icon name, ≤40 chars. */
  icon?: string;
  tone?: Tone;
  /** http/https/mailto only, ≤2048 chars. */
  url?: string;
}

/**
 * A colour the host paints behind a day card in the Plan sidebar.
 *
 * Shipped in TREK 4.0.0 (#1743), where it landed from this plugin author's own
 * `feat/day-tint-provider` branch. Implementing a hook without the matching
 * grant stays safe: `providersOf` returns nothing for a hook it has no
 * permission mapping for, so it is inert rather than broken.
 *
 * `hook:day-tint-provider` is in the shipped manifest as of plugin 1.2.0.
 * Declaring a permission the host does not know is still fatal — install/manifest.ts
 * throws on an unknown string rather than degrading — which is exactly what the
 * manifest's `trek` range now guards.
 */
export interface DayTintContribution {
  /** Must be a day of the requested trip. */
  dayId: number;
  /**
   * Shorthand: tints every region NOT named below. Omit it and only the named
   * regions are tinted — which is how this plugin asks for the header and the
   * badge while leaving the activity list on a plain background.
   *
   * If nothing resolves for any region the host falls back to tinting all three
   * with `default`, so an entry can never paint nothing.
   */
  tone?: Tone;
  /** Arbitrary colour shorthand. Wins over `tone` when both are usable. */
  color?: string;
  /** The day-number badge, and the mobile day chip. */
  badgeTone?: Tone;
  badgeColor?: string;
  /** The day header row — number, title, date, cost. */
  headerTone?: Tone;
  headerColor?: string;
  /** The expanded activity list: places, bookings and transport. */
  activityTone?: Tone;
  activityColor?: string;
  /** Optional tooltip, ≤60 chars, emoji-stripped host-side. */
  label?: string;
}

export interface PluginHooks {
  dayScheduleProvider?: {
    getSchedule(tripId: number, ctx: PluginContext): Promise<DayScheduleContribution[]>;
  };
  mapLayerProvider?: {
    getLayers(tripId: number, ctx: PluginContext): Promise<MapLayerContribution[]>;
  };
  pdfSectionProvider?: {
    getSections(tripId: number, ctx: PluginContext): Promise<PdfSection[]>;
  };
  dayTintProvider?: {
    /**
     * One tint per day to colour. Bounded by the trip's day count, which is why
     * this exists at all: a per-day `dayScheduleProvider` item would hit that
     * hook's 60-item cap on any trip longer than two months.
     *
     * A day takes at most one tint — within one provider the FIRST entry for a
     * day wins, across providers the first granted one does.
     */
    getDayTints(tripId: number, ctx: PluginContext): Promise<DayTintContribution[]>;
  };
  tripCardProvider?: {
    /** Called ONCE with every visible, access-checked trip id (≤60). */
    getCards(tripIds: number[], ctx: PluginContext): Promise<TripCardContribution[]>;
  };

  /**
   * Plugin tools on TREK's own MCP server, since TREK 4.1.0. Gated by
   * `mcp:tools` rather than a `hook:*` permission.
   *
   * Publishing takes BOTH halves. The host advertises the intersection of the
   * signed manifest's `capabilities.mcpTools` (which carries the name,
   * description, schema and annotations) and this `tools` list (which only says
   * what this build implements). A name in one and not the other is ignored
   * without a log line (contributions/plugin-mcp-tools.service.ts).
   */
  mcpToolProvider?: McpToolProvider;
}

// ---------------------------------------------------------------------------
// MCP tools
// ---------------------------------------------------------------------------

/**
 * One entry of the manifest's `capabilities.mcpTools`, as install/manifest.ts
 * parses it. At most 8 per plugin; names match /^[a-z0-9_]{1,48}$/ and are
 * advertised as `plugin_<id>_<name>`.
 *
 * The inputSchema is enforced by the host before `callTool` runs, and refused at
 * install if it uses a keyword the host cannot enforce (mcp-tool-schema.ts):
 * no `$ref`, `oneOf` or `anyOf`, and no `pattern` that quantifies a repeating group.
 *
 * Annotations are CLAMPED against the plugin's grants: any grant beyond reads
 * and hooks (here, `ws:broadcast:trip`) forces `readOnlyHint` to false, so even
 * the read tools are advertised as non-read-only.
 */
export interface McpToolDeclaration {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** The MCP result shape the host passes through as-is, `isError` included. */
export interface McpTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * plugin-host-entry.ts `invoke.hook`, 15s timeout. `name` is the plugin-local
 * name, without the `plugin_<id>_` prefix. ctx is bound to the MCP caller, so
 * ctx.trips membership checks apply exactly as they do on a route.
 *
 * Any other JSON value is serialised into a text block; a throw becomes a tool
 * error whose message is clipped to 300 chars.
 */
export interface McpToolProvider {
  tools: string[];
  callTool(call: { name: string; args: unknown }, ctx: PluginContext): Promise<unknown>;
}

export interface PluginDefinition {
  onLoad?(ctx: PluginContext): Promise<void> | void;
  routes?: PluginRoute[];
  hooks?: PluginHooks;
}
