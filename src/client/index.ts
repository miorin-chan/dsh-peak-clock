/**
 * Client half of dsh-peak-clock.
 *
 * One full-width row above the sidebar account row (`sidebar.footer.action`)
 * showing whether DeepSeek API tokens are billed at peak or off-peak rates
 * right now, plus how long until the next switch.
 *
 * Colour follows attention: idle shows the rate colour (blue off-peak, warm
 * peak); while the visible conversation is running a Turn the colour drops
 * out entirely, so the row cannot compete with the work in progress.
 *
 * Peak rules (Beijing time, DeepSeek direct API): Mon-Fri 09:00-12:00 and
 * 14:00-18:00 are peak; every other hour, all day Saturday/Sunday, and all
 * Chinese statutory holidays are off-peak.
 */
import { createElement, useEffect, useState } from 'react';

/** Profile entry id / locale namespace; must match package.json and cordis.patch.yml. */
const ENTRY_ID = 'dsh-peak-clock';
/** Slot that allocates the full-width row above the account launcher. */
const SLOT = 'sidebar.footer.action';

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Beijing is UTC+8 year-round; there is no DST to model. */
const BJ = 8 * HOUR;

const PEAK_HOURS: ReadonlyArray<readonly [number, number]> = [
  [9, 12],
  [14, 18],
];

/**
 * Statutory holidays billed as off-peak all day.
 * 2026: 国办发明电〔2025〕7 号. 2027: 国办发明电〔2026〕10 号, published 2026-11-05.
 * Weekends are already off-peak and every 调休 workday falls on a weekend, so
 * only the 放假 dates are listed.
 */
const HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
  // 2027
  '2027-01-01', '2027-01-02', '2027-01-03',
  '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
  '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-13',
  '2027-04-03', '2027-04-04', '2027-04-05',
  '2027-05-01', '2027-05-02', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-06-09',
  '2027-09-15',
  '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04',
  '2027-10-05', '2027-10-06', '2027-10-07',
]);

/** Outside these years the table cannot decide, so the pill says so instead of guessing. */
const COVERED_YEARS: readonly number[] = [2026, 2027];

/** Locale dictionary for the pill copy. */
const COPY: Record<string, Record<string, string>> = {
  zh: {
    'state.peak': '峰时',
    'state.valley': '谷时',
    'tail.peak': '后转谷',
    'tail.valley': '后转峰',
    beijing: '北京时间',
    uncovered: '节假日表未覆盖',
    coverage: '只覆盖到',
    'coverage.tail': '年，请更新插件',
    'dur.day': '天',
    'dur.hour': '小时',
    'dur.min': '分',
    'dur.sec': '秒',
  },
  en: {
    'state.peak': 'peak',
    'state.valley': 'off-peak',
    'tail.peak': ' to off-peak',
    'tail.valley': ' to peak',
    beijing: 'Beijing',
    uncovered: 'no holiday table for',
    coverage: 'covers through',
    'coverage.tail': ' — update the plugin',
    'dur.day': 'd ',
    'dur.hour': 'h ',
    'dur.min': 'm ',
    'dur.sec': 's',
  },
};

const CSS = `
.dsh-pkc {
  flex: 0 0 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-inline-size: 0;
  block-size: 22px;
  padding-inline: 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  cursor: default;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  transition: color 160ms ease;
  --dsh-pkc-valley-color: #4D6BFE;
  --dsh-pkc-peak-color: #D97757;
}
.dsh-pkc-valley { color: var(--dsh-pkc-valley-color); }
.dsh-pkc-peak { color: var(--dsh-pkc-peak-color); }
.dsh-pkc-muted { color: var(--dsw-alias-label-tertiary); }
.dsh-pkc-dot {
  flex: none;
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: currentColor;
  transition: background-color 160ms ease, box-shadow 160ms ease;
}
.dsh-pkc-muted .dsh-pkc-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px currentColor;
}
.dsh-pkc-text { overflow: hidden; text-overflow: ellipsis; }
.dsh-pkc-rail { justify-content: center; padding-inline: 0; }
`;

interface BeijingFields {
  day: string;
  weekday: number;
  hour: number;
  clock: string;
}

/** Beijing calendar fields for an epoch millisecond. */
function beijing(ms: number): BeijingFields {
  const shifted = new Date(ms + BJ);
  return {
    day: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    clock: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
  };
}

function isPeak(ms: number): boolean {
  const bj = beijing(ms);
  if (bj.weekday === 0 || bj.weekday === 6) return false;
  if (HOLIDAYS.has(bj.day)) return false;
  return PEAK_HOURS.some(([start, end]) => bj.hour >= start && bj.hour < end);
}

/** Next instant the peak flag flips, or null when nothing within three weeks. */
function nextChange(ms: number): number | null {
  const current = isPeak(ms);
  const shifted = new Date(ms + BJ);
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  // The longest break plus its weekends stays under two weeks; 21 days is slack.
  for (let day = 0; day <= 21; day += 1) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const candidate = midnight + day * DAY + edge * HOUR - BJ;
      if (candidate <= ms + 1000) continue;
      if (isPeak(candidate) !== current) return candidate;
    }
  }
  return null;
}

type Translate = (key: string) => string;

function tr(t: Translate | undefined, key: string): string {
  const value = t?.(key);
  if (typeof value === 'string' && value !== '' && value !== key) return value;
  return COPY.en[key] ?? key;
}

