/**
 * src/model/Agent.js
 *
 * Biological formulations for individual snow crab (Chionoecetes opilio) agents,
 * incorporating discontinuous Hiatt increment growth, size-gated logistic maturity,
 * multi-hazard natural mortality, and egg production.
 */

/**
 * Standard Box-Muller pseudo-random normal variate generator.
 */
export function randn(seed) {
  let s = Number(seed) || 1234;
  return () => {
    let u = 0;
    let v = 0;
    let q = 0;
    do {
      u = Math.random();
      v = Math.random();
      q = u * u + v * v;
    } while (q >= 1 || q === 0);
    const mult = Math.sqrt((-2 * Math.log(q)) / q);
    return u * mult;
  };
}

/**
 * Inverse standard normal CDF (Acklam rational approximation) for mapping
 * uniform trait quantiles in (0, 1) to standard normal deviates.
 */
export function probit(p) {
  const clamped = Math.min(1.0 - 1.0e-12, Math.max(1.0e-12, p));
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996e0, 3.754408661907416e0,
  ];
  const pLow = 0.02425;
  const pHigh = 1.0 - pLow;
  if (clamped < pLow) {
    const q = Math.sqrt(-2.0 * Math.log(clamped));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
  }
  if (clamped <= pHigh) {
    const q = clamped - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
  }
  const q = Math.sqrt(-2.0 * Math.log(1.0 - clamped));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
}

/**
 * Instantiate an individuated benthic crab agent.
 *
 * Stages 4-8: Early benthic juveniles (unsexed / juvenile cohorts).
 * Stages 9-14: Male benthic instars (VI to XI+).
 * Stages 15-19: Female benthic instars (VI to X+).
 *
 * @param {number} id - Unique organism identifier.
 * @param {number} x - Horizontal grid position.
 * @param {number} y - Vertical grid position.
 * @param {number} seed - Random seed for individual variation.
 * @param {number} initialStage - Life-history stage (4 to 19).
 * @param {string} [sex] - 'male' or 'female'.
 * @returns {object} Initialized agent record.
 */
export function createAgent(id, x, y, seed, initialStage = 4, sex = null) {
  const rnd = randn(seed + id);
  const assignedSex = sex || (Math.random() < 0.5 ? 'male' : 'female');

  // Approximate carapace width by stage (mm)
  let baseCw = 4.0;
  if (initialStage <= 4) baseCw = 4.5 + Math.random() * 2.0;
  else if (initialStage <= 6) baseCw = 12.0 + Math.random() * 4.0;
  else if (initialStage <= 8) baseCw = 24.0 + Math.random() * 6.0;
  else if (initialStage <= 11) baseCw = 45.0 + Math.random() * 12.0;
  else if (initialStage <= 14) baseCw = 75.0 + Math.random() * 25.0;
  else baseCw = 55.0 + Math.random() * 15.0;

  const mature = initialStage >= 14 || (assignedSex === 'female' && initialStage >= 18);

  return {
    id,
    x,
    y,
    sex: assignedSex,
    cw: baseCw,
    stage: initialStage,
    mature,
    shell_age: mature ? Math.floor(Math.random() * 365) : 0,
    last_molt_day: mature ? -365.0 : -Math.floor(Math.random() * 180),
    eggs: 0,
    energy_reserve: 10.0,
    degree_days: 50.0 + Math.random() * 250.0,
    sperm_clutches: mature && assignedSex === 'female' ? 1 : 0,
    trait_growth_quantile: Math.random(),
    trait_maturity_quantile: Math.random(),
    trait_mortality_quantile: Math.random(),
    alive: true,
    caught: false,
    fishery_removed: false,
    rnd,
  };
}

/**
 * Allometric biomass conversion: W = alpha * CW^beta (kg).
 * Male immature: alpha = 0.000183,  beta = 3.16
 * Male mature:   alpha = 0.0002665, beta = 3.098
 * Female imm:    alpha = 0.000344,  beta = 2.98
 * Female mature: alpha = 0.00045,   beta = 2.92
 */
export function biomassKg(agent) {
  const cw = Math.max(agent.cw, 1.0);
  if (agent.sex === 'male') {
    const alpha = agent.mature ? 0.0002665 : 0.000183;
    const beta = agent.mature ? 3.098 : 3.16;
    return (alpha * (cw ** beta)) / 1000.0;
  }
  const alpha = agent.mature ? 0.00045 : 0.000344;
  const beta = agent.mature ? 2.92 : 2.98;
  const eggMassG = agent.eggs > 0 ? agent.eggs * 7.0e-5 : 0.0;
  return (alpha * (cw ** beta) + eggMassG) / 1000.0;
}

