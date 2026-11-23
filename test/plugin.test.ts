import { describe, expect, it } from 'vitest';
import { createMockHost } from 'trek-plugin-sdk/testing';
import { HOOK_PERMISSION, KNOWN_PERMISSIONS } from 'trek-plugin-sdk';
import manifest from '../trek-plugin.json';
import plugin from '../src/server/index';
import { SQL_INSERT_IF_FREE, SQL_LIST } from '../src/server/repo';
import { mcpToolDeclarations } from '../src/server/mcp-tools';
import { makeDays } from './helpers';

describe('manifest and code agree', () => {
  it('grants a permission for every hook it implements', () => {
    const granted = new Set<string>(manifest.permissions);
    const gaps = Object.keys(plugin.hooks ?? {})
      .filter((hook) => !granted.has(HOOK_PERMISSION[hook] ?? `hook:UNKNOWN(${hook})`))
      .map((hook) => `${hook} needs ${HOOK_PERMISSION[hook] ?? '???'}`);

    // An implemented-but-ungranted hook installs, activates, and then silently
    // never runs — providersOf() drops it with no error anywhere.
    expect(gaps).toEqual([]);
  });

  it('knows the permission name of every hook it implements', () => {
    for (const hook of Object.keys(plugin.hooks ?? {})) {
      expect(HOOK_PERMISSION[hook], `no permission mapped for ${hook}`).toBeDefined();
    }
  });

  /**
   * The one that protects installs everywhere: declaring a permission the host
   * does not know is fatal, not a graceful degradation — install/manifest.ts
   * throws and the plugin never installs. The manifest's `trek` range is what
   * keeps this honest, so this asserts against the SDK pinned to that range.
   */
  it('never ships a permission outside the TREK line it targets', () => {
    for (const permission of manifest.permissions) {
      expect(KNOWN_PERMISSIONS, `${permission} is not a permission the targeted TREK knows`).toContain(permission);
    }
  });

  /**
   * scope MUST be literally 'user'. The server coerces anything else to
   * 'instance' (install/manifest.ts), and an instance-scoped value is stored
   * where ctx.settings.get cannot reach it — the field would render, accept a
   * value, and read undefined forever with no error.
   */
  it('declares the tint-mode setting as a per-user select', () => {
    const field = manifest.settings?.find((s) => s.key === 'tintMode');

    expect(field).toBeDefined();
    expect(field?.scope).toBe('user');
    expect(field?.input_type).toBe('select');
    expect(field?.options?.map((o) => o.value)).toEqual(['full-day', 'header-badge', 'badge-only', 'off']);
  });

  it('declares the map-lines setting as a per-user select', () => {
    const field = manifest.settings?.find((s) => s.key === 'mapLines');

    expect(field).toBeDefined();
    expect(field?.scope).toBe('user');
    expect(field?.input_type).toBe('select');
    expect(field?.options?.map((o) => o.value)).toEqual(['with-stays', 'stops-only', 'off']);
  });

  it('declares db:own and db:read:trips, which every route depends on', () => {
    expect(manifest.permissions).toContain('db:own');
    expect(manifest.permissions).toContain('db:read:trips');
    expect(manifest.permissions).toContain('ws:broadcast:trip');
  });

  it('uses flat route paths, because matching is exact string equality', () => {
    for (const route of plugin.routes ?? []) {
      expect(route.path.startsWith('/')).toBe(true);
      expect(route.path).not.toMatch(/:/); // no `:param` support in the proxy
      expect(route.path).not.toMatch(/\/$/); // a trailing slash would never match
      expect(route.auth).not.toBe(false);
    }
  });

  it('documents every permission verbatim in the README, as the registry requires', async () => {
    const readme = await import('node:fs').then((fs) => fs.readFileSync('README.md', 'utf8'));
    for (const permission of manifest.permissions) {
      expect(readme, `README is missing ${permission}`).toContain(permission);
    }
  });
});

