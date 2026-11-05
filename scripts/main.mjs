/**
 * Token Movement Restrictions for Foundry VTT v14.
 * A gameplay convenience, not a server-enforced anti-cheat mechanism.
 *
 * The preMoveToken hook covers standard v14 token movement (including ruler,
 * drag, and keyboard movement). The preUpdateToken hook catches direct edits
 * of token elevation and position in token configuration or module scripts.
 */
const MODULE_ID = "token-movement-restrictions";

// A trusted automation that runs on the *same* client can explicitly opt out
// of these checks with the module API's withMovementOverride(token, callback).
const bypassDepth = new WeakMap();
const lastWarning = new Map();
const warningIntervalMs = 1000;

function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function equal(a, b) {
  return Math.abs(n(a) - n(b)) < 0.0001;
}

function hasOwn(object, prop) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, prop);
}

/** Return true if the dnd5e actor has an effective fly speed above zero. */
function canFly(document) {
  if (!setting("allowFlying")) return false;
  const movement = document.actor?.system?.attributes?.movement;
  let fly = movement?.speeds?.fly ?? movement?.fly ?? 0;
  // Future/custom schemas sometimes expose movement objects.
  if (fly && typeof fly === "object") fly = fly.value ?? fly.total ?? 0;
  return n(fly) > 0;
}

function isExempt(document) {
  return Boolean(game.user?.isGM || (document && (bypassDepth.get(document) ?? 0) > 0));
}

async function withMovementOverride(document, callback) {
  if (!document || typeof callback !== "function") {
    throw new TypeError("withMovementOverride requires a token document and an async callback");
  }
  bypassDepth.set(document, (bypassDepth.get(document) ?? 0) + 1);
  try {
    return await callback();
  } finally {
    const depth = (bypassDepth.get(document) ?? 1) - 1;
    if (depth <= 0) bypassDepth.delete(document);
    else bypassDepth.set(document, depth);
  }
}

function warn(document, type, message) {
  if (!setting("showWarnings")) return;
  const key = `${document.parent?.id ?? ""}:${document.id}:${type}`;
  const now = Date.now();
  if (now - (lastWarning.get(key) ?? 0) < warningIntervalMs) return;
  lastWarning.set(key, now);
  ui.notifications?.warn(message);
  // Keep this cache small even after long gaming sessions.
  if (lastWarning.size > 250) lastWarning.clear();
}

function sameFloorAndElevation(a, b) {
  // Levels are different floors, even if they share the same map coordinates.
  if (String(a.level ?? "") !== String(b.level ?? "")) return false;
  return equal(a.elevation, b.elevation);
}

function rect(position, gridSize) {
  return {
    left: n(position.x),
    top: n(position.y),
    right: n(position.x) + n(position.width, 1) * gridSize,
    bottom: n(position.y) + n(position.height, 1) * gridSize
  };
}

function intersects(a, b) {
  // Touching edges does not count as overlap.
  const tolerance = 0.001;
  return a.left < b.right - tolerance && a.right > b.left + tolerance &&
         a.top < b.bottom - tolerance && a.bottom > b.top + tolerance;
}

function isOccupied(document, destination) {
  const scene = document.parent;
  const gridSize = n(scene?.grid?.size);
  if (!gridSize) return false;
  const desired = rect(destination, gridSize);

  for (const other of scene.tokens ?? []) {
    if (other.id === document.id) continue;
    if (setting("ignoreHidden") && other.hidden) continue;
    if (!setting("blockNPCs") && !other.actor?.hasPlayerOwner) continue;
    if (!sameFloorAndElevation(destination, other)) continue;
    if (intersects(desired, rect(other, gridSize))) return true;
  }
  return false;
}

function elevationChanged(from, to) {
  return !equal(from.elevation, to.elevation) ||
         String(from.level ?? "") !== String(to.level ?? "");
}

function validate(document, from, to) {
  if (isExempt(document)) return true;

  if (setting("lockElevation") && !canFly(document) && elevationChanged(from, to)) {
    warn(document, "height", "Only the GM or a character with a flying speed can change elevation or floor.");
    return false;
  }

  if (setting("preventOverlap") && isOccupied(document, to)) {
    warn(document, "overlap", "That destination is occupied by another token.");
    return false;
  }

  return true;
}

function registerSettings() {
  const entries = [
    ["lockElevation", "Restrict manual elevation", "Prevent non-GM players from changing their token's elevation or level unless flying is allowed.", true],
    ["allowFlying", "Allow flying creatures to change elevation", "Let players change elevation when their actor has an effective flying speed above zero (including one granted by a spell).", true],
    ["preventOverlap", "Prevent token overlap", "Prevent players from ending token movement in another token's occupied area. Movement through occupied spaces is not blocked.", true],
    ["blockNPCs", "Include NPCs in overlap checks", "Also block ending movement on the space of a non-player-owned token. If off, only other player-owned tokens are considered.", true],
    ["ignoreHidden", "Ignore hidden tokens", "Do not block players on a hidden token's location, which could otherwise reveal its presence.", true],
    ["showWarnings", "Show warnings when movement is blocked", "Display a short notification when a player attempts a restricted move.", true]
  ];

  for (const [key, name, hint, defaultValue] of entries) {
    game.settings.register(MODULE_ID, key, {
      name,
      hint,
      scope: "world",
      config: true,
      type: Boolean,
      default: defaultValue,
      requiresReload: false
    });
  }
}

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = { withMovementOverride };
});

Hooks.on("preMoveToken", (document, movement) => {
  if (!document?.parent || !movement?.origin || !movement?.destination) return;
  return validate(document, movement.origin, movement.destination);
});

Hooks.on("preUpdateToken", (document, changes) => {
  if (!document?.parent || !changes || isExempt(document)) return;
  // Normally v14 movement calls preMoveToken. This is a defensive fallback
  // for direct edits to the token's Document data (including the HUD).
  const positionFields = ["x", "y", "width", "height", "elevation", "level"];
  if (!positionFields.some(field => hasOwn(changes, field))) return;

  const destination = {};
  for (const field of positionFields) {
    destination[field] = hasOwn(changes, field) ? changes[field] : document[field];
  }

  return validate(document, document, destination);
});

/**
 * Disable the standard HUD/config elevation controls for non-flying players.
 * The document hooks above remain the definitive check (shortcuts and other
 * UI paths also call updates). Other modules may draw their own controls.
 */
function disableElevationInputs(app, html) {
  const document = app.document ?? app.object?.document;
  if (!document?.parent || isExempt(document) || !setting("lockElevation") || canFly(document)) return;
  const root = html?.[0] ?? html ?? app.element;
  if (!root?.querySelectorAll) return;
  const controls = root.querySelectorAll(
    'input[name="elevation"], input[name="level"], [data-action="level"]'
  );
  for (const control of controls) {
    if ("disabled" in control) control.disabled = true;
    control.setAttribute("aria-disabled", "true");
    control.setAttribute("title", "Elevation is controlled by the GM unless this token has a flying speed.");
  }
}

Hooks.on("renderTokenHUD", disableElevationInputs);
Hooks.on("renderTokenConfig", disableElevationInputs);