/**
 * Discontinuous Hiatt increment post-molt size calculation matching TethysBio:
 * ln(CW_{t+1}) = (int + beta1 * z1) + (slp + beta2 * z1 + beta3 * z2) * ln(CW_t)
 *   + mat_effect + cond_coeff * (condition - 1) + gamma_T * (T - T_ref) + residual
 * Bounded by minimum fractional expansion and max_size (male 160 mm, female 95 mm).
 */
export function growthIncrement(agent, T, g = {}, isMaturing = false, condition = 1.0) {
  const lnCW = Math.log(Math.max(agent.cw, 1.0));
  const isMale = agent.sex === 'male';
  const z1 = agent.trait_growth_quantile !== undefined
    ? probit(agent.trait_growth_quantile)
    : (agent.rnd ? agent.rnd() : 0.0);
  const z2 = agent.rnd ? agent.rnd() : 0.0;

  const baseInt = isMale ? (g.growth_int_male ?? 0.30153) : (g.growth_int_female ?? 0.1931);
  const b1 = isMale ? (g.growth_beta1_male ?? 0.02198) : (g.growth_beta1_female ?? 0.0545);
  const baseSlp = isMale ? (g.growth_slp_male ?? 1.00027) : (g.growth_slp_female ?? 1.0372);
  const b2 = isMale ? (g.growth_beta2_male ?? -0.00643655) : (g.growth_beta2_female ?? -0.017376);
  const b3 = isMale ? (g.growth_beta3_male ?? 0.0017492) : (g.growth_beta3_female ?? 0.005068);

  const intercept = baseInt + b1 * z1;
  const slope = baseSlp + b2 * z1 + b3 * z2;

  const matMean = isMale
    ? (g.growth_maturation_penalty_male_mean ?? g.growth_maturation_penalty_male ?? -0.13564)
    : (g.growth_maturation_penalty_female_mean ?? g.growth_maturation_penalty_female ?? -0.131);
  const matSd = isMale
    ? (g.growth_maturation_penalty_male_sd ?? 0.00922)
    : (g.growth_maturation_penalty_female_sd ?? 0.0252);
  const matTerm = isMaturing ? (matMean + matSd * (agent.rnd ? agent.rnd() : 0.0)) : 0.0;

  const gammaT = g.growth_temperature_coefficient ?? -0.004;
  const tempRef = g.growth_temperature_reference ?? 4.0;
  const condCoeff = g.growth_condition_coefficient ?? 0.05;
  const residualSd = g.growth_residual_sd ?? g.sigma ?? 0.04;
  const residual = residualSd * (agent.rnd ? agent.rnd() : 0.0);

  const minExp = isMaturing
    ? (g.growth_min_expansion_mature ?? 0.06)
    : (g.growth_min_expansion_immature ?? 0.12);
  const lnNext = Math.max(
    lnCW + Math.log(1.0 + minExp),
    intercept + slope * lnCW + matTerm + condCoeff * (condition - 1.0) +
      gammaT * (T - tempRef) + residual
  );
  const maxSize = isMale ? (g.max_size_male ?? 160.0) : (g.max_size_female ?? 95.0);

  return Math.min(maxSize, Math.exp(lnNext));
}

/**
 * Compute nutritional condition factor for ecdysis matching TethysBio's
 * perform_molt! energetics formulation.
 */
export function moltConditionFactor(agent, orgParams = {}, toggles = {}) {
  if (toggles.use_energetics === false || toggles.bioenergetics === false) {
    return 1.0;
  }
  const floor = orgParams.energy_molt_floor ?? 2.0;
  const slope = orgParams.energy_molt_slope ?? 0.03;
  const reqE = Math.max(floor, slope * agent.cw);
  const condRatio = (agent.energy_reserve ?? 0.0) / reqE;
  const baseFrac = orgParams.molt_energy_base_fraction ?? 0.85;
  return baseFrac + (1.0 - baseFrac) * Math.tanh(condRatio - 1.0);
}

/**
 * Compute daily ecdysis (molt) probability matching TethysBio's molt_probability:
 * gates on maturity, minimum intermolt days, cumulative degree-days, seasonal
 * molt window (for stages >= molt_season_min_stage), energetic reserve floor,
 * and thermal inhibition above molt_thermal_onset.
 */
