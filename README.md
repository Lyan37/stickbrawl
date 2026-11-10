# Clazzique Brawl

Tiny browser 1v1 weapon brawler. It has an endless flat stage, HP-based rounds, and Brawlhalla-style weapon movesets.
The look follows YOMI Hustle (a white ruler floor, flat pastel silhouettes, warm orange hit sparks, steel-blue smears and sliced afterimages) over a pixel-art night stage: you fight on a misty lake under Mount Fuji, with a sakura shore, live water reflections and falling petals. Each fighter wears a cloth scarf (P1 red, P2 blue) that trails and flutters with their motion. Every match rolls a new sky (palette, stars, clouds, milky way), moon phase/position and set of sakura trees (`src/scenery.js`).
It's plain JavaScript with no build step and no dependencies.

Open `index.html` directly, or serve the folder with `python3 -m http.server`.

## Controls

| Action                          | P1             | P2          | Gamepad            |
| ------------------------------- | -------------- | ----------- | ------------------ |
| Move / aim (W = aim up only)    | WASD           | Arrows      | Stick / D-pad      |
| Jump                            | Space          | Up          | A                  |
| Light attack                    | J              | Z           | X                  |
| Heavy (recovery / ground pound) | K              | X           | B                  |
| Parry (tap) / crouch block (hold) | S            | Down        | Stick / D-pad down |
| Dodge / roll / dash             | L / Left Shift | Right Shift | Bumpers / triggers |
| Pick up / throw weapon          | H              | C           | Y                  |
| Pause                           | Esc / P        |             | Start              |

Each player has a **device**, KEYBOARD or GAMEPAD. By default P1 is on the keyboard and P2 is on a gamepad. If both players use gamepads, P1 takes the first connected pad and P2 the second. A gamepad player with no pad plugged in falls back to their keys.
In VS CPU, P1 is controlled by the keyboard (either key set) and every connected gamepad at once.

**CONTROLS** (title screen or pause menu) has one column per player, showing the bindings for that player's device:
- **DEVICE** row: press Enter to switch between KEYBOARD and GAMEPAD.
- **Action rows**: press Enter, then press the new key or gamepad button (Esc cancels; Start also cancels on a gamepad). On a gamepad, movement is always the stick and D-pad.
- **SWAP P1 / P2** swaps everything between the players: device, keys and gamepad buttons.
- **RESET TO DEFAULTS** restores the table above.

A key bound to one player is removed from the other. Esc, P and Start are reserved for pause. Settings are saved to `localStorage` (`classiquebrawl.keymaps.v1`, `classiquebrawl.devices.v1`, `classiquebrawl.padmaps.v1`; older `stickbrawl.keymaps.v1` saves are still read) and apply immediately, even mid-match.

## Mechanics (modelled on the Brawlhalla wiki)

- **Weapons:** sword, staff, greatsword, bow, scythe, rocket lance, gauntlets and axe, plus fists.
  - Weapons drop near the middle of the fight, never the same type twice in a row, and vanish after 30 s if nobody takes them.
  - Throw picks a weapon up, and throws it if you're already holding one. Thrown weapons bounce and stop hurting once they slow down.
  - Down + throw on the ground drops your weapon.
- **Lights:** each weapon has neutral, side and down lights, on the ground and in the air.
  - Diagonals count as vertical. Up-diagonal (or up) gives the neutral light. Down-diagonal gives the down light. Only pure left/right gives the side light, and the diagonal's left/right part still turns you. Unarmed ground heavies follow the same rule.
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
- **Combos:** recovery is 60% shorter when your move hits, so follow-ups connect.
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
- **Dodge** (constants in `DODGE`, `src/fighter.js`):
  - **8-way:** dodge + any of the 8 directions. With dodge ready it's an invincible dodge that way; on cooldown it's a dash that way (no invincibility).
  - Ground: there's no spot dodge. Neutral or straight down + dodge is the **burst** (below) when your bar is full, and does nothing otherwise. The press stays buffered, so a direction a moment later still rolls. Side or down-diagonal = roll along the floor (18f invincibility, 54f cooldown). Up or up-diagonal = directional dodge that lifts off (18f; ground cooldown, keeps your air dodge).
  - Air: neutral (26f) or directional in any of 8 directions (18f). Air dodge cooldown is 150f; landing 70f or more after the dodge clears it.
  - Leniency: a direction pressed up to 4f after dodge still turns a neutral dodge directional, or re-aims a dash. Dodge presses are buffered 12f.
  - **Dash (8-way):** dodge + direction while dodge is on cooldown, or double-tap left/right. Gravity is off during the dash.
    - Dashing up from the ground or dashing in the air uses your one air dash, which resets on landing or getting hit.
    - A down-diagonal air dash that hits the floor keeps sliding. You can roll out of a ground dash. Jumping out of a dash is a dash jump.
  - Gravity cancel: neutral air dodge, then light.
  - Chase dodge: landing a hit grants 2 dodges (grounded attack) or 1 (aerial). They're usable up to 18f after the attack ends, work in any direction (on the ground too, except neutral), and can be cancelled into an attack.
