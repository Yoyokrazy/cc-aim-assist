# cc-aim-assist

Very gentle **controller aim assist** for **[CrossCode](https://store.steampowered.com/app/368340/CrossCode/)**,
delivered as a **CCLoader mod** so it works on desktop *and* on iPhone/iPad via
**[cc-ios](https://github.com/Yoyokrazy/cc-ios)**.

> ### ⚠️ You must own CrossCode. This repo contains **no game code or assets** — only a small mod.

The idea: when you're aiming with an analog stick, bias the aim direction *slightly* toward the
nearest enemy inside a small cone. It's a **nudge, not a lock-on** — meant to make a tiny controller
comfortable without taking over the fight.

> **Status: scaffolding only.** The mod logic isn't implemented yet. See
> **[`HANDOFF.md`](HANDOFF.md)** for the plan, the CrossCode internals to hook, and how to verify
> them in the cc-ios macOS harness.

## How it works (planned)

A **pure-logic CCLoader mod** (ships no assets) that hooks CrossCode's gamepad aiming in the
`prestart` stage and nudges the computed aim angle toward a nearby enemy. Shipping no assets means
there's nothing to 404 — the safest kind of mod for the browser-mode loader that cc-ios uses.

## Compatibility with cc-ios (playing on a phone)

cc-ios already loads CCLoader mods (in-game **Mods** tab + on-device install). A pure-logic mod like
this one drops straight in. Install it with cc-ios's `tools/setup-ccloader.sh --add-mod` or via the
in-game manager. The browser-mode constraints (run in `prestart`, static `mods.json`, mods unpacked
to folders, no un-manifested assets) are documented in [`HANDOFF.md`](HANDOFF.md).

## Repo layout

```
cc-aim-assist/
  README.md
  HANDOFF.md                 handoff notes — read this first
  LICENSE                    MIT (this mod's own code only)
  mods/cc-aim-assist/
    ccmod.json               CCLoader manifest (prestart stage, no assets)
    package.json             legacy CCLoader manifest mirror
    prestart.js              the hook — skeleton; implement after verifying internals
```

## Legal

Unofficial fan project, **not affiliated with, authorized, or endorsed by Radical Fish Games**.
Contains no CrossCode code or assets. This mod's own source is MIT (see [`LICENSE`](LICENSE)).
CrossCode and [CCLoader](https://github.com/CCDirectLink/CCLoader) belong to their respective owners.