export function moltProbability(agent, T, day, params = {}, dt = 1.0) {
  const toggles = params.ibm?.toggles || {};
  if (agent.mature || toggles.molting === false) {
    return 0.0;
  }

  const org = params.organism || {};
  const phen = params.phenology || {};
  const sim = params.simulation || {};

  const intermoltSched = org.intermolt_days_schedule || [
    0.0, 0.0, 0.0, 0.0,
    182.5, 182.5, 182.5, 182.5,
    365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0, 365.0,
  ];
  const ddSched = org.degree_days_schedule || [
    0.0, 0.0, 0.0, 0.0,
    912.5, 912.5, 912.5, 912.5,
    1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0, 1825.0,
  ];

  const idx = Math.max(0, Math.min(intermoltSched.length - 1, Math.round(agent.stage)));
  const minIntermolt = intermoltSched[idx];
  const daysSinceMolt = day - (agent.last_molt_day ?? 0.0);
  if (daysSinceMolt < minIntermolt) {
    return 0.0;
  }

  const useDD = toggles.use_degree_days !== false;
  const requiredDD = ddSched[Math.max(0, Math.min(ddSched.length - 1, Math.round(agent.stage)))];
  if (useDD && (agent.degree_days ?? 0.0) < requiredDD) {
    return 0.0;
  }

  const minSeasonStage = phen.molt_season_min_stage ?? 13;
  if (agent.stage >= minSeasonStage) {
    const daysPerYear = sim.days_per_year ?? 365.0;
    const dayOfYear = ((day % daysPerYear) + daysPerYear) % daysPerYear;
    const seasonStart = phen.molt_season_start ?? 15.0;
    const seasonEnd = phen.molt_season_end ?? 140.0;
    if (dayOfYear < seasonStart || dayOfYear > seasonEnd) {
      return 0.0;
    }
  }

  const useEnergetics = toggles.use_energetics !== false && toggles.bioenergetics !== false;
  if (useEnergetics) {
    const reqE = Math.max(org.energy_molt_floor ?? 2.0, (org.energy_molt_slope ?? 0.03) * agent.cw);
    if ((agent.energy_reserve ?? 0.0) < reqE) {
      return 0.0;
    }
  }

  let thermalInhibition = 1.0;
  const useThermal =
    toggles.use_thermal !== false &&
    toggles.use_thermal_stress !== false &&
    toggles.thermal_stress !== false;
  const onset = phen.molt_thermal_onset ?? 10.0;
  const bandwidth = phen.molt_thermal_bandwidth ?? 3.0;
  if (useThermal && bandwidth > 0.0 && T > onset) {
    thermalInhibition = 1.0 - ((T - onset) / bandwidth) ** 2;
    if (thermalInhibition <= 0.0) {
      return 0.0;
    }
  }

  const progressRatio = useDD && requiredDD > 0.0
    ? (agent.degree_days ?? 0.0) / requiredDD
    : (minIntermolt > 0.0 ? daysSinceMolt / minIntermolt : 1.0);
  const hazardCoeff = org.molt_hazard_coefficient ?? 0.15;
  const progressSat = org.molt_progress_saturation ?? 3.0;
  const lambdaMolt = hazardCoeff * Math.min(progressRatio, progressSat) * thermalInhibition;

  return 1.0 - Math.exp(-lambdaMolt * dt);
}

/**
 * Logistic probability of terminal molt to maturity conditioned on size and temperature:
 * P(mat) = 1 / (1 + exp(-slope * (ln(CW) - ln(CW50(T)))))
 * Size gate: no maturation below 35.0 mm.
 */
export function maturityProbability(agent, T, m = {}) {
  const gate = m.maturity_size_gate ?? 35.0;
  if (agent.cw < gate) return 0.0;

  const isMale = agent.sex === 'male';
  const zMat = agent.trait_maturity_quantile !== undefined
    ? probit(agent.trait_maturity_quantile)
    : 0.0;

  const l50Mean = isMale ? (m.maturity_l50_male ?? 91.8) : (m.maturity_l50_female ?? 51.6);
  const l50Sd = isMale ? (m.maturity_l50_male_sd ?? 1.2) : (m.maturity_l50_female_sd ?? 0.8);
  const baseCW50 = l50Mean + l50Sd * zMat;

  const slopeMean = isMale ? (m.maturity_slope_male ?? 6.9957) : (m.maturity_slope_female ?? 12.9812);
  const slopeSd = isMale ? (m.maturity_slope_male_sd ?? 0.25) : (m.maturity_slope_female_sd ?? 0.4);
  const slope = Math.max(0.5, slopeMean + slopeSd * zMat);

  const tempSlope = m.maturity_l50_temp_slope ?? -2.0;
  const tempRef = m.maturity_temp_reference ?? 4.0;

  const cw50 = Math.max(gate, baseCW50 + tempSlope * (T - tempRef));
  const z = slope * (Math.log(Math.max(agent.cw, 1.0)) - Math.log(cw50));
  return 1.0 / (1.0 + Math.exp(-z));
}

