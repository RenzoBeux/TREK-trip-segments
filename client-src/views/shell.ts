import { button, clear, el, muted } from '../dom';
import { renderCalendar, renderLegend } from './calendar';
import { renderEditor } from './editor';
import { renderOverview } from './overview';
import { renderDetailPanel } from './detail';
import { renderStrip } from './strip';
import { MAX_SEGMENTS_PER_TRIP } from '../../src/shared/limits';
import { plural } from '../../src/shared/format';
import type { AppState, ViewMode } from '../store';
import type { OverviewPayload, SegmentInput, SegmentView } from '../../src/shared/types';

export interface ShellActions {
  onCreate: () => void;
  onEdit: (view: SegmentView) => void;
  onDelete: (view: SegmentView) => void;
  onToggle: (view: SegmentView) => void;
  onOpenById: (id: number) => void;
  onClose: () => void;
  onSave: (input: SegmentInput, id?: number) => void;
  onCancelEdit: () => void;
  onSetView: (view: ViewMode) => void;
}

interface Regions {
  banner: HTMLElement;
  strip: HTMLElement;
  header: HTMLElement;
  legend: HTMLElement;
  editor: HTMLElement;
  body: HTMLElement;
  panel: HTMLElement;
}

let regions: Regions | null = null;
let actions: ShellActions | null = null;

/**
 * Build the persistent region nodes ONCE. Every render then repaints only the
 * region that changed, rather than rebuilding the whole tree from a root
 * innerHTML — which would drop focus and scroll position on every refresh, and
 * this tab refreshes on any relevant trip event.
 */
export function mountShell(root: HTMLElement, shellActions: ShellActions): void {
  actions = shellActions;
  clear(root);

  regions = {
    banner: el('div', { class: 'seg-banner-slot' }),
    strip: el('div', { class: 'seg-strip' }),
    header: el('div', { class: 'seg-header' }),
    legend: el('div', { class: 'seg-legend' }),
    editor: el('div', { class: 'seg-editor-slot' }),
    body: el('div', { class: 'seg-body' }),
    // Only used by the calendar; the list embeds the panel inside its card.
    panel: el('div', { class: 'seg-panel-slot' }),
  };

  // The strip, header and legend are the only key to what each colour means, so
  // they stay pinned while a long trip's months scroll underneath them.
  const top = el('div', { class: 'seg-top' }, [regions.strip, regions.header, regions.legend]);
  watchStuck(top, 'seg-top--stuck');
  // On a phone only the legend pins (the block is display: contents there).
  watchStuck(regions.legend, 'seg-legend--stuck');

  root.append(regions.banner, top, regions.editor, regions.body, regions.panel);
}

/**
 * Mark a pinned element while it is actually pinned, so its backing and hairline
 * appear only once content is scrolling beneath it and the resting layout looks
 * exactly as it did before.
 *
 * Pinned elements sit at `top: -1px`, so pinned they poke one pixel above the
 * frame: crossing full visibility fires the observer, and a negative top says it
 * was the top edge — not a block merely cut off at the bottom of a short screen.
 * Missing in jsdom, where nothing ever reads as stuck.
 */
function watchStuck(node: HTMLElement, stuckClass: string): void {
  if (typeof IntersectionObserver === 'undefined') return;
  new IntersectionObserver(
    ([entry]) => {
      if (entry) node.classList.toggle(stuckClass, entry.boundingClientRect.top < 0);
    },
    { threshold: [1] },
  ).observe(node);
}

function viewToggle(current: ViewMode, onSet: (v: ViewMode) => void): HTMLElement {
  const tab = (mode: ViewMode, label: string) =>
    el('button', {
      class: `seg-toggle-btn${current === mode ? ' seg-toggle-btn--on' : ''}`,
      text: label,
      attrs: { type: 'button', 'aria-pressed': String(current === mode) },
      on: { click: () => onSet(mode) },
    });

  return el('div', { class: 'seg-toggle' }, [tab('calendar', 'Calendar'), tab('list', 'List')]);
}

function renderHeader(node: HTMLElement, data: OverviewPayload, state: AppState, act: ShellActions): void {
  clear(node);

  const facts = [plural(data.segments.length, 'leg', 'legs'), plural(data.dayCount, 'day', 'days')];
  const uncoveredDays = data.uncovered.reduce((sum, [lo, hi]) => sum + (hi - lo + 1), 0);
  if (uncoveredDays > 0) facts.push(`${uncoveredDays} not in a leg`);

  const atLimit = data.segments.length >= MAX_SEGMENTS_PER_TRIP;

  node.append(
    el('div', { class: 'seg-header-facts' }, [
      el('span', { class: 'trek-title', text: data.trip.title ?? 'This trip' }),
      el('span', { class: 'trek-faint', text: facts.join(' · ') }),
    ]),
    el('div', { class: 'trek-cluster seg-header-actions' }, [
      viewToggle(state.view, act.onSetView),
      button('Add leg', {
        variant: 'primary',
        onClick: act.onCreate,
        disabled: atLimit || data.dayCount === 0,
        ...(atLimit ? { title: `A trip can have at most ${MAX_SEGMENTS_PER_TRIP} legs.` } : {}),
      }),
    ]),
  );
}

export function renderShell(state: AppState): void {
  if (!regions || !actions) return;
  const { banner, strip, header, legend, editor, body, panel } = regions;
  const act = actions;

  clear(banner);
  if (state.banner) {
    banner.append(el('div', { class: `seg-banner seg-banner--${state.banner.level}`, text: state.banner.text }));
  }

  if (state.loading && !state.overview) {
    for (const region of [strip, header, legend, editor, body, panel]) clear(region);
    body.append(muted('Loading legs...'));
    return;
  }

  const data = state.overview;
  if (!data) {
    for (const region of [strip, header, legend, editor, body, panel]) clear(region);
    body.append(muted('No trip data available.'));
    return;
  }

  // The strip is trip-wide context, so it stays visible on every screen.
  renderStrip(strip, data.segments, data.dayCount, act.onOpenById);
  renderEditor(editor, state.editor, data, { onSave: act.onSave, onCancel: act.onCancelEdit });

  renderHeader(header, data, state, act);

  const expanded = { id: state.expandedId, detail: state.detail };
  const asCalendar = state.view === 'calendar' && data.segments.length > 0;

  if (asCalendar) {
    renderLegend(legend, data.segments, state.expandedId, act.onOpenById);
    renderCalendar(body, data, state.expandedId, act.onOpenById);

    // The calendar's cells are too small to host the panel, so it sits directly
    // below the grid with the leg's own days ringed above it.
    const open = data.segments.find((s) => s.id === state.expandedId);
    if (open) renderDetailPanel(panel, open, state.detail, act.onClose);
    else clear(panel);
    return;
  }

  clear(legend);
  clear(panel);
  renderOverview(body, data, expanded, {
    onCreate: act.onCreate,
    onEdit: act.onEdit,
    onDelete: act.onDelete,
    onToggle: act.onToggle,
    onClose: act.onClose,
  });
}