/**
 * The three hooks TREK 4 unlocked, driven end to end.
 *
 * test/hooks.test.ts covers the pure builders; everything around them — the
 * ensureSchema -> listSegments -> getDays -> build chain, and the catch that
 * turns a failure into an empty contribution rather than a broken day plan —
 * had no coverage at all. That is exactly the seam the dormancy hid in, so it
 * is the seam worth guarding.
 *
 * `driver.hook()` enforces the grant the way the host does: TREK skips an
 * ungranted plugin SILENTLY, so a hook that is implemented but not declared is
 * invisible in production and green in a builder-only unit test. Before SDK
 * 1.6.0 these assertions could not exist -- 1.5.0's HOOK_PERMISSION knew none of
 * these three, so the lookup came back undefined and nothing was enforced.
 */
const SEGMENTS = [
    { id: 1, trip_id: 1, name: 'Tokyo', color: '#4F46E5', tone: 'default', start_day: 1, end_day: 3, created_at: 'x', updated_at: 'x' },
    { id: 2, trip_id: 1, name: 'Kyoto', color: '#059669', tone: 'success', start_day: 5, end_day: 8, created_at: 'x', updated_at: 'x' },
];

describe('provider hooks the host can actually reach', () => {
  const withSegments = () => hostFor([1], { [SQL_LIST]: SEGMENTS });

  it('tints every day of every leg, in that leg\'s own colour', async () => {
    const driver = withSegments().run(asSdkPlugin(plugin));

    const tints = await driver.hook<Array<Record<string, unknown>>>('dayTintProvider', 'getDayTints', 1);

    // 3 days of Tokyo + 4 of Kyoto; the gap at day 4 belongs to no leg.
    expect(tints).toHaveLength(7);
    expect(tints[0]).toMatchObject({ headerColor: '#4F46E5', badgeColor: '#4F46E5', label: 'Tokyo' });
    // Deliberately NOT the `color` shorthand, which would wash the activity list.
    expect(tints[0]).not.toHaveProperty('color');
  });

  it('puts a banner where each leg begins and ends', async () => {
    const driver = withSegments().run(asSdkPlugin(plugin));

    const items = await driver.hook<Array<Record<string, unknown>>>('dayScheduleProvider', 'getSchedule', 1);

    expect(items.length).toBeGreaterThan(0);
    // Every row anchors to a real day of the trip and declares sane minutes;
    // the host drops anything outside 1..1440 or off the trip's own day list.
    for (const item of items) {
      expect(typeof item.dayId).toBe('number');
    }
  });

  it('contributes map layers within the four-layer budget the host allows', async () => {
    const driver = withSegments().run(asSdkPlugin(plugin));

    const layers = await driver.hook<unknown[]>('mapLayerProvider', 'getLayers', 1);

    expect(Array.isArray(layers)).toBe(true);
    expect(layers.length).toBeLessThanOrEqual(4);
  });

  it('contributes nothing at all for a trip with no legs', async () => {
    const driver = hostFor([1], { [SQL_LIST]: [] }).run(asSdkPlugin(plugin));

    expect(await driver.hook('dayTintProvider', 'getDayTints', 1)).toEqual([]);
    expect(await driver.hook('dayScheduleProvider', 'getSchedule', 1)).toEqual([]);
    expect(await driver.hook('mapLayerProvider', 'getLayers', 1)).toEqual([]);
  });

  /**
   * End to end through the settings channel.
   *
   * `actingUserId` AND `userSettings` must BOTH be set: the mock builds its ctx
   * from the acting user, and settings.get resolves to undefined without one —
   * so omitting it would leave a test that passes while proving nothing.
   */
  describe('the day-tint mode setting', () => {
    const hostWith = (userSettings: Record<string, unknown>) =>
      createMockHost({
        actingUserId: 1,
        grants: manifest.permissions,
        userSettings,
        trips: {
          1: {
            members: [1],
            data: { id: 1, title: 'Japan', start_date: '2026-04-10', end_date: '2026-04-21' },
            days: makeDays(12, { startDate: '2026-04-10' }),
            reservations: [],
            accommodations: [],
          },
        },
        queryResults: { [SQL_LIST]: SEGMENTS },
      });

    const tints = (userSettings: Record<string, unknown>) =>
      hostWith(userSettings).run(asSdkPlugin(plugin)).hook<Array<Record<string, unknown>>>(
        'dayTintProvider',
        'getDayTints',
        1,
      );

    it('paints the whole day when the user chose full-day', async () => {
      const [tint] = await tints({ tintMode: 'full-day' });

      expect(tint).toMatchObject({ color: '#4F46E5', label: 'Tokyo' });
      expect(tint).not.toHaveProperty('headerColor');
    });

    it('contributes nothing when the user turned the tint off', async () => {
      expect(await tints({ tintMode: 'off' })).toEqual([]);
    });

    // The upgrade path: 1.2.0 installs have no stored value at all.
    it('falls back to header and badge when the setting was never chosen', async () => {
      const [tint] = await tints({});

      expect(tint).toMatchObject({ headerColor: '#4F46E5', badgeColor: '#4F46E5' });
      expect(tint).not.toHaveProperty('color');
    });

    it('falls back to header and badge for a value it does not recognise', async () => {
      const [tint] = await tints({ tintMode: 'whole-day' });

      expect(tint).toMatchObject({ headerColor: '#4F46E5', badgeColor: '#4F46E5' });
    });
  });

  describe('the map-lines setting (#3, #6)', () => {
    const HOTEL = [35.0, 135.75];
    const located = makeDays(12, { startDate: '2026-04-10' }).map((day, i) => ({
      ...day,
      assignments: [{ id: i, day_id: day.id, place_id: i, order_index: 0, place: { id: i, name: `Stop ${i}`, lat: 34 + i * 0.01, lng: 135 } }],
    }));

    const layers = (userSettings: Record<string, unknown>) =>
      createMockHost({
        actingUserId: 1,
        grants: manifest.permissions,
        userSettings,
        trips: {
          1: {
            members: [1],
            data: { id: 1, title: 'Japan' },
            days: located,
            reservations: [],
            // Kyoto (days 5-8): a hotel for the nights of days 5, 6 and 7.
            accommodations: [{ id: 1, trip_id: 1, start_day_id: 105, end_day_id: 108, place_lat: HOTEL[0], place_lng: HOTEL[1] }],
          },
        },
        queryResults: { [SQL_LIST]: SEGMENTS },
      })
        .run(asSdkPlugin(plugin))
        .hook<Array<{ features: Array<{ points?: number[][] }> }>>('mapLayerProvider', 'getLayers', 1);

    it('threads each night\'s stay into the line by default', async () => {
      const [layer] = await layers({});
      // Kyoto: 4 stops plus the hotel after each of its first three days.
      expect(layer?.features[1]?.points).toHaveLength(7);
      expect(layer?.features[1]?.points?.[1]).toEqual(HOTEL);
    });

    it('follows the planned stops alone when asked to', async () => {
      const [layer] = await layers({ mapLines: 'stops-only' });
      expect(layer?.features[1]?.points).toHaveLength(4);
    });

    it('draws nothing when the user turned the lines off', async () => {
      expect(await layers({ mapLines: 'off' })).toEqual([]);
    });
  });

  /**
   * The failure the grant test cannot see: a hook the host refuses to call. If
   * a permission is ever dropped from the manifest these prove the hook goes
   * dark, rather than the plugin quietly contributing nothing forever.
   */
  it.each([
    ['dayTintProvider', 'getDayTints', 'hook:day-tint-provider'],
    ['dayScheduleProvider', 'getSchedule', 'hook:day-schedule-provider'],
    ['mapLayerProvider', 'getLayers', 'hook:map-layer-provider'],
  ])('refuses %s without %s', async (hook, fn, permission) => {
    const ungranted = createMockHost({
      actingUserId: 1,
      grants: manifest.permissions.filter((p) => p !== permission),
      trips: { 1: { members: [1], data: { id: 1, title: 'Japan' }, days: [], reservations: [], accommodations: [] } },
      queryResults: { [SQL_LIST]: SEGMENTS },
    });

    await expect(ungranted.run(asSdkPlugin(plugin)).hook(hook, fn, 1)).rejects.toThrow();
  });
});

