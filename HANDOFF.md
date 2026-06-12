# cc-aim-assist — handoff notes

Read this first. It captures the goal, the architecture decision, what's already scaffolded, and
exactly what to do next (including the CrossCode internals to verify). Written to pick up cleanly in
a fresh session **inside this repo**.

---

## Goal

Add **very gentle aim assist** to **CrossCode** when playing with an **analog controller** — biasing
the aim *slightly* toward the nearest enemy in a small cone. A nudge, not a lock-on. Motivation: the
controller is small (playing on an iPhone via [cc-ios](https://github.com/Yoyokrazy/cc-ios)) and
precise aiming is uncomfortable.

Constraints from the original ask:
- **Playing on a phone** → it must work through the cc-ios iOS wrapper.
- **"Not sure how mods should be compatible, but try"** → answered below: a CCLoader mod.
- **Reference how cc-ios does things** → conventions mirrored here (see "Conventions").

---

## Key decision: this is a CCLoader mod, not a native change

cc-ios is a WKWebView wrapper that already loads **CCLoader** mods (it has an in-game Mods tab and an
on-device installer). So the phone-compatible — and cross-platform — way to add aim assist is a
**CCLoader mod**, not Swift changes to cc-ios. The same `.ccmod` then works on desktop CrossCode too.

This mod is **pure logic and ships no assets**, which matters for cc-ios (see next section).

---

## Compatibility with cc-ios (the "how do mods work on the phone" question)

cc-ios loads the game in **browser mode** through CCLoader. The relevant constraints (from
cc-ios `AGENTS.md` → "CCLoader & mods") and how they apply here:

| cc-ios constraint | Why | Impact on this mod |
|---|---|---|
| Class hooks must run in the **`prestart`** stage | `postload`/`main` are too early/late — `sc.*` combat/player classes are defined by `game.compiled.js` by `prestart` | We use `prestart.js`. ✅ |
| Browser mode can't enumerate folders → mods listed in a static **`mods.json`** | No directory listing over the custom URL scheme | cc-ios synthesizes `mods.json`; nothing for us to do. ✅ |
| Packed `.ccmod` can't be read in browser mode → must be **unpacked to a folder** | The scheme handler serves files, not zip internals | Install as a folder (`tools/setup-ccloader.sh --add-mod`) or let cc-ios's on-device `ModFSBridge`/`ZipReader` unpack it. ✅ |
| A mod's bundled assets **must be in its manifest `assets` array** or they 404 — and a 404 at game init is **fatal** (CRITICAL BUG screen) | CCLoader browser-mode only maps declared assets | **We ship zero assets**, so this can't bite us. ✅ |
| Wrap mod setup/callbacks in **try/catch** | A thrown error can reach game init → CRITICAL BUG | The skeleton already does this. ✅ |

**Bottom line:** a pure-logic `prestart` mod with no assets is the safest kind for cc-ios. It should
"just work" once the aiming hook is wired.

### Installing into cc-ios
From a cc-ios checkout (after `make setup`):
```bash
tools/setup-ccloader.sh --add-mod /path/to/cc-aim-assist/mods/cc-aim-assist
```
or use the in-game **Mods** tab / on-device install. Then boot and check the JS console for
`[cc-aim-assist] loaded`.

---

## What's already in this repo (scaffolding)

```
mods/cc-aim-assist/
  ccmod.json     CCLoader manifest — prestart stage, no assets, crosscode ^1.1.0 || 1.0.2
  package.json   legacy CCLoader manifest mirror (cc-ios ships both; harmless to keep)
  prestart.js    SKELETON: real nudge math + a guarded injection scaffold; currently a safe no-op
```
`prestart.js` loads and logs but does **not** inject yet — it waits until the bindings + target class
are confirmed (so it can't break the game in the meantime). The geometry (cone test, nearest-enemy
search, capped angle lerp) is already written and is game-agnostic.

---

## Next: CrossCode internals to hook (VERIFY AT RUNTIME)

The exact class/method/field names below are **best-guess candidates** from CrossCode modding
knowledge and **must be confirmed against the running game** before wiring. Fill in the `Bind.*`
accessors in `prestart.js`, then uncomment the `sc.*.inject({ update … })` scaffold.

### Candidates to confirm
- **Player entity:** `ig.game.playerEntity`.
- **Aim / crosshair:** look for `sc.PlayerCrossHairController` and/or a crosshair controller on the
  player; the gamepad aim is derived from the **right-stick axes**. Find the field/method holding the
  *current aim angle or aim direction vector* and the per-frame `update()` that computes it. Inject
  there, read the computed aim, nudge it, write it back **before** it's used to fire.
- **Built-in assist?** Check whether CrossCode already has any gamepad target-assist/auto-aim to
  respect or coexist with (don't double-correct).
- **Enemy enumeration:** `ig.game.entities`, filtered to **alive enemy combatants**. Candidates:
  `entity instanceof ig.ENTITY.Combatant`, `entity.party === sc.COMBAT_PARTY.ENEMY`,
  `!entity.isDefeated?.()`.
- **Entity position:** `entity.getCenter()` or `entity.coll.pos` (a `Vec2`-ish `{x, y}`).
- **Injection pattern (Impact/CCLoader):**
  ```js
  sc.SomeClass.inject({
    update: function () { var r = this.parent(); /* read/modify aim */ return r; }
  });
  ```

### How to verify — cc-ios macOS harness (fast, no device, no signing)
From a cc-ios checkout with assets synced + CCLoader set up:
```bash
swift build
./.build/debug/webkit-harness --root app/Resources/game --entry ccloader/index.html \
  --prefer-m4a --mods-overlay /tmp/cc-overlay --poke --settle 12 \
  --eval '(function(){ var p = ig.game.playerEntity; return p && Object.keys(p).join(","); })()'
```
Probe ideas (run as separate `--eval`s):
- `Object.keys(ig.game.playerEntity)` — find the aim/crosshair field.
- `ig.game.playerEntity.crossHair || ig.game.playerEntity.controller` — inspect the crosshair owner.
- `ig.game.entities.length` and the shape of one entity (`getCenter`, `coll`, `party`, `isDefeated`).
- Search class names: `Object.keys(sc).filter(k => /Cross|Aim|Combat/i.test(k))`.
- Cross-check field/type names against **ultimate-crosscode-typedefs** (CCDirectLink) for the aiming
  classes once you know which class it is.

`--poke` advances past the splash into a New Game so combat/player objects exist. Use `--eval` with
synchronous XHR only (returning a Promise isn't supported by the harness).

---

## Design notes — keep it "very gentle"

- **Gate on intent:** only assist when the aim stick is actually pushed (magnitude > deadzone). Don't
  assist a neutral stick.
- **Small cone + limited range:** only consider enemies within ~±18° of current aim and within a
  modest pixel range. Tunables live in `CFG` at the top of `prestart.js`.
- **Fractional, capped pull:** rotate a *fraction* of the way to the target each frame (`pullFactor`)
  and clamp the per-frame correction (`maxPullDeg`). Never snap. No lock-on.
- **Nearest-in-cone wins:** pick the smallest angular error inside the cone, not strictly nearest by
  distance, so it tracks what you're pointing at.
- Ship with constants first; consider exposing options (CCLoader settings UI) later.

---

## Open questions for next session

1. Exact aiming class/method/field names (verify in harness; see candidates above).
2. Does CrossCode already do any gamepad aim assist we should respect/disable?
3. Best single injection point so the nudge covers the aim used by **both** ranged/thrown attacks and
   any aimed melee — or scope it to ranged only first.
4. Whether to gate the assist to "combat mode" only (avoid nudging while just walking/aiming at
   nothing) — the enemy-in-cone check mostly handles this already.
5. Config surface: hardcoded `CFG` for v0.1, then maybe CCLoader options.

---

## Conventions (mirrored from cc-ios)

- **Commit identity:** privacy-preserving GitHub `noreply` (`Yoyokrazy <…@users.noreply.github.com>`),
  **never** a corporate email. (Local repo git config is already set to this.)
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, scopes like `feat(mod):`).
- **TS/JS:** no `any`; narrow `unknown`. Comment only the non-obvious.
- **Never commit CrossCode assets** (copyrighted; BYO copy) or personal/machine data.
- This handoff file is the intentional exception to cc-ios's "no scratch markdown in the repo" rule —
  it was explicitly requested. Once the mod is implemented, fold the durable parts into `README.md` /
  an `AGENTS.md` and trim this.

## Status

Repo scaffolded and committed to `main`. Mod logic **not implemented** — it requires runtime
verification of the CrossCode aiming internals above. Start at "Next: CrossCode internals to hook".
