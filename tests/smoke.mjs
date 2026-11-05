import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const callbacks = {};
const values = new Map();
const warnings = [];
const mod = {};

globalThis.Hooks = {
  once(name, fn) { callbacks[`once:${name}`] = fn; },
  on(name, fn) { callbacks[name] = fn; }
};
globalThis.game = {
  user: { isGM: false },
  modules: new Map([["token-movement-restrictions", mod]]),
  settings: {
    register(_mod, key, spec) { values.set(key, spec.default); },
    get(_mod, key) { return values.get(key); }
  }
};
globalThis.ui = { notifications: { warn(message) { warnings.push(message); } } };

const script = path.resolve("scripts/main.mjs");
await import(pathToFileURL(script));
callbacks["once:init"]();
assert.equal(values.size, 6);

function setup() {
  const scene = { id: "scene", grid: { size: 100 }, tokens: [] };
  function token(id, { x=0, y=0, width=1, height=1, elevation=0, level="", fly=0, pc=true, hidden=false } = {}) {
    const result = { id, parent: scene, x, y, width, height, elevation, level, hidden,
      actor: { hasPlayerOwner: pc, system: { attributes: { movement: { speeds: { fly } } } } } };
    scene.tokens.push(result);
    return result;
  }
  return { scene, token };
}
function move(doc, dest) {
  return callbacks.preMoveToken(doc, { origin: {x:doc.x,y:doc.y, width:doc.width,height:doc.height, elevation:doc.elevation,level:doc.level},
    destination: {x:doc.x,y:doc.y,width:doc.width,height:doc.height,elevation:doc.elevation,level:doc.level,...dest} });
}
function update(doc, change) {
  return callbacks.preUpdateToken(doc, change);
}

{
  const {token} = setup();
  const a = token("a");
  token("b", {x:100});
  assert.equal(move(a,{x:100}),false,"blocked same square");
  assert.equal(move(a,{x:200}),true,"empty square");
  assert.equal(move(a,{x:100,y:100}),true,"edge touch");
  assert.equal(update(a,{x:100}),false,"block direct x update");
  assert.equal(update(a,{elevation:5}),false,"block direct elevation");
  assert.equal(move(a,{elevation:5}),false,"block movement elevation");
}
{
  const {token} = setup();
  const a=token("a",{fly:60}); token("b",{x:100});
  assert.equal(move(a,{elevation:10}),true,"fly speed allows elevation");
  assert.equal(update(a,{level:"upper"}),true,"fly speed allows level");
  assert.equal(move(a,{x:100}),false,"flying still collides with occupied same elevation");
  assert.equal(move(a,{x:100,elevation:10}),true,"different height permitted");
  a.actor.system.attributes.movement.speeds.fly=0;
  assert.equal(move(a,{elevation:10}),false,"lost flight: no manual elevation");
}
{
  const {token} = setup();
  const a=token("a",{width:2,height:2}); token("b",{x:200,y:100});
  assert.equal(move(a,{x:100}),false,"larger token footprint");
  assert.equal(move(a,{x:0}),true,"large token touches edge");
}
{
  const {token} = setup();
  const a=token("a"); token("npc",{x:100,pc:false});
  assert.equal(move(a,{x:100}),false,"NPC counts by default");
  values.set("blockNPCs",false);
  assert.equal(move(a,{x:100}),true,"NPC ignored if option disabled");
  values.set("blockNPCs",true);
}
{
  const {token} = setup();
  const a=token("a"); token("hidden",{x:100,hidden:true});
  assert.equal(move(a,{x:100}),true,"hidden ignored default");
  values.set("ignoreHidden",false);
  assert.equal(move(a,{x:100}),false,"hidden blocks if option disabled");
  values.set("ignoreHidden",true);
}
{
  const {token} = setup();
  const a=token("a"); token("upper",{x:100,elevation:5}); token("lowerLevel",{x:200,level:"basement"});
  assert.equal(move(a,{x:100}),true,"different elevation isn't occupied");
  assert.equal(move(a,{x:200}),true,"different level isn't occupied");
  assert.equal(move(a,{x:100,elevation:5}),false,"occupancy on matching height (nonfly blocked)");
}
{
  const {token} = setup();
  const a=token("a"); token("b",{x:100});
  game.user.isGM=true;
  assert.equal(move(a,{x:100,elevation:10}),true,"GM can do both");
  game.user.isGM=false;
  assert.equal(await mod.api.withMovementOverride(a,async()=>move(a,{x:100})),true,"override allows overlap");
  assert.equal(await mod.api.withMovementOverride(a,async()=>update(a,{elevation:20})),undefined,"override elevation");
  assert.equal(move(a,{x:100}),false,"override released");
}
{
  const {token} = setup();
  const a=token("a"); token("b",{x:100});
  values.set("preventOverlap",false);
  assert.equal(move(a,{x:100}),true,"overlap toggle");
  values.set("preventOverlap",true);
  values.set("lockElevation",false);
  assert.equal(move(a,{elevation:10}),true,"elevation toggle");
  values.set("lockElevation",true);
  assert.equal(update(a,{rotation:60}),undefined,"nonposition update unrestricted");
}
console.log("Mock Foundry hook/settings/geometry tests passed.");