describe('MCP tools', () => {
  type McpResult = { content?: Array<{ type: string; text: string }>; isError?: boolean } & Record<string, unknown>;
  const call = (host: ReturnType<typeof hostFor>, name: string, args: unknown) =>
    host.run(asSdkPlugin(plugin)).hook('mcpToolProvider', 'callTool', { name, args }) as Promise<McpResult>;
  const declared = () => manifest.capabilities.mcpTools;

  /**
   * TREK advertises the INTERSECTION of the manifest's capabilities.mcpTools and
   * the hook's `tools` list, and drops the rest without a word. So the manifest
   * entry must match the code exactly — a stale description or schema in
   * trek-plugin.json is what the assistant would actually be shown.
   */
  it('declares in the manifest exactly the tools the code implements', () => {
    expect(declared()).toEqual(mcpToolDeclarations);
    expect(plugin.hooks?.mcpToolProvider?.tools).toEqual(declared().map((tool) => tool.name));
  });

  it('declares a complete, collision-resistant segment tool set', () => {
    expect(declared().map((tool) => tool.name)).toEqual([
      'list_trip_segments',
      'get_trip_segment',
      'create_trip_segment',
      'update_trip_segment',
      'delete_trip_segment',
    ]);
    const byName = (name: string) => declared().find((tool) => tool.name === name);
    expect(byName('list_trip_segments')?.annotations?.readOnlyHint).toBe(true);
    expect(byName('create_trip_segment')?.annotations?.readOnlyHint).toBe(false);
    expect(byName('delete_trip_segment')?.annotations?.destructiveHint).toBe(true);
  });

  /** On TREK 4.0.0 `mcp:tools` is an unknown permission, and an unknown permission fails the install. */
  it('targets TREK 4.1.0 or newer, the first release that knows mcp:tools', () => {
    expect(manifest.permissions).toContain('mcp:tools');
    const floor = /^>=(\d+)\.(\d+)\.(\d+)\b/.exec(manifest.trek)?.slice(1).map(Number);
    expect(floor, `unexpected trek range ${manifest.trek}`).toBeDefined();
    const [major = 0, minor = 0] = floor ?? [];
    expect(major > 4 || (major === 4 && minor >= 1), `trek range ${manifest.trek} admits 4.0.x`).toBe(true);
  });

  it('is never called without the mcp:tools grant', async () => {
    const ungranted = createMockHost({
      actingUserId: 1,
      grants: manifest.permissions.filter((p) => p !== 'mcp:tools'),
      trips: {},
    });

    await expect(
      ungranted.run(asSdkPlugin(plugin)).hook('mcpToolProvider', 'callTool', { name: 'list_trip_segments', args: { tripId: 1 } }),
    ).rejects.toThrow(/mcp:tools/);
  });

  it('uses the existing authenticated write path and broadcasts a successful MCP create', async () => {
    const created = [
      { id: 7, trip_id: 1, name: 'Tokyo', color: '#123ABC', tone: 'default', start_day: 1, end_day: 5, created_at: 'x', updated_at: 'x' },
    ];
    const host = hostFor([1], { [SQL_INSERT_IF_FREE]: created });

    const result = await call(host, 'create_trip_segment', { tripId: 1, name: 'Tokyo', color: '#123abc', start_day: 1, end_day: 5 });

    expect(result.isError).toBeUndefined();
    expect(result).toMatchObject({ ok: true, segment: { id: 7, name: 'Tokyo', color: '#123ABC' } });
    expect(host.broadcasts).toHaveLength(1);
  });

  it('lists a trip the caller belongs to', async () => {
    const result = await call(hostFor([1], { [SQL_LIST]: SEGMENTS }), 'list_trip_segments', { tripId: 1 });

    expect(result).toMatchObject({ ok: true, dayCount: 12 });
    expect((result.segments as Array<{ name: string }>).map((s) => s.name)).toEqual(['Tokyo', 'Kyoto']);
  });

  /**
   * The host serialises whatever comes back into a SUCCESSFUL result unless it
   * is flagged, so a refused call must carry isError or the model reads it as done.
   */
  it('reports a trip the caller cannot access as a tool error', async () => {
    const result = await call(hostFor([2]), 'list_trip_segments', { tripId: 1 });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content?.[0]?.text ?? '')).toMatchObject({ ok: false, status: 404, error: 'not_found' });
  });

  it('reports a rejected write as a tool error, keeping the validation detail', async () => {
    const result = await call(hostFor([1], { [SQL_LIST]: SEGMENTS }), 'create_trip_segment', {
      tripId: 1,
      name: 'Osaka',
      color: '#123abc',
      start_day: 3,
      end_day: 6,
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content?.[0]?.text ?? '')).toMatchObject({ ok: false });
  });

  it('answers an unknown tool or non-object arguments with a tool error, not a crash', async () => {
    const host = hostFor([1]);

    expect(await call(host, 'drop_everything', {})).toMatchObject({ isError: true });
    expect(await call(host, 'list_trip_segments', null)).toMatchObject({ isError: true });
  });
});

