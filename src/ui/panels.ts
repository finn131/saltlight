export interface PanelTaskState {
  index: number;
  name: string;
  concept: string;
  hint: string;
  total: number;
}

export interface PanelResourceState {
  credits: number;
  harvested: number;
  upgrades: { name: string; level: number; maxLevel: number }[];
}

export interface PanelSettingsState {
  speedMultiplier: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class TaskPanel {
  readonly root: HTMLElement;
  private key = '';
  constructor() {
    // #task-panel supplies the window chrome, so this is content only.
    this.root = el('div', 'task-body');
  }
  render(s: PanelTaskState): void {
    // renderPanels runs on a timer; skip the DOM write (and the aria-live
    // re-announcement) when nothing actually changed.
    const key = `${s.index}|${s.name}|${s.concept}|${s.hint}|${s.total}`;
    if (key === this.key) return;
    this.key = key;
    this.root.textContent = '';
    this.root.appendChild(el('h3', undefined, `Task ${s.index + 1} / ${s.total}`));
    this.root.appendChild(el('div', 'panel-strong', s.name));
    this.root.appendChild(el('div', 'panel-dim', s.concept));
    this.root.appendChild(el('p', 'panel-hint', s.hint));
  }
}

export class ResourcePanel {
  readonly root: HTMLElement;
  constructor() {
    this.root = el('div', 'panel panel-resource');
  }
  render(s: PanelResourceState): void {
    this.root.textContent = '';
    this.root.appendChild(el('h3', undefined, 'Storehouse'));
    this.root.appendChild(el('div', undefined, `credits: ${s.credits}`));
    this.root.appendChild(el('div', undefined, `harvested: ${s.harvested}`));
    for (const u of s.upgrades) {
      this.root.appendChild(el('div', 'panel-dim', `${u.name} ${u.level}/${u.maxLevel}`));
    }
  }
}

export class SettingsPanel {
  readonly root: HTMLElement;
  private speedSelect: HTMLSelectElement;
  private textScaleSelect: HTMLSelectElement;
  constructor(onChange: (s: PanelSettingsState) => void, initial: PanelSettingsState) {
    this.root = el('div', 'panel panel-settings');
    this.root.appendChild(el('h3', undefined, 'Settings'));
    const speeds: [string, number][] = [
      ['0.25x', 0.25],
      ['0.5x', 0.5],
      ['1x', 1],
      ['2x', 2],
      ['4x', 4],
      ['8x', 8],
    ];
    const label = el('label', undefined, 'speed ');
    this.speedSelect = el('select');
    for (const [text, v] of speeds) {
      const o = el('option', undefined, text);
      o.value = String(v);
      this.speedSelect.appendChild(o);
    }
    this.speedSelect.value = String(initial.speedMultiplier);
    this.speedSelect.addEventListener('change', () => {
      onChange({ speedMultiplier: Number(this.speedSelect.value) });
    });
    label.appendChild(this.speedSelect);
    this.root.appendChild(label);

    const tlabel = el('label', undefined, 'text size ');
    this.textScaleSelect = el('select');
    for (const v of ['0.85', '1', '1.2', '1.5']) {
      const o = el('option', undefined, `${v}x`);
      o.value = v;
      this.textScaleSelect.appendChild(o);
    }
    this.textScaleSelect.value = '1';
    tlabel.appendChild(this.textScaleSelect);
    this.root.appendChild(tlabel);
  }
  get textScale(): number {
    return Number(this.textScaleSelect.value);
  }
}