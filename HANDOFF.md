# cc-aim-assist — engine internals & dev notes

Durable reference for working on this mod: the CrossCode internals it hooks (verified against the
real `game.compiled.js` v1.4.2 and `ultimate-crosscode-typedefs`), how the lock is implemented, and
how to prove changes in the cc-ios macOS harness. User-facing docs live in [`README.md`](README.md).

## Status

**Implemented.** Lock-on controller aim assist + two options in the in-game Assists menu. Verified in
the cc-ios macOS WebKit harness: boots with `jsErrors=0`, options register and persist, labels
resolve, and a live engine test confirms the snap re-centers aim onto an enemy with the throw
distance preserved and **zero** spread penalty. Pure aiming math has unit tests
(`window.ccAimAssist`).

## Key decision: a CCLoader `prestart` mod, not native changes

cc-ios is a WKWebView wrapper that already loads **CCLoader** mods, so the phone-compatible *and*
cross-platform way to add aim assist is a **CCLoader mod**, not Swift changes. The same mod runs on
desktop CrossCode (NW.js) and inside cc-ios (WebKit), because it touches only **core engine classes**
— no NW.js/desktop- or iOS-specific APIs. Class hooks must run in the **`prestart`** stage (after
`game.compiled.js` defines `sc.*`); `postload`/`main` are too early/late. The mod **ships no assets**,
so it can never 404 (a fatal error at game init under cc-ios's browser-mode loader).

## CrossCode internals this mod hooks (verified)

Throw aiming flows through the player's crosshair entity and its controller:

- **Player / crosshair:** `ig.game.playerEntity.gui.crosshair` is an `ig.ENTITY.Crosshair`; its
  `controller` is an `sc.PlayerCrossHairController`.
- **Per frame, `ig.ENTITY.Crosshair.deferredUpdate()`:**
  1. `this.controller.updatePos(this)` — sets `crosshair.coll.pos`. In gamepad mode it's
     `throwerPos + lerp(prevOffset, rightStickTarget)`; otherwise it's the mouse→map position.
  2. `a = coll.pos - throwerPos` (raw offset vector); `b = Vec2.angle(a, this._lastDir)`.
     If `!special && b > 2*maxAngleMove` (`maxAngleMove = PI/128` ≈ 1.4°), it **widens the spread**:
     `rangeCurrent += b/2 * (1 - AIM_STABILITY)`. (This is the "your aim got knocked off" penalty.)
  3. `_lastDir = a; _aimDir = a`.
- **Aim direction = `normalize(coll.pos - throwerPos)`; throw distance/range = `|coll.pos - throwerPos|`.**
- **Spread output:** `getThrowDir(v)` returns `_aimDir` rotated by a random `±rangeCurrent/2`. Each
  frame `rangeCurrent` also **decays** (lines tighten to a point) unless the penalty above re-grows it.
  `getThrowDir`'s result becomes `player.throwDir`, which is consumed as a **direction** (assigned to
  `this.face`) — so only its angle matters to the throw, not its magnitude.
- **Gamepad gate:** `controller.gamepadMode` is latched true at aim-start if the right stick was down
  (`sc.control.isRightStickDown()`); mouse aiming keeps it false.
- **Enemies:** scan `ig.game.entities` for `e.isCombatant === true && e.party ===
  sc.COMBATANT_PARTY.ENEMY` (`PLAYER=1, ENEMY=2, OTHER=3`) and `!e.isDefeated()`; position via
  `e.getCenter(vec)`.

There is **no pre-existing gamepad auto-aim** in CrossCode to coexist with.

## How the lock is implemented

Inject `sc.PlayerCrossHairController.updatePos`. After `this.parent(crosshair)` (so the game has
already positioned the crosshair from the stick):

1. Gate: enabled option on, `controller.gamepadMode`, `crosshair.active`, slider cone > 0.
2. Find the alive enemy whose **angle** from the thrower is nearest the current aim, within the
   slider-controlled cone (with a `*1.5` release cone for hysteresis on the held target).
3. **Snap:** rotate `coll.pos` to point exactly at that enemy while **preserving `|offset|`** (throw
   range/speed unchanged — only the angle changes).
