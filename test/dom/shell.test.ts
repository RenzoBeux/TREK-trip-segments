// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountShell } from '../../client-src/views/shell';
import type { ShellActions } from '../../client-src/views/shell';

const noop = () => {};
const actions: ShellActions = {
  onCreate: noop,
  onEdit: noop,
  onDelete: noop,
  onToggle: noop,
  onOpenById: noop,
  onClose: noop,
  onSave: noop,
  onCancelEdit: noop,
  onSetView: noop,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the pinned top of the tab', () => {
  it('keeps the strip, header and legend together, ahead of the editor and body', () => {
    const root = document.createElement('div');
    mountShell(root, actions);

    const top = root.querySelector('.seg-top');
    expect([...(top?.children ?? [])].map((c) => c.className)).toEqual(['seg-strip', 'seg-header', 'seg-legend']);
    expect([...root.children].map((c) => c.className)).toEqual([
      'seg-banner-slot',
      'seg-top',
      'seg-editor-slot',
      'seg-body',
      'seg-panel-slot',
    ]);
  });

  it('marks itself stuck only while it is pinned', () => {
    type Report = (entries: Array<{ boundingClientRect: { top: number } }>) => void;
    const reports = new Map<Element, Report>();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: Report) {}
        observe(node: Element) {
          reports.set(node, this.cb);
        }
      },
    );

    const root = document.createElement('div');
    mountShell(root, actions);
    const top = root.querySelector('.seg-top')!;

    reports.get(top)!([{ boundingClientRect: { top: -1 } }]);
    expect(top.classList.contains('seg-top--stuck')).toBe(true);

    reports.get(top)!([{ boundingClientRect: { top: 19 } }]);
    expect(top.classList.contains('seg-top--stuck')).toBe(false);
  });

  it('still mounts where IntersectionObserver does not exist', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = document.createElement('div');

    expect(() => mountShell(root, actions)).not.toThrow();
    expect(root.querySelector('.seg-top--stuck')).toBeNull();
  });
});
