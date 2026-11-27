# dsh-peak-clock

A row above the account launcher in the DeepSeek Harness sidebar that says which
DeepSeek billing window you are in right now, and how long it lasts.

```
        ● 谷时 · 2天9小时后转峰
   [avatar] 17_qxm
```

- **Off-peak** paints `#4D6BFE`, **peak** paints `#D97757`.
- While the conversation in the main view is running a Turn, the colour drops out
  entirely — the dot turns into a hollow ring — so the row cannot compete with the
  work in progress. It colours itself again when the Turn settles.
- Collapsed to the 56px rail, only the dot remains; the caption stays available
  through `title` and `aria-label`.

## Rate rule

Beijing time, DeepSeek direct API: **Mon–Fri 09:00–12:00 and 14:00–18:00 are peak**.
Every other hour is off-peak, as is all day Saturday/Sunday and all Chinese
statutory holidays.

Those holiday dates come from the State Council notices (2026: 国办发明电〔2025〕7 号,
2027: 国办发明电〔2026〕10 号). They cannot be derived from astronomy — 春节, 端午 and
中秋 follow the lunar calendar, and the actual days off are a yearly 调休 decision — so
the table is data, not logic. Only 放假 dates are listed: weekends are already
off-peak and every 调休 workday falls on a weekend.

`COVERED_YEARS` in `src/client/index.ts` guards the table. Outside those years the
pill refuses to colour anything and reads `节假日表未覆盖 <year>` instead of silently
billing a 元旦 morning as peak.

## Layout

```
src/client/index.ts   the pill: rate maths, countdown, colour policy
src/host/index.ts     inert host half (a place to grow a Host side later)
scripts/build.mjs     ts.transpileModule -> index.js + client.js
test/render.mjs       renders the built bundle at fixed instants and asserts
```

`index.js` and `client.js` are generated; edit `src/` and run `npm run build`.

## Commands

```sh
npm install
npm run build      # regenerate the two bundles
npm run typecheck  # tsc --noEmit
npm test           # build, then assert the rendered pill
npm run check      # typecheck + "bundles are current" + test
```

## 中文

挂在侧栏账号行上方的一行：现在是不是峰时、还剩多久切换。谷时蓝 `#4D6BFE`、峰时橙
`#D97757`；主视图里的对话正在跑的时候颜色会整个收掉（实心点变空心圈），跑完自己亮回来。
侧栏收窄成 56px 时只留那个点。

节假日表按国务院通知维护，只覆盖 `COVERED_YEARS` 里列出的年份；超出范围时它会灰掉并
显示「节假日表未覆盖 XXXX」，不会猜。
