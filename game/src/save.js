// Persistence for Palm Bay Heat. All access is wrapped in try/catch so a
// missing or throwing localStorage (private mode, quota, etc.) never breaks
// the game.

import { SAVE_KEY } from './config.js';

export function defaultSave() {
  return {
    money: 0,
    missionsDone: 0,
    storyComplete: false,
    bestRampage: 0,
    muted: false,
    started: false,
  };
}

export function loadSave() {
  const merged = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return merged;
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      for (const key of Object.keys(merged)) {
        if (key in data) merged[key] = data[key];
      }
    }
  } catch {
    // Corrupt JSON or storage errors: fall back to defaults.
  }
  return merged;
}

export function storeSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Private mode / quota: silently ignore.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore.
  }
}
