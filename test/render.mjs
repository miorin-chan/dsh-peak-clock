/**
 * Renders the built Client bundle in a fake browser and checks what the pill
 * actually shows at fixed instants. Run `npm test`; it builds first because it
 * asserts against the shipped `client.js`, not the TypeScript source.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const bundle = fileURLToPath(new URL('../client.js', import.meta.url));
const code = readFileSync(bundle, 'utf8');

const clock = { now: 0 };
const NativeDate = Date;
function FakeDate(...args) {
  return args.length === 0 ? new NativeDate(clock.now) : new NativeDate(...args);
}
FakeDate.now = () => clock.now;
FakeDate.UTC = NativeDate.UTC;

function FakeReact() {}
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
FakeReact.createElement = h;
FakeReact.useState = (init) => [typeof init === 'function' ? init() : init, () => {}];
FakeReact.useEffect = () => {};

const sandbox = {
  console,
  Date: FakeDate,
  Math,
  Intl,
  setInterval: () => 1,
  clearInterval: () => {},
  window: {},
  document: {
    documentElement: { getAttribute: () => 'zh' },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild: () => {} },
  },
};
sandbox.window.__ModuleLoader__ = { load(spec) { sandbox.spec = spec; } };
vm.runInNewContext(code, sandbox);

const locales = {};
let Pill;
const ctx = {
  effect: (setup) => setup(),
  locale: { register(namespace, dictionaries) { locales[namespace] = dictionaries; return () => {}; } },
  slots: {
    inject: (_name, register) => register(),
    register: (_options, component) => { Pill = component; return _options; },
  },
};
const mod = sandbox.spec.factory((name) => {
  if (name === 'react') return FakeReact;
  throw new Error(`unexpected require: ${name}`);
});
mod.apply(ctx);
// Cross-realm arrays fail deepStrictEqual, so compare the shape as JSON.
assert.equal(JSON.stringify(mod.inject), JSON.stringify(['slots', 'locale']));

const dictionary = locales['dsh-peak-clock'];
assert.ok(dictionary?.zh && dictionary?.en, 'locale dictionaries registered');
const translate = (language) => (key) => dictionary[language][key] ?? key;

const textOf = (node) => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
};

const idleSession = { byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } };
const idle = {
  usePanelInfo: (select) => select({ activePanelId: null }),
  useSessions: (select) => select(idleSession),
  useSessionStatus: (select) => select(new Map([['s1', { running: false }]])),
};
const busy = {
  ...idle,
  useSessionStatus: (select) => select(new Map([['s1', { running: true }]])),
};

function render(instant, overrides = {}, language = 'zh') {
  clock.now = new NativeDate(instant).getTime();
  const tree = Pill({ wide: true, t: translate(language), ...idle, ...overrides });
  return { className: tree.props.className, title: tree.props.title, text: textOf(tree).trim() };
}

const cases = [
  ['2026-11-27T23:10:00+08:00', 'dsh-pkc-valley', '谷时 · 2天9小时后转峰'],
  ['2026-11-30T09:05:00+08:00', 'dsh-pkc-peak', '峰时 · 2小时55分后转谷'],
  ['2027-01-01T10:00:00+08:00', 'dsh-pkc-valley', '谷时 · 2天23小时后转峰'],
  ['2027-02-05T10:00:00+08:00', 'dsh-pkc-valley', '谷时 · 9天23小时后转峰'],
  ['2027-02-14T10:00:00+08:00', 'dsh-pkc-valley', '谷时 · 23小时0分后转峰'],
  ['2027-02-15T09:30:00+08:00', 'dsh-pkc-peak', '峰时 · 2小时30分后转谷'],
  ['2027-09-15T10:00:00+08:00', 'dsh-pkc-valley', '谷时 · 23小时0分后转峰'],
  ['2027-10-01T10:00:00+08:00', 'dsh-pkc-valley', '谷时 · 6天23小时后转峰'],
  ['2028-01-03T10:00:00+08:00', 'dsh-pkc-muted', '节假日表未覆盖 2028'],
];

for (const [instant, tone, text] of cases) {
  const seen = render(instant);
  assert.ok(seen.className.includes(tone), `${instant} tone: ${seen.className}`);
  assert.equal(seen.text, text, `${instant} text`);
}

// Colour is attention: identical hour, only the Turn state differs.
const running = render('2027-03-02T10:00:00+08:00', busy);
const atRest = render('2027-03-02T10:00:00+08:00');
assert.ok(running.className.includes('dsh-pkc-muted'), `running mutes: ${running.className}`);
assert.ok(atRest.className.includes('dsh-pkc-peak'), `idle colours: ${atRest.className}`);
assert.equal(running.text, atRest.text, 'state text is unaffected by the mute');

// The rail keeps the dot and the accessible caption.
clock.now = new NativeDate('2027-03-02T10:00:00+08:00').getTime();
const rail = Pill({ wide: false, t: translate('zh'), ...idle });
assert.ok(rail.props.className.includes('dsh-pkc-rail'));
assert.equal(textOf(rail).trim(), '', 'rail shows no text');

assert.equal(render('2027-03-02T10:00:00+08:00', {}, 'en').text, 'peak · 2h 0m to off-peak');
assert.equal(render('2028-01-03T10:00:00+08:00', {}, 'en').text, 'no holiday table for 2028');

console.log(`render: ${cases.length + 4} assertions passed`);