const ROUTE = (path: string, method = 'GET') => ({ method, path });

/**
 * The published SDK's `PluginDefinition` is a release behind the host: its `Day`
 * has no `assignments` or `notes_items`, even though `DaysService.list()` really
 * does return them (days.service.ts:175-229), and its hook map knows nothing of
 * `dayScheduleProvider` or `mapLayerProvider`. The runtime shapes agree — only
 * the type declarations lag — so this cast is confined to the test boundary and
 * never appears in shipped code.
 */
const asSdkPlugin = (def: typeof plugin): never => def as never;

function hostFor(members: number[], queryResults: Record<string, unknown[]> = {}) {
  return createMockHost({
    actingUserId: 1,
    grants: manifest.permissions,
    trips: {
      1: {
        members,
        data: { id: 1, title: 'Japan', start_date: '2026-04-10', end_date: '2026-04-21' },
        days: makeDays(12, { startDate: '2026-04-10' }),
        reservations: [],
        accommodations: [],
      },
    },
    queryResults,
  });
}

describe('trip access', () => {
  /**
   * The reason `withTrip` exists. `ctx.trips.getById` THROWS for a non-member
   * (rpc-host.ts:1167) rather than returning null, and an uncaught throw in a
   * handler is turned into a 502 "Plugin error" by the proxy — which reads to
   * the user as a broken plugin rather than a missing trip.
   */
  it('answers 404, not a rejection, when the user is not a member', async () => {
    const driver = hostFor([2]).run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/overview'), { query: { tripId: '1' } });

    expect(res.status).toBe(404);
  });

  it('answers 404 for a trip that does not exist at all', async () => {
    const driver = hostFor([1]).run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/overview'), { query: { tripId: '999' } });

    expect(res.status).toBe(404);
  });

  it('answers 400 without a tripId', async () => {
    const driver = hostFor([1]).run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/overview'), { query: {} });

    expect(res.status).toBe(400);
  });
});

