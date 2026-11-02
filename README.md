# Trip Segments

## What it does

A long trip is one flat list of days in TREK. That works well for a long weekend and badly for six
months across Japan and Thailand, where day 78 tells you nothing about where you actually are. Trip
Segments lets you draw legs over that list — Tokyo, Kanazawa, Bangkok — give each one a colour, and
then read the trip through them.

Each leg is a range of days with a name and a colour. Legs may not overlap, but they may leave gaps,
and the plugin shows you which days are not yet part of any leg so nothing quietly falls through. A
leg is anchored to positions in the day list rather than to calendar dates, so it keeps working on a
trip whose dates are still undecided. When you insert or delete days later, legs are re-resolved on
read: one that now runs past the end of the trip is shown as shortened, and one that has fallen off
the end entirely is greyed out and contributes nothing until you fix it.

The plugin adds a Segments tab to the trip planner, placed directly after Plan. From there you can
create, edit and delete legs, see the whole trip as a single colour bar, and open any leg to get the
part of the trip that belongs to it: the days and their planned places, the bookings that fall inside
the range, and the accommodation stays that overlap it. A booking that crosses a boundary, like the
train that takes you from one leg to the next, deliberately appears in both legs. Bookings that are
not attached to a day at all are listed separately instead of being silently dropped.

Legs also show up outside the tab. The PDF export gets a summary section listing every leg with its
dates and counts, and the trip card on your dashboard gets a badge with the leg count and the first
few names.

Three further integrations light up the rest of the planner: a small banner where each leg begins and
ends on the day plan, one coloured line per leg on the trip map, and matching colour tints on day
headers and badges. All three rest on provider hooks that TREK added in 4.0.0, which is why this
release requires that version.

Choose from eight presets or use the custom colour picker. The Segments tab uses the exact hex colour,
and the day tint keeps your hue and chroma while TREK clamps lightness into a band that stays readable
against the current theme — all eight presets already sit inside that band, but an extreme custom
colour will be shifted on the day header. Map lines and schedule banners use the closest of TREK's
four semantic tones, because neither hook carries a colour channel of its own.

## Screenshots

![The Segments tab](docs/screenshot.png)

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `db:own` | Stores the legs themselves — name, colour, day range — in the plugin's own SQLite database. Nothing is written to TREK's tables. |
| `db:read:trips` | Reads the trip's days, bookings and accommodation stays in order to resolve day ranges and build the per-leg view. Read-only. |
| `ws:broadcast:trip` | Notifies other people looking at the same trip that the legs changed, so their tab refreshes without a reload. |
| `hook:day-schedule-provider` | Puts the small start/end banner for each leg on the day plan. |
| `hook:day-tint-provider` | Tints the day in the leg's own colour. Which parts of it — header, badge, the whole day, or none — is a per-user setting. |
| `hook:map-layer-provider` | Draws one coloured line per leg on the trip map. |
| `hook:pdf-section-provider` | Adds the leg summary section to the trip's PDF export. |
| `hook:trip-card-provider` | Adds the leg-count badge to the trip card on the dashboard. |

No personal data is stored. The plugin's database holds only trip ids, leg names, colours and day
numbers, so there is no user data to export or erase.

## Settings

One setting, **Day tint**, under Settings → Plugins. It chooses how much of a day the leg colour
covers:

| Option | What it paints |
| --- | --- |
| Whole day | The day header, the number badge and the expanded activity list |
| Header and badge *(default)* | The header row and the number badge, leaving the activity list plain |
| Badge only | The number badge alone |
| No tint | Nothing — this also removes the leg-name tooltip, which has no colour-free form |

It is **per user**: your choice changes how you see a trip, not how the people you travel with see
it. TREK's plugin settings are read against the acting user, so there is no instance-wide form of
this — a shared value could not be read back by the plugin at all.

Two honest caveats. The day plan reads tints once when it mounts and nothing invalidates that, so a
change shows the next time you open a trip rather than immediately. And on phones only the day chip
carries a tint, so the first three options look the same there; only **No tint** differs.

The default matches what 1.2.0 did, so upgrading changes nothing until you pick something else.

## MCP tools

The plugin declares tools to list, inspect, create, update and delete trip segments. Read this section
as intent rather than as a shipped feature: **no released TREK exposes plugin-contributed MCP tools,
4.0.0 included**, so nothing reads these declarations today and they change nothing about how the
plugin behaves. They are kept so the feature is ready if host support lands.

Were a host to serve them, the handlers run as the calling user and go through the same membership
checks, validation, overlap guards and live-update broadcast as changes made in the Segments tab, and
deleting removes only the segment, never the trip days, bookings or stays inside it.

## Setup

Trip Segments 1.3.1 requires **TREK 4.0.0 or newer** (TREK 5 included); on an older instance the registry keeps serving
1.1.0 instead. Install from the registry or sideload the packed zip, then activate it in Admin →
Plugins and approve the permissions listed above. No API keys and no external services are
contacted; the one setting is described below and has a working default.

Open any trip and you will find a Segments tab immediately after Plan; it is also addressable
directly as `?tab=plugin:trip-segments`, so it can be a bookmark or a startup destination. Use Add leg to draw your
first one: give it a name, pick a colour, and choose the first and last day from the dropdowns. Keep
adding legs until the colour bar across the top covers the parts of the trip you care about. Deleting
a leg only deletes the leg; the days, bookings and stays inside it are untouched, because the plugin
never writes to TREK's own data.

If a leg turns grey with a warning after you edit the trip, days were removed and that leg now points
past the end of the trip. Edit its range to bring it back.
