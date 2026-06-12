/* cc-aim-assist — very gentle controller aim assist for CrossCode.
 *
 * STATUS: SKELETON. The math here is real and testable; the CrossCode bindings are NOT
 * wired yet, so this mod is currently a safe no-op (it loads and logs, nothing else).
 * See HANDOFF.md -> "CrossCode internals to hook" for exactly what to verify and fill in.
 *
 * Approach: in the `prestart` stage (after game.compiled.js defines sc.*), inject the
 * gamepad aim update so that — each frame the player is actively aiming — we rotate the
 * computed aim angle a *fraction* of the way toward the nearest enemy inside a small cone.
 * It is a nudge, not a lock-on. All work is wrapped in try/catch so a mod error can never
 * reach the game's init (which would show the CRITICAL BUG screen).
 */
(function () {
	"use strict";

	// ---- Tuning (start gentle) -------------------------------------------------------
	var CFG = {
		coneDeg: 18,        // only assist enemies within this half-angle of the current aim
		rangePx: 220,       // ignore enemies farther than this (world px)
		maxPullDeg: 6,      // never rotate the aim more than this per frame
		pullFactor: 0.20,   // rotate this fraction of the way toward the target each frame
		stickDeadzone: 0.5  // only assist when the aim stick is pushed past this magnitude
	};

	// ---- Pure math (game-agnostic, unit-testable) ------------------------------------
	var TAU = Math.PI * 2;
	function norm(a) { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; }
	function angleDelta(a, b) { return norm(b - a); } // shortest signed a -> b (radians)
	function nudgeAngle(aim, target, pullFactor, maxPull) {
		var step = angleDelta(aim, target) * pullFactor;
		if (step > maxPull) step = maxPull;
		if (step < -maxPull) step = -maxPull;
		return norm(aim + step);
	}

	// ---- BINDINGS — VERIFY THESE IN THE HARNESS (see HANDOFF.md) ----------------------
	// Conservative stubs that keep the mod a safe NO-OP until the real CrossCode accessors
	// are confirmed via `--eval` probes. Fill these in and the generic logic below works.
	// Likely candidates noted inline — confirm names against the running game / typedefs.
	var Bind = {
		// Player entity. Likely: ig.game.playerEntity
		player: function () { return null; /* TODO */ },
		// World position {x,y} of an entity. Likely: e.getCenter() or e.coll.pos
		posOf: function (e) { return null; /* TODO */ },
		// Alive enemies. Likely: ig.game.entities filtered to combatants on the ENEMY party
		// (instanceof ig.ENTITY.Combatant, e.party === sc.COMBAT_PARTY.ENEMY, !e.isDefeated()).
		enemies: function () { return []; /* TODO */ },
		// Current analog aim vector {x,y} (right stick) — used only for the deadzone gate.
		aimStick: function () { return null; /* TODO */ },
		// Read the aim angle (radians) the game is about to use.
		getAimAngle: function (player) { return null; /* TODO */ },
		// Write the nudged aim angle (radians) back.
		setAimAngle: function (player, angle) { /* TODO */ }
	};

	// ---- Core: pick the best target and compute the assisted angle --------------------
	function assistedAngle(player) {
		var stick = Bind.aimStick();
		if (stick) {
			var mag = Math.sqrt(stick.x * stick.x + stick.y * stick.y);
			if (mag < CFG.stickDeadzone) return null; // not actively aiming -> no assist
		}

		var aim = Bind.getAimAngle(player);
		if (aim == null) return null;

		var p = Bind.posOf(player);
		if (!p) return null;

		var cone = CFG.coneDeg * Math.PI / 180;
		var best = null, bestErr = cone;
		var list = Bind.enemies() || [];
		for (var i = 0; i < list.length; i++) {
			var ep = Bind.posOf(list[i]);
			if (!ep) continue;
			var dx = ep.x - p.x, dy = ep.y - p.y;
			var dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > CFG.rangePx || dist === 0) continue;
			var err = Math.abs(angleDelta(aim, Math.atan2(dy, dx)));
			if (err < bestErr) { bestErr = err; best = Math.atan2(dy, dx); }
		}
		if (best == null) return null; // nothing in the cone -> leave aim untouched

		return nudgeAngle(aim, best, CFG.pullFactor, CFG.maxPullDeg * Math.PI / 180);
	}

	// ---- Injection scaffold -----------------------------------------------------------
	// TODO: replace the target class+method below with the verified one that computes the
	// gamepad aim each frame (see HANDOFF.md). The pattern:
	//
	//   sc.PlayerCrossHairController.inject({
	//     update: function () {
	//       this.parent();
	//       try {
	//         var player = Bind.player();
	//         if (!player) return;
	//         var a = assistedAngle(player);
	//         if (a != null) Bind.setAimAngle(player, a);
	//       } catch (e) { console.error("[cc-aim-assist] non-fatal:", e); }
	//     }
	//   });
	try {
		if (typeof sc === "undefined") {
			console.warn("[cc-aim-assist] sc.* unavailable; skipping (wrong load stage?)");
			return;
		}
		// Intentionally not injecting yet — wire Bind + the target class first (HANDOFF.md).
		console.log("[cc-aim-assist] loaded (skeleton; aim assist not yet wired — see HANDOFF.md)");
	} catch (e) {
		console.error("[cc-aim-assist] init failed (non-fatal):", e);
	}
})();