4. **Neutralize the spread penalty:** set `crosshair._lastDir` to the snapped offset, so step (2) of
   `deferredUpdate` sees `b ≈ 0` and never grows `rangeCurrent` from the snap. The normal per-frame
   decay still runs, so the spread still tightens to a line — now centered on the enemy.

Why this satisfies "don't affect the spread": the only thing the snap changes is the aim *angle*; it
never feeds the spread-growth path, and it preserves the offset magnitude the throw uses. Tunables
(`maxConeDeg`, `rangePx`, `releaseFactor`, `pull`) live in `CFG` at the top of `prestart.js`.

## Assists-menu integration

- Register two entries in `sc.OPTIONS_DEFINITION` at `prestart` (so the option model picks up their
  `init` defaults and persists them):
  - `aim-assist-enabled` — `CHECKBOX`, `init: true`, `cat: sc.OPTION_CATEGORY.ASSISTS`, `header:
    "aimAssist"`, `hasDivider: true` (the header text is what creates the new "Aim Assist" section).
  - `aim-assist-strength` — `ARRAY_SLIDER`, `data: [0, 1]`, `init: 0.5`, `cat: ASSISTS`, `fill: true`
    (a continuous 0–100% slider; `strength → cone half-angle`).
- **Labels:** inject `ig.Lang.get` to return our strings for `sc.gui.options.headers.aimAssist` and
  `sc.gui.options.aim-assist-*.name` / `.description`, delegating every other key to `this.parent`.
- **Read live:** `sc.options.get("aim-assist-enabled")` / `get("aim-assist-strength")`.

The shapes mirror the game's own assists options (`assist-damage`, `assist-puzzle-speed`, …), and the
option model builds menu rows by iterating `OPTIONS_DEFINITION` filtered by `cat` — so our entries
render as a normal section.

## Verifying in the cc-ios macOS harness (local, no device)

From a cc-ios checkout with assets synced (`tools/sync-assets.sh`) and CCLoader + this mod installed
(`tools/setup-ccloader.sh [--add-mod …]`):

```bash
swift build
./.build/debug/webkit-harness --root app/Resources/game --entry ccloader/index.html \
  --prefer-m4a --mods-overlay /tmp/cc-overlay --timeout 120 \
  --eval '(function(){return JSON.stringify({
     enabled: sc.options.get("aim-assist-enabled"),
     strength: sc.options.get("aim-assist-strength"),
     header: ig.lang.get("sc.gui.options.headers.aimAssist"),
     ctrl: typeof sc.PlayerCrossHairController.prototype.updatePos
  });})()'
```

Notes:
- `--eval` runs at the **title screen** (`ig.game.playerEntity` is null there), and `--poke` is
  ignored when `--eval` is set. Static class probes and synthetic tests work fine at the title:
  construct a real `new sc.PlayerCrossHairController()`, a stub crosshair (`coll.pos`, `_lastDir`,
  `_getThrowerPos`), and temporarily set `ig.game.entities` to a fake enemy to exercise the injected
  `updatePos`. Use synchronous code only (returning a Promise isn't supported).
- The pure math (`window.ccAimAssist.selectTarget` / `coneRadFor` / `nudgeAngle`) can be unit-tested
  in plain Node by loading `prestart.js` with stubbed `window`/`sc`/`ig` globals.
- Success line: `bootstrap=true platform=Browser jsErrors=0`.
- Headless caveat: the title→options menu *visual* transition doesn't always paint in the harness,
  but the option model still selects the Assists tab without error — verify the menu by data
  (`OPTIONS_DEFINITION` ordering + `ig.lang.get`) rather than a screenshot.

## Packaging

`tools/build-ccmod.sh` zips `mods/cc-aim-assist/` into `dist/<id>-<version>.ccmod` (manifest at the
archive root; `prestart.js` syntax-checked first). The same `.ccmod` installs on desktop CCLoader and
cc-ios. Built artifacts (`*.ccmod`, `dist/`) are git-ignored.

## Conventions

- **Commits:** privacy-preserving GitHub `noreply` identity (never a corporate email);
  [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`,
  scopes like `feat(mod):`).
- **JS:** no `any` in TS; narrow `unknown`. Comment only the non-obvious. Keep the hook in `try/catch`.
- **Never commit CrossCode assets** (copyrighted; BYO copy) or personal/machine data.
