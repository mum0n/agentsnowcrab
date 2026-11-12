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
    eggs: 0,
    alive: true,
    caught: false,
    fishery_removed: false,
    rnd,
  };
}

/**
 * Allometric biomass conversion: W = alpha * CW^beta (kg).
 * Male immature: alpha = 0.0002665, beta = 3.098
 * Male mature:   alpha = 0.000183,  beta = 3.16
 * Female imm:    alpha = 0.000344,  beta = 2.98
 * Female mature: alpha = 0.00045,   beta = 2.92
 */
export function biomassKg(agent) {
  const cw = Math.max(agent.cw, 1.0);
  if (agent.sex === 'male') {
    const alpha = agent.mature ? 0.000183 : 0.0002665;
    const beta = agent.mature ? 3.16 : 3.098;
    return (alpha * (cw ** beta)) / 1000.0;
  }
  const alpha = agent.mature ? 0.00045 : 0.000344;
  const beta = agent.mature ? 2.92 : 2.98;
  return (alpha * (cw ** beta)) / 1000.0;
}

/**
 * Discontinuous Hiatt increment post-molt size calculation:
 * ln(CW_{t+1}) = beta0 + beta1 * ln(CW_t) + delta_mat + gamma_T * (T - T_ref) + noise
 * Bounded by max_size (male 160 mm, female 95 mm).
 */
export function growthIncrement(agent, T, g = {}) {
  const lnCW = Math.log(Math.max(agent.cw, 1.0));
  const isMale = agent.sex === 'male';

  const beta0 = isMale ? (g.growth_int_male ?? 0.30153) : (g.growth_int_female ?? 0.1931);
  const beta1 = isMale ? (g.growth_slp_male ?? 1.00027) : (g.growth_slp_female ?? 1.0372);
  const deltaMat = isMale
    ? (g.growth_maturation_penalty_male ?? -0.13564)
    : (g.growth_maturation_penalty_female ?? -0.131);
  const matTerm = agent.mature ? deltaMat : 0.0;
  const gammaT = g.growth_temperature_coefficient ?? -0.004;
  const tempRef = g.growth_temperature_reference ?? 4.0;
  const noise = (g.sigma ?? 0.04) * (agent.rnd ? agent.rnd() : (Math.random() - 0.5) * 0.08);

  const lnNext = beta0 + beta1 * lnCW + matTerm + gammaT * (T - tempRef) + noise;
  const maxSize = isMale ? (g.max_size_male ?? 160.0) : (g.max_size_female ?? 95.0);

  return Math.min(maxSize, Math.exp(lnNext));
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
  const baseCW50 = isMale ? (m.maturity_l50_male ?? 91.8) : (m.maturity_l50_female ?? 51.6);
  const slope = isMale ? (m.maturity_slope_male ?? 6.9957) : (m.maturity_slope_female ?? 12.9812);
  const tempSlope = m.maturity_l50_temp_slope ?? -2.0;
  const tempRef = m.maturity_temp_reference ?? 4.0;

  const cw50 = Math.max(10.0, baseCW50 + tempSlope * (T - tempRef));
  const z = slope * (Math.log(Math.max(agent.cw, 1.0)) - Math.log(cw50));
  return 1.0 / (1.0 + Math.exp(-z));
}

/**
 * Determine if an organism belongs to the empirically measured size fraction
 * Instar 8 and older benthic snow crabs (CW >= 35.0 mm, stage >= 11, or mature).
 */
export function isEmpiricallyMeasured(agent) {
  return agent.stage >= 11 || agent.cw >= 35.0 || Boolean(agent.mature);
}

const BASELINE_STAGE_MORTALITY = [
  0.35, 0.35, 0.35, 0.35,
  0.15, 0.15, 0.15, 0.15,
  0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08,
  0.06,
];

/**
 * Multi-hazard instantaneous natural mortality rate components.
 */
export function mortalityHazards(agent, N_measured, K, T, mo = {}, toggles = {}) {
  const st = Math.min(BASELINE_STAGE_MORTALITY.length - 1, Math.max(0, agent.stage || 4));
  const stageAnnualRate = BASELINE_STAGE_MORTALITY[st];
  const base = stageAnnualRate / 365.0;

  const predRate = mo.rate_predation ?? 0.05;
  const pred = (predRate / 365.0) * Math.max(0.0, (80.0 - agent.cw) / 80.0);

  let thermal = 0.0;
  if (toggles.thermal_stress !== false && toggles.use_thermal !== false && T > (mo.temp_thermal_stress ?? 8.0)) {
    thermal = 0.01 * ((T - (mo.temp_thermal_stress ?? 8.0)) ** 1.5) / 365.0;
  }

  let senescence = 0.0;
  if (toggles.senescence !== false && toggles.adult_senescence !== false && agent.mature && agent.shell_age > 365 * 3) {
    const yr = (agent.shell_age - 365 * 3) / 365.0;
    senescence = (0.02 * Math.exp(0.8 * yr)) / 365.0;
  }

  let cannibal = 0.0;
  if (toggles.cannibalism === true && agent.cw < (mo.cannibalism_size_threshold ?? 35.0)) {
    cannibal = 0.05 / 365.0;
  }

  // Density feedback strictly applied to empirically measured size fraction (instar 8+)
  let densityMult = 1.0;
  if (isEmpiricallyMeasured(agent) && K > 0) {
    const gamma = mo.benthic_carrying_capacity_exponent ?? 2.0;
    densityMult = 1.0 + Math.pow(N_measured / Math.max(K, 1.0), gamma);
  }

  const dailyHazard = (base + pred + thermal + senescence + cannibal) * densityMult;
  return Math.min(0.95, dailyHazard);
}

/**
 * Fecundity of mature females: Moncton empirical log-linear relationship
 * discounted by shell age senescence after 3 years.
 */
export function fecundity(agent, rep = {}) {
  const isFirst = agent.shell_age <= 365 || agent.cw <= 65.0;
  const cw = Math.max(20.0, agent.cw);
  const lnCw = Math.log(cw);

  const lnEggs = isFirst
    ? (-0.7229 + 2.94 * lnCw)
    : (0.0158 + 2.5811 * lnCw);
  const baseEggs = Math.exp(lnEggs);

  const yr = Math.max(0.0, (agent.shell_age || 0) / 365.0);
  const senescenceFloor = rep.fecundity_senescence_floor ?? 0.6;
  const senescenceDiscount = yr > 3.0 ? Math.max(senescenceFloor, 1.0 - (yr - 3.0) * 0.08) : 1.0;

  return Math.max(1000, Math.round(baseEggs * senescenceDiscount));
}
