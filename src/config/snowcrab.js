/**
 * src/config/snowcrab.js
 *
 * Specific snow crab (Chionoecetes opilio) parameter overlay matching
 * TethysBio/configs/snowcrab.toml.
 */

import { DEFAULTS, deepMerge } from './parameters.js';

export const SNOWCRAB = {
  ...DEFAULTS,
};

export function loadConfig(name = 'snowcrab') {
  if (name === 'snowcrab') return deepMerge(DEFAULTS, SNOWCRAB);
  return DEFAULTS;
}
