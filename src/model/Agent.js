export function randn(seed) {
  let s = seed;
  return () => {
    let u, v, q;
    do {
      u = Math.random();
      v = Math.random();
      q = u * u + v * v;
    } while (q >= 1 || q === 0);
    const mult = Math.sqrt((-2 * Math.log(q)) / q);
    return u * mult;
  };
}

export function createAgent(id, x, y, seed) {
  const rnd = randn(seed + id);
  const sex = Math.random() < 0.5 ? 'male' : 'female';
  return {
    id,
    x,
    y,
    sex,
    cw: 25.0 + Math.random() * 10.0,
    stage: 1,
    mature: false,
    shell_age: 0,
    eggs: 0,
    alive: true,
    caught: false,
    fishery_removed: false,
    rnd,
  };
}

export function growthIncrement(agent, T, g) {
  const lnCW = Math.log(Math.max(agent.cw, 1));
  const mat = agent.mature ? g.delta_mat : 0;
  const noise = g.sigma * agent.rnd();
  let lnNext = g.beta0 + g.beta1 * lnCW + mat + g.gamma_T * (T - g.temp_ref) + noise;
  const maxSize = agent.sex === 'male' ? g.max_size_male : g.max_size_female;
  return Math.exp(Math.min(lnNext, Math.log(maxSize)));
}

export function maturityProbability(agent, T, m) {
  const lnCW = Math.log(Math.max(agent.cw, 1));
  const z = m.alpha + m.beta * lnCW + m.gamma_T * (T - m.temp_ref);
  return 1 / (1 + Math.exp(-z));
}

export function mortalityHazards(agent, N, K, T, mo) {
  const base = mo.base;
  const pred = mo.predation_coeff * agent.cw;
  const starve = mo.starvation_coeff * Math.max(0, 50 - agent.cw);
  const thermal = mo.thermal_coeff * Math.max(0, Math.abs(T - 10));
  const senescence = agent.shell_age * mo.senescence_coeff;
  const cannibal = mo.cannibalism_coeff;
  const density = 1 + Math.pow(N / Math.max(K, 1), mo.density_gamma);
  return base + pred + starve + thermal + senescence + cannibal;
}

export function fecundity(agent, rep) {
  const first = agent.shell_age <= 1;
  const base = first ? rep.primiparous_fecundity : rep.multiparous_fecundity;
  const discount = Math.max(0, 1 - agent.shell_age * rep.senescence_discount);
  return Math.round(base * discount);
}