/**
 * Determine if an organism belongs to the empirically measured size fraction (stage >= 11).
 */
export function isEmpiricallyMeasured(agent) {
  return agent.stage >= 11 || Boolean(agent.mature);
}

const BASELINE_STAGE_MORTALITY = [
  0.35, 0.35, 0.35, 0.35,
  0.15, 0.15, 0.15, 0.15,
  0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.06,
];

/**
 * Kleiber + Holling Type II daily net energy change matching TethysBio::calculate_energy_change:
 * maintenance = metabolic_rate_base * mass^beta * exp(c_T * T)
 * intake = intake_rate_base * (F / (F + K_F)) * mass^beta * exp(-((T - T_opt)^2)/(2*sigma_T^2))
 * net = intake * assim_eff * (1 - specific_dynamic_action) - maintenance
 */
export function calculateEnergyChange(agent, T = 4.0, foodAvail = 5.0, env = {}, org = {}) {
  const massG = Math.max(0.01, biomassKg(agent) * 1000.0);
  const massExp = org.metabolic_mass_exponent ?? 0.75;
  const massScaling = Math.pow(massG, massExp);

  const metaBase = org.metabolic_rate_base ?? 0.01;
  const metaTempCoeff = org.metabolic_temperature_coefficient ?? 0.08;
  const maintenance = metaBase * massScaling * Math.exp(metaTempCoeff * T);

  const tOpt = org.metabolic_optimal_temperature ?? 3.0;
  const tSig = Math.max(0.1, org.metabolic_optimal_sigma ?? 2.5);
  const thermalModifier = Math.exp(-((T - tOpt) ** 2) / (2.0 * tSig * tSig));

  const halfSat = env.half_saturation_food ?? 2.0;
  const foodPos = Math.max(0.0, Number.isFinite(foodAvail) ? foodAvail : 0.0);
  const intakeBase = org.intake_rate_base ?? 0.05;
  const intakeDemand = intakeBase * (foodPos / (foodPos + halfSat)) * massScaling * thermalModifier;
  const actualIntake = Math.min(intakeDemand, foodPos);

  const assimEff = env.assimilation_efficiency ?? 0.75;
  const sda = org.specific_dynamic_action ?? 0.15;
  return actualIntake * assimEff * (1.0 - sda) - maintenance;
}

/**
 * Competing-risks mortality probability matching TethysBio::mortality_components:
 * P_mort = 1 - exp(-sum(h_i) * dt).
 */
