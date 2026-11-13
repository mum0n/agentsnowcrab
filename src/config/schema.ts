import { z } from 'zod';

export const SimulationSchema = z.object({
  dt: z.number().default(1.0),
  seed: z.number().default(1234),
  days: z.number().default(730),
  grid_nx: z.number().default(1000),
  grid_ny: z.number().default(1000),
  unit_meters: z.number().default(1.0),
  days_per_year: z.number().default(365.0),
  temp_seasonal_phase_day: z.number().default(80.0),
  n_agents: z.number().default(120),
  update_interval: z.number().default(10),
  sim_years: z.number().default(2),
});

export const IBMTogglesSchema = z.object({
  use_energetics: z.boolean().default(true),
  use_thermal: z.boolean().default(true),
  use_cannibalism: z.boolean().default(false),
  use_senescence: z.boolean().default(true),
  use_movement: z.boolean().default(true),
  use_reproduction: z.boolean().default(true),
  bioenergetics: z.boolean().default(true),
  thermal_stress: z.boolean().default(true),
  cannibalism: z.boolean().default(false),
  adult_senescence: z.boolean().default(true),
  spermathecal_storage: z.boolean().default(true),
  directed_taxis: z.boolean().default(true),
  ecdysial_gating: z.boolean().default(true),
  molting: z.boolean().default(true),
  reproduction: z.boolean().default(true),
});

export const IBMSchema = z.object({
  grid_size: z.number().default(1000),
  unit_meters: z.number().default(1.0),
  n_agents: z.number().default(120),
  days: z.number().default(730),
  seed: z.number().default(1234),
  benthic_carrying_capacity_density: z.number().default(6000.0),
  benthic_carrying_capacity: z.number().default(6000.0),
  benthic_carrying_capacity_exponent: z.number().default(2.0),
  food_availability: z.number().default(1.0),
  temp_offset: z.number().default(0.0),
  temp_multiplier: z.number().default(1.0),
  habitat_offset: z.number().default(0.0),
  habitat_multiplier: z.number().default(1.0),
  background_layer: z.enum(['depth', 'temperature', 'habitat_quality']).default('depth'),
  toggles: IBMTogglesSchema.default({}),
});

export const EnvironmentSchema = z.object({
  temp_offset: z.number().default(0.0),
  temp_multiplier: z.number().default(1.0),
  food_availability: z.number().default(1.0),
  benthic_carrying_capacity_density: z.number().default(6000.0),
  benthic_carrying_capacity_exponent: z.number().default(2.0),
  habitat_quality_mean: z.number().default(0.5),
  habitat_offset: z.number().default(0.0),
  habitat_multiplier: z.number().default(1.0),
});

export const FisherySchema = z.object({
  fishing_probability_daily: z.number().default(0.0),
  legal_size_male: z.number().default(95.0),
  legal_size_mm: z.number().default(95.0),
  fishing_season_start: z.number().default(90),
  fishing_season_end: z.number().default(150),
});

export const GrowthSchema = z.object({
  growth_int_male: z.number().default(0.30153),
  growth_slp_male: z.number().default(1.00027),
  growth_maturation_penalty_male: z.number().default(-0.13564),
  growth_int_female: z.number().default(0.1931),
  growth_slp_female: z.number().default(1.0372),
  growth_maturation_penalty_female: z.number().default(-0.131),
  growth_temperature_coefficient: z.number().default(-0.004),
  growth_temperature_reference: z.number().default(4.0),
  max_size_male: z.number().default(160.0),
  max_size_female: z.number().default(95.0),
  sigma: z.number().default(0.04),
  beta0: z.number().default(0.30153),
  beta1: z.number().default(1.00027),
  delta_mat: z.number().default(-0.13564),
});

export const MaturitySchema = z.object({
  maturity_l50_male: z.number().default(91.8),
  maturity_slope_male: z.number().default(6.9957),
  maturity_l50_female: z.number().default(51.6),
  maturity_slope_female: z.number().default(12.9812),
  maturity_size_gate: z.number().default(35.0),
  maturity_l50_temp_slope: z.number().default(-2.0),
  maturity_temp_reference: z.number().default(4.0),
  cw50: z.number().default(91.8),
  l50_female: z.number().default(51.6),
  beta: z.number().default(6.9957),
  slope_female: z.number().default(12.9812),
  size_gate: z.number().default(35.0),
});

export const MortalitySchema = z.object({
  baseline_rate_by_stage: z.array(z.number()).default([
    0.35, 0.35, 0.35, 0.35,
    0.15, 0.15, 0.15, 0.15,
    0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08,
    0.06,
  ]),
  rate_predation: z.number().default(0.05),
  rate_soft_shell: z.number().default(0.12),
  benthic_carrying_capacity_exponent: z.number().default(2.0),
  density_gamma: z.number().default(2.0),
  temp_thermal_stress: z.number().default(8.0),
});

export const ReproductionSchema = z.object({
  fecundity_parameterization: z.enum(['moncton', 'stmarie']).default('moncton'),
  fecundity_primiparous_intercept: z.number().default(-0.7229),
  fecundity_primiparous_slope: z.number().default(2.94),
  fecundity_multiparous_intercept: z.number().default(0.0158),
  fecundity_multiparous_slope: z.number().default(2.5811),
  fecundity_senescence_threshold: z.number().default(3.0),
  fecundity_senescence_floor: z.number().default(0.6),
  fecundity_senescence_rate: z.number().default(0.08),
  primiparous_shell_age_max: z.number().default(2.0),
  fecundity_parity_size_split: z.number().default(65.0),
  primiparous_fecundity: z.number().default(50000),
  multiparous_fecundity: z.number().default(150000),
  senescence_discount: z.number().default(0.08),
});

export const ParamsSchema = z.object({
  simulation: SimulationSchema.default({}),
  ibm: IBMSchema.default({}),
  environment: EnvironmentSchema.default({}),
  fishery: FisherySchema.default({}),
  growth: GrowthSchema.default({}),
  maturity: MaturitySchema.default({}),
  mortality: MortalitySchema.default({}),
  reproduction: ReproductionSchema.default({}),
});

export type Params = z.infer<typeof ParamsSchema>;
export type SimulationParams = z.infer<typeof SimulationSchema>;
export type IBMParams = z.infer<typeof IBMSchema>;
export type EnvironmentParams = z.infer<typeof EnvironmentSchema>;
export type FisheryParams = z.infer<typeof FisherySchema>;
export type GrowthParams = z.infer<typeof GrowthSchema>;
export type MaturityParams = z.infer<typeof MaturitySchema>;
export type MortalityParams = z.infer<typeof MortalitySchema>;
export type ReproductionParams = z.infer<typeof ReproductionSchema>;

export const DEFAULTS = ParamsSchema.parse({});

export function validateParams(params: unknown): Params {
  return ParamsSchema.parse(params);
}

export function mergeParams(base: Params, overlay: Partial<Params>): Params {
  return ParamsSchema.parse({
    simulation: { ...base.simulation, ...overlay.simulation },
    ibm: { ...base.ibm, ...overlay.ibm, toggles: { ...base.ibm.toggles, ...overlay.ibm?.toggles } },
    environment: { ...base.environment, ...overlay.environment },
    fishery: { ...base.fishery, ...overlay.fishery },
    growth: { ...base.growth, ...overlay.growth },
    maturity: { ...base.maturity, ...overlay.maturity },
    mortality: { ...base.mortality, ...overlay.mortality },
    reproduction: { ...base.reproduction, ...overlay.reproduction },
  });
}