- **Burst** (`BURST`, YOMI Hustle style): dodge with **no direction** while your burst bar is full.
  - **Combo breaker:** works while you're in hitstun or blockstun, on the ground and in the air. A press during a hit freeze is buffered and bursts as soon as the freeze ends.
  - In neutral it replaces the old spot dodge. In the air a neutral dodge is still your air dodge (and gravity cancel) while you have one; after that it bursts.
  - Effect:
    - 14f of invincibility.
    - A shockwave hits the opponent within 60px: 2 chip damage (never lethal), a small knockback and 18f of stun.
    - Your move or hitstun is cancelled, and your air jumps, recovery and air dodge are refreshed. The last 6f are recovery.
    - Cyan screen flash.
  - **Meter:** the thin bar under each HP bar. It starts each round at 50% and fills over time (empty to full in about 60 s). Taking damage adds 3× the damage, dealing it adds 1×. It flashes cyan with **BURST** when full, and a burst empties it.
- **Crouch block** (`GUARD`): hold down on the ground. It blocks hits and projectiles from the front for 20% chip damage, plus pushback and blockstun (0.95× the move's stun, min 8f).
  - Ground pounds are overheads and break it. Hits from behind aren't blocked.
  - Chip that would KO lands as a real hit, so the finisher still plays.
  - A blocked move can't continue its on-hit follow-ups and gets its full recovery.
- **Parry** (`PARRY`): **tap down** on the ground. **Holding** down is the crouch block.
  - Pressing down starts your weapon's **parry move** (`PARRY_SWING` in `src/weapons.js`). Its first 8f are a crouched deflect pose, and that is the parry window. A melee hit caught in it is cancelled, the attacker reels for 38f and the screen flashes white.
  - **Hold:** if down is still held when the window closes, it becomes a crouch block with no swing.
  - **Tap that catches nothing:** no swing, just recovery, so a mistimed tap is punishable.
  - **Parry attack, on success only:** the weapon's parry attack fires automatically at the staggered attacker (2.5–4 damage). Then you go into the riposte pose for follow-ups.
    - It lunges in if they're out of reach, so it always connects.
    - Its startup is 6f after the parry freeze. There's no counter-parry: once you're parried, the strike lands.
  - Each weapon has its own deflect pose and parry attack:

    | Weapon | Deflect | Parry attack |
    | --- | --- | --- |
    | Fists | forearms up | palm strike |
    | Sword | blade upright | flick cut |
    | Staff | staff upright | butt thrust |
    | Greatsword | planted point-down | rising cut |
    | Bow | limb raised | bow bash |
    | Scythe | haft upright | hook sweep |
    | Rocket lance | shaft angled up | jab |
    | Gauntlets | forearms crossed | double punch |
    | Axe | haft up | chop |
  - Down + light / heavy / throw / dodge within 3f of the tap still gives the down move (down light, weapon drop, …) and refunds the parry.
  - One parry per ~1 s (60f cooldown), tapped or held. Down pressed in the air is a fast-fall, never a parry, so landing with down held just blocks.
  - On a parry you get 10f of invincibility and the parry cooldown resets. Projectiles get no parry attack: you go straight to the riposte pose.
  - **Riposte:** after the parry attack (or a projectile parry) you snap into a lunge with your weapon (or fist) aimed at the enemy's chest. A glint runs to the tip, and the aim tracks them for 24f. Any input cancels it, so the free punish isn't delayed.
  - Parried arrows/projectiles fly back and now belong to you; thrown weapons drop.
  - Ground only: there's no air parry, since down in the air is fast-fall.
- **Recovery frames** (`RECOVERY`): every committal action ends in recovery frames. That covers attack end-lag, dodge frames after the invincibility runs out, a whiffed parry and landing lag.
  - Recovery is 60% shorter when the move hits, base length when it's blocked, and 25% longer when it whiffs.
  - Hitstun is move stun × 1.32 (`HITSTUN_MUL`), so getting hit recovers fairly fast. Shorter on-hit recovery keeps every combo link at the same frame advantage.
  - Hitting someone during their recovery is a **punish**: +20% damage and +30% hitstun, and the screen flashes red.
  - **FRAME DATA** (title or pause menu) shows a frame meter: the last 60 frames per fighter coloured by phase, plus startup/active/recovery counts of the current or last action.
- **Weapon pickup:** grab reach leans into your movement, and an unarmed throw press stays buffered 16f. Pressing pick up slightly early while running or dashing still grabs the weapon, and dashing keeps its momentum through the grab.
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
