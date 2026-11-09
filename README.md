# Stick Brawl

Tiny browser 1v1 weapon brawler. It has an endless flat stage, HP-based rounds, and Brawlhalla-style weapon movesets.
The look follows YOMI Hustle (a white ruler floor, flat pastel silhouettes, yellow hit sparks, steel-blue smears and sliced afterimages) over a pixel-art night stage: you fight on a misty lake under Mount Fuji, with a sakura shore, live water reflections and falling petals. Each fighter wears a cloth scarf (P1 red, P2 blue) that trails and flutters with their motion. Every match rolls a new sky (palette, stars, clouds, milky way), moon phase/position and set of sakura trees (`src/scenery.js`).
It's plain JavaScript with no build step and no dependencies.

Open `index.html` directly, or serve the folder with `python3 -m http.server`.

## Controls

| Action                          | P1             | P2          | Gamepad            |
| ------------------------------- | -------------- | ----------- | ------------------ |
| Move / aim (W = aim up only)    | WASD           | Arrows      | Stick / D-pad      |
| Jump                            | Space          | Up          | A                  |
| Light attack                    | J              | Z           | X                  |
| Heavy (recovery / ground pound) | K              | X           | B                  |
| Dodge / dash                    | L / Left Shift | Right Shift | Bumpers / triggers |
| Pick up / throw weapon          | H              | C           | Y                  |
| Pause                           | Esc / P        |             | Start              |

In 1P mode, P1 can use either key set.

Keys can be rebound under **CONTROLS** (title screen or pause menu): pick a P1/P2 cell, press Enter, then press the new key (Esc cancels). Bindings are saved to `localStorage` (`stickbrawl.keymaps.v1`) and apply immediately, even mid-match. A key bound to one player is removed from the other. Esc and P are reserved for pause. **RESET TO DEFAULTS** restores the table above. Gamepad buttons are fixed.

## Mechanics (modelled on the Brawlhalla wiki)

- **Weapons:** sword, staff, greatsword, bow, scythe, rocket lance, gauntlets and axe, plus fists.
  - Weapons drop near the middle of the fight, never the same type twice in a row, and vanish after 30 s if nobody takes them.
  - Throw picks a weapon up, and throws it if you're already holding one. Thrown weapons bounce and stop hurting once they slow down.
  - Down + throw on the ground drops your weapon.
- **Lights:** each weapon has neutral, side and down lights, on the ground and in the air.
  - Many lights are strings that only continue if the first hit lands. Examples: sword nlight's 3rd slash, the bow's arrow after a melee hit.
  - You can't repeat the same light back-to-back.
- **Greatsword chain:** opener → bridge (a different direction) → closer (the same direction, or after a bridge). Gravity cancel goes straight to a closer.
- **Scythe:** some moves carry the target to your other side. Down light does it unless you hold forward. Neutral air and down air do it if you hold back.
- **Rocket lance:** side light, side air and down air are rocket-boosted jousts that ignore gravity and travel far.
  - Recovery: hold heavy to hover and charge; a longer charge launches you farther. On hit you stop dead and the target keeps flying.
  - Ground pound spikes downward.
- **Gauntlets:** a 5-punch neutral light (the last 2 only on hit), a hopping uppercut side light, and a ground-pound down light that starts combos.
  - Neutral air is a grab that throws downward; side air's second punch only comes out on hit.
  - You can steer the ground pound forward.
- **Bow:** move data matched to the brawlhalla.wiki.gg page (damage × 0.5, startup/active/gap frames as listed, hitstun and recovery scaled to this engine).
  - Bow: arrow shots visibly nock and draw the string (limbs flex, the draw hand pulls to the chin) and the string twangs on release. Neutral light fires up at 40°. Side light and neutral air fire their arrow 20f after a melee hit. Recovery travels diagonally, grabs, then shoots.
- **Axe:** a short double-bit hand axe. Slow, wide arcs and heavy hits. Down light hops forward and chops, popping the target up (main combo starter).
  - Side light is a stepping cleave; on hit an overhead slam follows. Neutral light is an anti-air scoop; neutral air arcs from behind to front.
  - Recovery whirls up with two dragging hits, then a launching cut.
