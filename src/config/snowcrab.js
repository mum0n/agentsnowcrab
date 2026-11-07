import { DEFAULTS, deepMerge } from './parameters.js';

export const SNOWCRAB = {
  ibm: {
    grid_size: 100,
    n_agents: 2000,
    days: 365,
    seed: 1234,
    benthic_carrying_capacity: 10000,
    temp_offset: 0.0,
    temp_ref: 10.0,
    toggles: {
      bioenergetics: true,
      thermal_stress: true,
      cannibalism: true,
      adult_senescence: true,
      spermathecal_storage: true,
      directed_taxis: true,
      ecdysial_gating: true,
      molting: true,
      reproduction: true,
    },
  },
  fishery: {
    fishing_probability_daily: 0.005,
    legal_size_mm: 95.0,
  },
  growth: {
    beta0: 0.15,
    beta1: 0.85,
    delta_mat: -0.05,
    gamma_T: 0.02,
    sigma: 0.05,
    max_size_male: 165.0,
    max_size_female: 135.0,
    size_0: 25.0,
    L_inf: 165.0,
    kappa: 0.3,
    iota_0: 1,
  },
  maturity: {
    cw50: 95.0,
    beta: 1.0,
    alpha: -4.0,
    gamma_T: 0.02,
  },
  mortality: {
    base: 0.001,
    predation_coeff: 0.0002,
    starvation_coeff: 0.01,
    thermal_coeff: 0.005,
    senescence_coeff: 0.002,
    cannibalism_coeff: 0.001,
    density_gamma: 0.5,
  },
  reproduction: {
    primiparous_fecundity: 50000,
    multiparous_fecundity: 150000,
    senescence_discount: 0.02,
  },
};

export function loadConfig(name = 'default') {
  if (name === 'snowcrab') return deepMerge(DEFAULTS, SNOWCRAB);
  return DEFAULTS;
}
