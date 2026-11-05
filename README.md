# Token Movement Restrictions (v1.0.0)

Small, standalone Foundry VTT v14 module. Intended for a D&D 5e 2024 world, but the overlap feature is system-agnostic. No dependency on Midi-QOL, CAT, or Chris's Premades.

## Install

1. Back up your world.
2. Unzip the archive into your **Foundry User Data** `Data/modules/` folder, so the resulting path is:
   `Data/modules/token-movement-restrictions/module.json`
3. Restart Foundry if it was running.
4. Open the world as GM, then **Game Settings → Manage Modules**, enable **Token Movement Restrictions**, and save.
5. Open **Game Settings → Configure Settings → Module Settings → Token Movement Restrictions** and adjust the world settings.

This is a local ZIP, not an online Foundry manifest; it cannot be installed by pasting a sandbox link into the manifest URL box.

## Default behavior

- Standard token HUD/configuration elevation inputs are disabled for non-flying players (when present). In addition, non-GM users cannot change token elevation or level unless their token's **effective flying speed is above zero**. The module reads D&D 5e's `actor.system.attributes.movement.speeds.fly`; spells such as **Fly** qualify if their automation correctly applies a fly speed to the actor.
- Non-GM users cannot *finish* movement overlapping another token at the same elevation and level. Passing through another token's space isn't checked, and GM movement is never blocked.
- NPCs count as occupied spaces, but hidden tokens are ignored so their positions aren't revealed.
- Token size is supported (for example 2×2 tokens). Overlap is calculated using rectangular token bounds on a standard square grid.
- The GM can independently enable/disable elevation locking and overlap prevention, plus toggle NPC collisions, hidden-token checks, flying exceptions, and warnings.

## Important limitations

- **Not server-side anti-cheat enforcement.** Foundry document pre-hooks run on the client initiating updates; this module is designed to stop accidental or normal UI misuse, not a malicious user running custom JavaScript.
- **Automated elevation:** GM-initiated updates are unrestricted. A player-initiated automation that changes elevation for a token without an effective fly speed may also be blocked. For trusted macros or integrations that run client-side, use the API below. The module does not try to guess whether a change came from a UI control or another module, because that would be unreliable.
- **Fly spell:** the module doesn't grant any flying speed itself; Midi-QOL/CPR or the D&D system must actually apply that speed before players can change altitude.
- **Stairs, ladders and jumps:** non-flying players need GM elevation adjustment or a compatible automation exception; these aren't automatically detected.
- **Collision geometry:** axis-aligned rectangular bounding boxes are used. This is intended for normal square-grid scenes; hexes, unusual shapes, and gridless layouts can give imprecise results.
- Only tokens at the **same exact elevation and level** block each other. This allows visually stacked flying/ground tokens at different heights.
- Only destination overlap is checked; the module does not enforce movement distance, walls, turn order, or D&D action economy.
- Tested using mock Foundry hooks and geometry checks; **not tested inside a live Foundry v14 world**.

## Trusted client-side automation exception

For a macro or module that intentionally moves a non-flying token vertically, call the exposed API around the token update/movement **on the client that initiates it**:

```js
const tokenDoc = canvas.tokens.controlled[0]?.document;
const tmr = game.modules.get("token-movement-restrictions")?.api;
await tmr.withMovementOverride(tokenDoc, async () => {
  await tokenDoc.update({ elevation: 15 });
});
```

**Use for trusted automations only.** This bypass also permits movement onto an occupied square while it is active. For a fully automated spell which actually grants flying speed, this exception isn't needed.

## Uninstall

Disable in **Manage Modules**, then optionally delete the `Data/modules/token-movement-restrictions/` directory. Settings and this module don't alter token/actor data on their own.
