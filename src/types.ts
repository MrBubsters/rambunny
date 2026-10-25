// Hand-written types for the generated src/game.ts. Map a top-level variable
// to one of these in tools/port-config.mjs (`annotations`).

export interface Player {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Position at the start of the last fixed step, for render interpolation. */
  px: number; py: number; pz: number;
  /** Horizontal velocity before the last collision, used by wall jumps. */
  pvx: number; pvz: number;
  yaw: number; pitch: number;
  hp: number;
  ground: boolean;
  /** Seconds on the ground since landing (bunny-hop timing window). */
  gt: number;
  /** Current horizontal speed, and its smoothed value used for the "too slow" warning. */
  spd: number; ts: number;
  /** Dash time left, dash direction and dash speed. */
  dash: number; dx: number; dz: number; ds: number;
  /** Slide time left. */
  slide: number;
  /** Speed drag from nearby melee enemies, and how many are near. */
  db: number; nn: number;
  sh: number;
  /** Invulnerability time left (dash, wall jump, Last Stand). Set later, not in the literal. */
  inv?: number;
}

/** t: p gun perk, q killstreak, s toughness, m movement. r: rarity key into RAR. */
export interface Item {
  id: string;
  t: 'p' | 'q' | 's' | 'm';
  r: 'c' | 'u' | 'r' | 'e' | 'l';
  n: string;
  d: string;
  /** Killstreak cooldown in seconds. */
  cd?: number;
}

export interface Monster {
  n: string;
  /** Skin colours [brute, caster]. */
  c: number[];
  /** Cloth colours. */
  cl: number[];
  eye: number;
  shot: number;
  /** Multipliers on scale, health, speed and damage. */
  sc: number; hp: number; spd: number; dmg: number;
  /** Key into DECOR, or null for none. */
  dec: string | null;
  em?: number;
  /** Blood colour, assigned after the table is built. */
  bc?: number;
}

export interface Theme {
  id: string;
  n: string;
  /** Ground texture base colours by texture key (g grass, d dirt, h hedge, p plaza). */
  base: Record<string, number[]>;
  sky: string[];
  fog: number;
  far: number;
  hemiT: number; hemiG: number; hemiI: number;
  sun: number; sunI: number;
  og: number;
  hill: number[];
  tuft: number;
  leaf: number[]; rock: number[];
  trunk: number;
  flow: number[];
  stem: number;
  /** Enemy type for the biome, assigned after the table is built. */
  mon?: Monster;
  /** Index into ARCS for generated themes. */
  ai?: number;
}

// Browser and library gaps the HTML build relied on.
declare global {
  interface Window { _lastRun: any; _deadT: number }
  interface Navigator { keyboard?: { lock(): Promise<void> } }
  // The code reads these off event targets without narrowing them first.
  interface EventTarget { closest?: any; dataset?: any; value?: any; tagName?: any; id?: any }
  // HUD lookups go through $() and the code stores cache fields on elements.
  interface Document { getElementById(elementId: string): any }
  // localStorage.setItem is called with numbers; the browser converts them.
  interface Storage { setItem(key: string, value: string | number): void }
}

declare module 'three' {
  interface FogBase { near: number; far: number }
  interface MeshLambertMaterialParameters { flatShading?: boolean }
}