describe('overview', () => {
  it('reports the day count and full coverage gap with no segments', async () => {
    const driver = hostFor([1], { [SQL_LIST]: [] }).run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/overview'), { query: { tripId: '1' } });
    const body = JSON.parse(String(res.body));

    expect(res.status).toBe(200);
    expect(body.dayCount).toBe(12);
    expect(body.segments).toEqual([]);
    expect(body.uncovered).toEqual([[1, 12]]);
    expect(body.days[0]).toMatchObject({ pos: 1, date: '2026-04-10' });
  });

  it('resolves a stored segment against the current day count', async () => {
    const rows = [
      { id: 1, trip_id: 1, name: 'Tokyo', tone: 'default', start_day: 1, end_day: 5, created_at: 'x', updated_at: 'x' },
      // Runs past day 12 — must come back clipped, not dropped.
      { id: 2, trip_id: 1, name: 'Kyoto', tone: 'warn', start_day: 10, end_day: 30, created_at: 'x', updated_at: 'x' },
      // Starts past the end of the trip entirely.
      { id: 3, trip_id: 1, name: 'Ghost', tone: 'danger', start_day: 40, end_day: 45, created_at: 'x', updated_at: 'x' },
    ];
    const driver = hostFor([1], { [SQL_LIST]: rows }).run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/overview'), { query: { tripId: '1' } });
    const body = JSON.parse(String(res.body));

    expect(body.segments.map((s: { status: string }) => s.status)).toEqual(['ok', 'clipped', 'out_of_range']);
    expect(body.segments[1]).toMatchObject({ effStart: 10, effEnd: 12, effLength: 3 });
    expect(body.segments[2]).toMatchObject({ effStart: null, effEnd: null, effLength: 0 });
    expect(body.uncovered).toEqual([[6, 9]]);
  });
});

