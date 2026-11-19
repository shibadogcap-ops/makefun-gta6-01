// Shared constants for Palm Bay Heat. Other modules import from here.

/** Fixed timestep (seconds) the simulation advances in. */
export const STEP = 1 / 60;

/** Logical viewport size the camera renders, in pixels. */
export const VIEW = { width: 1280, height: 720 };

/** World size in pixels. */
export const WORLD = { width: 4800, height: 3200 };

/** City grid pitch: one block plus one road width. */
export const BLOCK = 400;

/** Road width in pixels. */
export const ROAD_W = 96;

/** localStorage key for save data. */
export const SAVE_KEY = 'palm-bay-heat-save-v1';

/** Palette: sun-soaked sunset coastal city. */
export const PALETTE = {
  water: '#2f6d9e',
  waterDeep: '#1c4066',
  sand: '#e8c98f',
  grass: '#7fae5c',
  park: '#5c8f4e',
  sidewalk: '#d9cbb4',
  curb: '#b8a98d',
  road: '#4a4a55',
  roadEdge: '#3a3a44',
  laneMark: '#f0e6c8',
  crosswalk: '#e8e4da',
  roofEdge: '#8a5a44',
  palmTrunk: '#8a5a3b',
  palmLeaf: '#3f8f4f',
  ROOF_COLORS: [
    '#f2a7a0', // pink
    '#f7c59f', // peach
    '#a8d8b9', // mint
    '#f5ecd7', // cream
    '#c5b3e0', // lavender
    '#f29b76', // coral
    '#e6d3f0', // blush
    '#bfe3d0', // seafoam
  ],
  CAR_COLORS: [
    '#e63946', '#f4a261', '#2a9d8f', '#457b9d',
    '#e9c46a', '#9b5de5', '#f1fa8c', '#ff7b00',
    '#00b4d8', '#ef476f',
  ],
};

/** Gameplay tuning numbers. */
export const TUNE = {
  walkSpeed: 175,
  runSpeed: 275,
  playerRadius: 14,
  interactRange: 64,
  /** Active police units per star level (index 0-5). */
  policeByStars: [0, 1, 2, 3, 4, 6],
};