- **Combos:** recovery is 45% shorter when your move hits, so follow-ups connect.
  - Pressing a direction up to 3 frames after light still picks the directional move (it never downgrades to neutral).
  - A buffered attack uses the direction you held when you pressed it, so tapping side+light during recovery gives the side move.
  - Side lights and side airs reach further and stand taller. Non-finisher hits push the target less sideways, and fast lunges brake on hit.
  - "Together" launchers (sword down light, scythe neutral light, gauntlets side light) carry you and the target up as a pair, so aerials connect.
  - Dodge pressed during a move that hit is held until the move ends, so the chase dodge always comes out; you can cancel it into an attack from frame 1.
  - Hitting 5 or more times in a combo, or a big launch, triggers speed lines.
  - **Combo decay** keeps every loop finite. Brawlhalla scales knockback with damage taken; HP rounds can't, so hitstun decays instead:
    - The starter and first follow-up get full hitstun. From the 3rd move on, each new move gets 10% less (floor 55%).
    - A move already used in the same combo gets 35% less hitstun (stale).
    - Projectile hitstun falls off with travel distance: 100% up to 30px, falling to 50% at 140px. Ranged weapons confirm up close, not from across the screen.
  - Dodging is locked for 7f after an attack that whiffs (Brawlhalla rule), so missing is punishable.
- **Heavy:** in the air, heavy is recovery and down + heavy is a ground pound.
  - Weapon ground heavies are signatures, so they aren't in this game. Unarmed ground heavies are: an uppercut, a lunge punch and a breakdance spin. Hold heavy to charge them.
- **Landing aerials:** an aerial that touches the ground keeps playing (Brawlhalla's grounded variant) and adds its landing lag to the recovery. It no longer vanishes, so late aerials hit grounded opponents. Air control during aerials is 80%.
- **Recovery any time you're airborne:** no jump needed first. Jump + heavy together goes straight into recovery, and heavy cancels the recovery frames of an airborne attack (e.g. after a launcher hop) or an air dodge's end-lag.
- **Air budget:** 2 air jumps + 1 recovery. Extra recoveries are weaker and each costs a jump. Getting hit while out of jumps gives you one back.
- **Dodge:**
  - Ground: spot dodge (16f invincibility, 60f cooldown).
  - Air: neutral (20f) or directional (12f). Air dodge cooldown is 163f; landing 75f or more after the dodge clears it.
  - Dash: dodge + side, or double-tap. Jumping out of a dash is a dash jump.
  - Gravity cancel: neutral air dodge, then light.
  - Chase dodge: landing a hit grants 2 dodges (grounded attack) or 1 (aerial). They're usable up to 12f after the attack ends, work in any direction (on the ground too), and can be cancelled into an attack.
- **Rounds:** first to 2. The timer is 99 s, and higher HP wins on time-out.

## Files

`src/weapons.js` holds all move data (parts, frame data, hitboxes, poses), so most balance changes go there. Damage is roughly the wiki value × 0.5.
Combo decay constants are `COMBO` in `src/fighter.js`.

**Finishers** (`src/kills.js`): the weapon that lands the killing blow picks a unique KO animation, named under the K.O. banner. Thrown weapons use their own type; arrows count as bow.

| Weapon       | Finisher                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Fists        | KNOCKED OUT: comic POW burst, spins through the air, lands seeing stars                                                |
| Sword        | SLICED: one hair-thin cut across the whole screen, the top half slides off                                             |
| Staff        | BATTERED: staff hurled spinning from the hand, juggles them in place, bats them away, then boomerangs back to the hand |
| Greatsword   | CRUSHED: spiked into the floor, leaving a cracked crater                                                               |
| Bow          | PINCUSHIONED: staggers back as three more arrows thunk in                                                              |
| Scythe       | REAPED: the world goes dark, they kneel and the soul drifts up                                                         |
| Rocket lance | LIFTOFF: rocketed into the sky, explodes at the top and falls charred                                                  |
| Gauntlets    | PLOWED: shock rings, then blasted along the floor gouging a glowing trail                                              |
| Axe          | CLEAVED: a vertical chop from the sky, the two halves topple apart                                                     |

#Wukong