/** Countdown text; the unit words come from the locale dictionary. */
function formatRemain(ms: number, t: Translate | undefined): string {
  const total = Math.max(0, ms);
  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  const minutes = Math.floor((total % HOUR) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const unit = (key: string): string => tr(t, key);
  if (days > 0) return `${days}${unit('dur.day')}${hours}${unit('dur.hour')}`.trim();
  if (hours > 0) return `${hours}${unit('dur.hour')}${minutes}${unit('dur.min')}`.trim();
  if (minutes > 0) return `${minutes}${unit('dur.min')}${seconds}${unit('dur.sec')}`.trim();
  return `${seconds}${unit('dur.sec')}`.trim();
}

interface SessionSummary {
  id: string;
  running?: boolean;
  retainedBy?: { mainView?: number };
}

interface SessionsSnapshot {
  byId?: Record<string, SessionSummary>;
}

interface SessionStatus {
  running?: boolean;
}

type StatusSnapshot = Map<string, SessionStatus> | Record<string, SessionStatus>;

function statusOf(snapshot: StatusSnapshot, id: string): SessionStatus | undefined {
  const asMap = snapshot as Map<string, SessionStatus>;
  if (typeof asMap.get === 'function') return asMap.get(id);
  return (snapshot as Record<string, SessionStatus>)[id];
}

/**
 * Whether the conversation filling the main view is executing a Turn.
 * Mirrors the sidebar's own resolution: no panel overlays the session, and the
 * session retained by the main view reports `running`.
 */
function mainSessionRunning(
  activePanelId: string | null | undefined,
  sessions: SessionsSnapshot | undefined,
  statuses: StatusSnapshot | undefined,
): boolean {
  if (activePanelId !== null && activePanelId !== undefined) return false;
  if (sessions === undefined || statuses === undefined) return false;
  const byId = sessions.byId ?? {};
  const main = Object.values(byId).find(
    (session) => session != null && (session.retainedBy?.mainView ?? 0) > 0,
  );
  if (main === undefined) return false;
  const status = statusOf(statuses, main.id);
  if (status !== undefined) return status.running === true;
  return main.running === true;
}

interface PillProps {
  /** False while the sidebar is the 56px rail. */
  wide?: boolean;
  usePanelInfo?: (selector: (info: { activePanelId: string | null }) => string | null) => string | null;
  useSessions?: <S>(selector: (snapshot: SessionsSnapshot) => S) => S;
  useSessionStatus?: <S>(selector: (snapshot: StatusSnapshot) => S) => S;
  t?: Translate;
}

/** Always-visible row: current DeepSeek rate window and the time left in it. */
function PeakClockPill(props: PillProps): unknown {
  const wide = props.wide !== false;
  const { usePanelInfo, useSessions, useSessionStatus, t } = props;

  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Standard slot props: stable identities, called on every render.
  const activePanelId = usePanelInfo
    ? usePanelInfo((info) => info.activePanelId)
    : null;
  const sessions = useSessions ? useSessions((snapshot) => snapshot) : undefined;
  const statuses = useSessionStatus ? useSessionStatus((snapshot) => snapshot) : undefined;
  const running = mainSessionRunning(activePanelId, sessions, statuses);

  const now = Date.now();
  const bj = beijing(now);
  const year = new Date(now + BJ).getUTCFullYear();
  const className = wide ? 'dsh-pkc' : 'dsh-pkc dsh-pkc-rail';
  const dot = createElement('span', { className: 'dsh-pkc-dot', 'aria-hidden': true });

  // Without that year's 放假 table the weekday-holiday rule would silently bill
  // a 元旦 morning as peak, so refuse to colour anything we cannot prove.
  if (!COVERED_YEARS.includes(year)) {
    const last = COVERED_YEARS[COVERED_YEARS.length - 1];
    const text = `${tr(t, 'uncovered')} ${year}`;
    const caption = `${text} · ${tr(t, 'coverage')} ${last}${tr(t, 'coverage.tail')}`;
    return createElement(
      'span',
      { className: `${className} dsh-pkc-muted`, role: 'img', title: caption, 'aria-label': caption },
      dot,
      wide ? createElement('span', { className: 'dsh-pkc-text' }, text) : null,
    );
  }

  const peak = isPeak(now);
  const next = nextChange(now);
  const state = tr(t, peak ? 'state.peak' : 'state.valley');
  const remain = next === null ? '' : formatRemain(next - now, t);
  const tail = next === null ? '' : `${remain}${tr(t, peak ? 'tail.peak' : 'tail.valley')}`;
  const caption = `${state} · DeepSeek · ${tr(t, 'beijing')} ${bj.clock}${tail === '' ? '' : ` · ${tail}`}`;
  const tone = running ? 'dsh-pkc-muted' : peak ? 'dsh-pkc-peak' : 'dsh-pkc-valley';

  return createElement(
    'span',
    { className: `${className} ${tone}`, role: 'img', title: caption, 'aria-label': caption },
    dot,
    wide ? createElement('span', { className: 'dsh-pkc-text' }, tail === '' ? state : `${state} · ${tail}`) : null,
  );
}

interface ClientSlots {
  inject(owner: string, register: () => unknown): unknown;
  register(options: Record<string, unknown>, component: unknown): unknown;
}

interface ClientContext {
  slots: ClientSlots;
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void;
  };
  effect(setup: () => (() => void) | void, label?: string): void;
}

export const inject = ['slots', 'locale'];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(ENTRY_ID, COPY), `${ENTRY_ID}: locale`);

  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = ENTRY_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
    return () => { tag.remove(); };
  }, `${ENTRY_ID}: styles`);

  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: ENTRY_ID,
    order: 190,
    locale: ENTRY_ID,
  }, PeakClockPill));
}