describe('writes', () => {
  const created = [
    { id: 7, trip_id: 1, name: 'Tokyo', color: '#12ABEF', tone: 'success', start_day: 1, end_day: 5, created_at: 'x', updated_at: 'x' },
  ];

  it('broadcasts to the trip after a successful create', async () => {
    const host = hostFor([1], { [SQL_INSERT_IF_FREE]: created });
    const driver = host.run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/segments', 'POST'), {
      body: { tripId: 1, name: 'Tokyo', color: '#12abef', start_day: 1, end_day: 5 },
    });

    expect(res.status).toBe(200);
    expect(host.broadcasts).toHaveLength(1);
    expect(host.broadcasts[0]).toMatchObject({ event: 'changed' });
  });

  it('returns 409 and does not broadcast when the atomic guard refuses', async () => {
    // No stub for SQL_INSERT_IF_FREE, so it yields zero rows — exactly what the
    // real statement does when the range overlaps or the limit is reached.
    const host = hostFor([1]);
    const driver = host.run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/segments', 'POST'), {
      body: { tripId: 1, name: 'Tokyo', tone: 'default', start_day: 1, end_day: 5 },
    });

    expect(res.status).toBe(409);
    expect(host.broadcasts).toHaveLength(0);
  });

  it('rejects an unsafe custom colour instead of falling back to a supplied tone', async () => {
    const host = hostFor([1]);
    const driver = host.run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/segments', 'POST'), {
      body: {
        tripId: 1,
        name: 'Tokyo',
        color: 'red 50%, transparent), url(https://evil.example/x.png',
        tone: 'default',
        start_day: 1,
        end_day: 5,
      },
    });

    expect(res.status).toBe(400);
    expect(host.broadcasts).toHaveLength(0);
  });

  it('still accepts a tone-only request from an older client', async () => {
    const host = hostFor([1], { [SQL_INSERT_IF_FREE]: created });
    const driver = host.run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/segments', 'POST'), {
      body: { tripId: 1, name: 'Tokyo', tone: 'default', start_day: 1, end_day: 5 },
    });

    expect(res.status).toBe(200);
  });

  it('rejects a range past the end of the trip before touching the database', async () => {
    const host = hostFor([1]);
    const driver = host.run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/segments', 'POST'), {
      body: { tripId: 1, name: 'Too long', tone: 'default', start_day: 1, end_day: 99 },
    });

    expect(res.status).toBe(422);
    expect(JSON.parse(String(res.body)).issues).toContain('range_out_of_bounds');
  });

  it('never lets a non-member write', async () => {
    const host = hostFor([2], { [SQL_INSERT_IF_FREE]: created });
    const driver = host.run(asSdkPlugin(plugin));

    const res = await driver.route(ROUTE('/segments', 'POST'), {
      body: { tripId: 1, name: 'Tokyo', tone: 'default', start_day: 1, end_day: 5 },
    });

    expect(res.status).toBe(404);
    expect(host.broadcasts).toHaveLength(0);
  });
});