export function mortalityHazards(agent, N_measured, K, T, mo = {}, toggles = {}, dt = 1.0, day = 0.0, localCrowdingRatio = 0.0) {
  const stageRates = mo.baseline_rate_by_stage || BASELINE_STAGE_MORTALITY;
  const st = Math.min(stageRates.length - 1, Math.max(0, agent.stage || 4));
  const traitSigma = mo.baseline_trait_sigma ?? 0.25;
  const zMort = agent.trait_mortality_quantile !== undefined
    ? probit(agent.trait_mortality_quantile)
    : 0.0;
  const traitFactor = Math.exp(traitSigma * zMort);

  let base = (stageRates[st] / 365.0) * traitFactor * dt;
  if (isEmpiricallyMeasured(agent) && K > 0) {
    const gamma = mo.benthic_carrying_capacity_exponent ?? 2.0;
    const globalFeedback = 1.0 + Math.pow(N_measured / Math.max(K, 1.0), gamma);
    const localFeedback = localCrowdingRatio > 1.0 ? 1.0 + Math.pow(localCrowdingRatio, gamma) : 1.0;
    base *= Math.max(globalFeedback, localFeedback);
  }

  const predRate = mo.rate_predation ?? 0.05;
  const predRef = mo.predation_size_reference ?? 5.0;
  const predDecay = mo.predation_size_decay ?? 0.03;
  const pred = (predRate / 365.0) * Math.exp(-predDecay * Math.max(0.0, agent.cw - predRef)) * dt;

  let softShell = 0.0;
  const daysSinceMolt = agent.last_molt_day !== undefined ? Math.max(0.0, day - agent.last_molt_day) : Infinity;
  const softDuration = mo.soft_shell_duration ?? 30.0;
  if (daysSinceMolt <= softDuration) {
    const softTau = Math.max(1.0e-6, mo.soft_shell_decay_days ?? 15.0);
    softShell = ((mo.rate_soft_shell ?? 0.12) / 365.0) * Math.exp(-daysSinceMolt / softTau) * dt;
  }

  let thermal = 0.0;
  const tStress = mo.temp_thermal_stress ?? 8.0;
  const thermExp = mo.thermal_exponent ?? 1.5;
  if (toggles.thermal_stress !== false && toggles.use_thermal_stress !== false && toggles.use_thermal !== false && T > tStress) {
    thermal = ((mo.rate_thermal ?? 0.05) / 365.0) * ((T - tStress) ** thermExp) * dt;
  }

  let senescence = 0.0;
  const maxStage = agent.sex === 'female' ? 16 : 19;
  const senEnabled = toggles.use_senescence !== false && toggles.senescence !== false && toggles.adult_senescence !== false;
  const senThresh = mo.senescence_age_threshold ?? 3.0;
  const senExpRate = mo.senescence_exp_rate ?? 0.8;
  const shellAgeYears = (agent.shell_age || 0.0) / 365.0;
  if (senEnabled && agent.mature && agent.stage >= maxStage && shellAgeYears > senThresh) {
    senescence = (((mo.rate_senescence ?? 0.05) / 365.0) * Math.exp(senExpRate * (shellAgeYears - senThresh))) * dt;
  }

  let cannibal = 0.0;
  const cannEnabled = toggles.use_cannibalism ?? toggles.cannibalism ?? false;
  if (cannEnabled && agent.cw < (mo.cannibalism_size_threshold ?? 35.0)) {
    cannibal = ((mo.rate_cannibalism ?? 0.05) / 365.0) * dt;
  }

  let starvation = 0.0;
  if (toggles.use_energetics !== false && toggles.bioenergetics !== false && (agent.energy_reserve ?? 10.0) < 0.0) {
    const deficit = -(agent.energy_reserve ?? 0.0);
    const massG = Math.max(0.01, biomassKg(agent) * 1000.0);
    const critPool = Math.max(0.5, massG * (mo.starvation_critical_fraction ?? 0.05));
    starvation = ((mo.rate_starvation ?? 0.2) / 365.0) * (1.0 - Math.exp(-deficit / critPool)) * dt;
  }

  const hTotal = base + pred + softShell + thermal + senescence + cannibal + starvation;
  return Math.min(1.0, 1.0 - Math.exp(-Math.max(0.0, hTotal)));
}

/**
 * Fecundity of mature females: base-10 Moncton (or St. Marie) empirical relationship
 * discounted by shell age senescence after 3 years.
 */
export function fecundity(agent, rep = {}) {
  const shellAgeYears = Math.max(0.0, (agent.shell_age || 0) / 365.0);
  const cw = Math.max(20.0, agent.cw);
  let baseEggs;
  if (rep.fecundity_parameterization === 'stmarie') {
    const exp = rep.fecundity_stmarie_exponent ?? 2.725;
    const coef = rep.fecundity_stmarie_coefficient ?? -0.7311;
    baseEggs = Math.pow(10.0, coef + exp * Math.log10(cw));
  } else {
    const isFirst = shellAgeYears <= (rep.primiparous_shell_age_max ?? 2.0);
    const log10Cw = Math.log10(cw);
    const log10Eggs = isFirst
      ? (-0.7229 + 2.94 * log10Cw)
      : (0.0158 + 2.5811 * log10Cw);
    baseEggs = Math.pow(10.0, log10Eggs);
  }

  const senescenceThresh = rep.fecundity_senescence_threshold ?? 3.0;
  const senescenceFloor = rep.fecundity_senescence_floor ?? 0.6;
  const senescenceRate = rep.fecundity_senescence_rate ?? 0.08;
  const senescenceDiscount = shellAgeYears > senescenceThresh
    ? Math.max(senescenceFloor, 1.0 - (shellAgeYears - senescenceThresh) * senescenceRate)
    : 1.0;

  return Math.max(1000, Math.round(baseEggs * senescenceDiscount));
}
