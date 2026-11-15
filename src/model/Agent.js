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
    energy_reserve: 10.0,
    degree_days: 0.0,
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
 * Discontinuous Hiatt increment post-molt size calculation:
 * ln(CW_{t+1}) = beta0 + beta1 * ln(CW_t) + delta_mat * I_maturing + gamma_T * (T - T_ref) + noise
 * Bounded by min expansion floor and max_size (male 160 mm, female 95 mm).
 */
export function growthIncrement(agent, T, g = {}, isMaturing = false, condition = 1.0) {
  const lnCW = Math.log(Math.max(agent.cw, 1.0));
  const isMale = agent.sex === 'male';

  const beta0 = isMale ? (g.growth_int_male ?? 0.30153) : (g.growth_int_female ?? 0.1931);
  const beta1 = isMale ? (g.growth_slp_male ?? 1.00027) : (g.growth_slp_female ?? 1.0372);
  const deltaMat = isMale
    ? (g.growth_maturation_penalty_male ?? -0.13564)
    : (g.growth_maturation_penalty_female ?? -0.131);
  const matTerm = isMaturing ? deltaMat : 0.0;
  const gammaT = g.growth_temperature_coefficient ?? -0.004;
  const tempRef = g.growth_temperature_reference ?? 4.0;
  const condCoeff = g.growth_condition_coefficient ?? 0.05;
  const noise = (g.sigma ?? 0.04) * (agent.rnd ? agent.rnd() : (Math.random() - 0.5) * 0.08);

  const minExp = isMaturing ? 0.06 : 0.12;
  const lnNext = Math.max(
    lnCW + Math.log(1.0 + minExp),
    beta0 + beta1 * lnCW + matTerm + condCoeff * (condition - 1.0) + gammaT * (T - tempRef) + noise
  );
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
  0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.06,
];

/**
 * Kleiber + Holling Type II daily net energy change matching TethysBio::calculate_energy_change.
 */
export function calculateEnergyChange(agent, T = 4.0, foodAvail = 5.0, env = {}) {
  const massG = Math.max(0.01, biomassKg(agent) * 1000.0);
  const halfSat = env.half_saturation_food ?? 2.0;
  const assimEff = env.assimilation_efficiency ?? 0.75;
  const intake = (foodAvail / (halfSat + Math.max(0.0, foodAvail))) * Math.pow(massG, 0.75) * 0.35;
  const assim = intake * assimEff * 0.85;
  const basal = 0.04 * Math.pow(massG, 0.75) * Math.exp(0.06 * (T - 4.0));
  return assim - basal;
}

/**
 * Competing-risks mortality probability: P_mort = 1 - exp(-sum(h_i) * dt).
 */
export function mortalityHazards(agent, N_measured, K, T, mo = {}, toggles = {}, dt = 1.0) {
  const st = Math.min(BASELINE_STAGE_MORTALITY.length - 1, Math.max(0, agent.stage || 4));
  let base = (BASELINE_STAGE_MORTALITY[st] / 365.0) * dt;

  if (isEmpiricallyMeasured(agent) && K > 0) {
    const gamma = mo.benthic_carrying_capacity_exponent ?? 2.0;
    base *= 1.0 + Math.pow(N_measured / Math.max(K, 1.0), gamma);
  }

  const predRate = mo.rate_predation ?? 0.05;
  const pred = (predRate / 365.0) * Math.exp(-0.03 * Math.max(0.0, agent.cw - 5.0)) * dt;

  let thermal = 0.0;
  const tStress = mo.temp_thermal_stress ?? 8.0;
  if (toggles.thermal_stress !== false && toggles.use_thermal !== false && T > tStress) {
    thermal = ((mo.rate_thermal ?? 0.05) / 365.0) * ((T - tStress) ** 1.5) * dt;
  }

  let senescence = 0.0;
  const maxStage = agent.sex === 'female' ? 16 : 19;
  const senEnabled = toggles.use_senescence !== false && toggles.senescence !== false && toggles.adult_senescence !== false;
  if (
    senEnabled &&
    agent.mature &&
    agent.stage >= maxStage &&
    agent.shell_age > 365 * 3
  ) {
    const yr = (agent.shell_age - 365 * 3) / 365.0;
    senescence = (((mo.rate_senescence ?? 0.05) / 365.0) * Math.exp(0.8 * yr)) * dt;
  }

  let cannibal = 0.0;
  const cannEnabled = toggles.use_cannibalism === true || toggles.cannibalism === true;
  if (cannEnabled && agent.cw < (mo.cannibalism_size_threshold ?? 35.0)) {
    cannibal = ((mo.rate_cannibalism ?? 0.05) / 365.0) * dt;
  }

  let starvation = 0.0;
  if (toggles.use_energetics !== false && (agent.energy_reserve ?? 10.0) < 0.0) {
    starvation = ((mo.rate_starvation ?? 0.25) / 365.0) * (1.0 - Math.exp((agent.energy_reserve ?? 0.0) / 2.5)) * dt;
  }

  const hTotal = base + pred + thermal + senescence + cannibal + starvation;
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

  const senescenceFloor = rep.fecundity_senescence_floor ?? 0.6;
  const senescenceDiscount = shellAgeYears > 3.0 ? Math.max(senescenceFloor, 1.0 - (shellAgeYears - 3.0) * 0.08) : 1.0;

  return Math.max(1000, Math.round(baseEggs * senescenceDiscount));
}
