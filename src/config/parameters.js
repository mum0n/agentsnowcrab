/**
 * src/config/parameters.js
 *
 * Full baseline parameter configuration matching TethysBio/configs/snowcrab.toml.
 */

export const DEFAULTS = {
  simulation: {
    dt: 1.0,
    seed: 1234,
    days: 730,
    grid_nx: 1000,
    grid_ny: 1000,
    unit_meters: 1.0,
    days_per_year: 365.0,
    temp_seasonal_phase_day: 80.0,
    n_agents: 120,
    update_interval: 10,
    sim_years: 2,
  },
  ibm: {
    grid_size: 1000,
    unit_meters: 1.0,
    n_agents: 120,
    days: 730,
    seed: 1234,
    benthic_carrying_capacity_density: 6000.0,
    benthic_carrying_capacity: 6000.0,
    benthic_carrying_capacity_exponent: 2.0,
    food_availability: 1.0,
    temp_offset: 0.0,
    temp_multiplier: 1.0,
    habitat_offset: 0.0,
    habitat_multiplier: 1.0,
    background_layer: 'depth',
    toggles: {
      bioenergetics: true,
      thermal_stress: true,
      cannibalism: false,
      adult_senescence: true,
      spermathecal_storage: true,
      directed_taxis: true,
      ecdysial_gating: true,
      molting: true,
      reproduction: true,
      use_energetics: true,
      use_thermal: true,
      use_cannibalism: false,
      use_senescence: true,
      use_movement: true,
      use_reproduction: true,
    },
  },
  environment: {
    temp_offset: 0.0,
    temp_multiplier: 1.0,
    food_availability: 1.0,
    benthic_carrying_capacity_density: 6000.0,
    benthic_carrying_capacity_exponent: 2.0,
    habitat_quality_mean: 0.5,
    habitat_offset: 0.0,
    habitat_multiplier: 1.0,
  },
  fishery: {
    fishing_probability_daily: 0.002,
    legal_size_male: 95.0,
    legal_size_mm: 95.0,
    fishing_season_start: 90,
    fishing_season_end: 150,
  },
  growth: {
    growth_int_male: 0.30153,
    growth_slp_male: 1.00027,
    growth_maturation_penalty_male: -0.13564,
    growth_int_female: 0.1931,
    growth_slp_female: 1.0372,
    growth_maturation_penalty_female: -0.131,
    growth_temperature_coefficient: -0.004,
    growth_temperature_reference: 4.0,
    max_size_male: 160.0,
    max_size_female: 95.0,
    sigma: 0.04,
    beta0: 0.30153,
    beta1: 1.00027,
    delta_mat: -0.13564,
  },
  maturity: {
    maturity_l50_male: 91.8,
    maturity_slope_male: 6.9957,
    maturity_l50_female: 51.6,
    maturity_slope_female: 12.9812,
    maturity_size_gate: 35.0,
    maturity_l50_temp_slope: -2.0,
    maturity_temp_reference: 4.0,
    cw50: 91.8,
    l50_female: 51.6,
    beta: 6.9957,
    slope_female: 12.9812,
    size_gate: 35.0,
  },
  mortality: {
    baseline_rate_by_stage: [
      0.35, 0.35, 0.35, 0.35,
      0.15, 0.15, 0.15, 0.15,
      0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08,
      0.06,
    ],
    rate_predation: 0.05,
    rate_soft_shell: 0.12,
    benthic_carrying_capacity_exponent: 2.0,
    density_gamma: 2.0,
    temp_thermal_stress: 8.0,
  },
  reproduction: {
    fecundity_parameterization: 'moncton',
    fecundity_primiparous_intercept: -0.7229,
    fecundity_primiparous_slope: 2.94,
    fecundity_multiparous_intercept: 0.0158,
    fecundity_multiparous_slope: 2.5811,
    fecundity_senescence_threshold: 3.0,
    fecundity_senescence_floor: 0.6,
    fecundity_senescence_rate: 0.08,
    primiparous_shell_age_max: 2.0,
    fecundity_parity_size_split: 65.0,
    primiparous_fecundity: 50000,
    multiparous_fecundity: 150000,
    senescence_discount: 0.08,
  },
};

export function deepMerge(base, overlay) {
  const out = { ...base };
  for (const k of Object.keys(overlay)) {
    if (
      overlay[k] &&
      typeof overlay[k] === 'object' &&
      !Array.isArray(overlay[k]) &&
      base[k] &&
      typeof base[k] === 'object'
    ) {
      out[k] = deepMerge(base[k], overlay[k]);
    } else {
      out[k] = overlay[k];
    }
  }
  return out;
}
