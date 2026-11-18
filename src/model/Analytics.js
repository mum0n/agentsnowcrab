/**
 * src/model/Analytics.js
 *
 * Analytical calibration routines, macro-ecological biomass dynamic models,
 * non-linear stock-recruitment regressions, and spatial exclusion geometries
 * harmonized with TethysBio.
 */

/**
 * Axis-Aligned Bounding Box (AABB) defining a spatial marine reserve or
 * no-take fishing exclusion zone on the 2D simulation grid.
 */
export class ExclusionBox {
  constructor({
    id = 1,
    name = 'MPA-1',
    xmin = 20,
    xmax = 50,
    ymin = 20,
    ymax = 50,
    active = true,
  } = {}) {
    this.id = id;
    this.name = name;
    this.xmin = Math.min(xmin, xmax);
    this.xmax = Math.max(xmin, xmax);
    this.ymin = Math.min(ymin, ymax);
    this.ymax = Math.max(ymin, ymax);
    this.active = Boolean(active);
  }

  contains(x, y) {
    if (!this.active) return false;
    return x >= this.xmin && x <= this.xmax && y >= this.ymin && y <= this.ymax;
  }
}

/**
 * Evaluate whether coordinate (x, y) falls within any active exclusion zone.
 *
 * @param {number} x - Horizontal grid coordinate.
 * @param {number} y - Vertical grid coordinate.
 * @param {ExclusionBox[]} boxes - Collection of exclusion zones.
 * @returns {boolean} True if protected from commercial fishing.
 */
export function isInExclusionZones(x, y, boxes = []) {
  if (!boxes || boxes.length === 0) return false;
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].contains(x, y)) return true;
  }
  return false;
}

/**
 * Standard 20-stage baseline abundance distribution for Chionoecetes opilio:
 * Stages 0-3: Brooded eggs and pelagic larvae (aggregate cohorts).
 * Stages 4-8: Early benthic juveniles (instars I-V).
 * Stages 9-14: Male benthic and terminal instars (VI-XI+).
 * Stages 15-19: Female benthic and terminal instars (VI-X+).
 */
export const DEFAULT_STAGE_DISTRIBUTION = [
  300.0, 150.0, 120.0, 100.0,
  80.0, 70.0, 60.0, 50.0, 45.0,
  40.0, 35.0, 30.0, 25.0, 20.0, 15.0,
  40.0, 35.0, 30.0, 25.0, 20.0,
];

export const STAGE_LABELS = [
  'Egg', 'z1', 'z2', 'm',
  '1', '2', '3', '4', '5', '6', '7', '8',
  '9', '10', '11', '12', '13', '14', '15', '16',
];

/**
 * Climatological ambient bottom temperature on the Scotian Shelf.
 *
 * T_bottom = 2.0 + 2.5 * exp(-((depth - 150.0) / 60.0)^2) + 0.3 * (45.0 - lat)
 */
export function bottomTemperature(depth, latitude, tempOffset = 0.0) {
  const z = Math.max(10.0, Number(depth) || 150.0);
  const phi = Number(latitude) || 45.0;
  return 2.0 + 2.5 * Math.exp(-(((z - 150.0) / 60.0) ** 2)) + 0.3 * (45.0 - phi) + (Number(tempOffset) || 0.0);
}

/**
 * Seasonal bottom temperature annual cycle curve for a chosen location.
 * Depth-attenuated seasonal amplitude and sinusoidal progression.
 *
 * @param {number} lon - Longitude in degrees.
 * @param {number} lat - Latitude in degrees.
 * @param {number} depth - Seabed bathymetric depth in meters.
 * @param {number} tempOffset - Baseline offset in °C.
 * @param {number} tempMultiplier - Amplitude multiplier.
 * @param {number} phaseDay - Day of peak temperature (default: 80.0).
 * @returns {object} { days, temps, meanT, amp }
 */
export function seasonalBottomTemperatureCycle(
  lon,
  lat,
  depth = 135.0,
  tempOffset = 0.0,
  tempMultiplier = 1.0,
  phaseDay = 80.0
) {
  const dVal = Math.max(10.0, Number(depth) || 135.0);
  const phi = Number(lat) || 45.0;
  const tOff = Number(tempOffset) || 0.0;
  const tMult = Number(tempMultiplier) || 1.0;

  const meanT = 2.0 + 2.5 * Math.exp(-(((dVal - 150.0) / 60.0) ** 2)) + 0.3 * (45.0 - phi) + tOff;
  const baseAmp = Math.max(0.5, 5.0 * Math.exp(-dVal / 100.0));
  const amp = baseAmp * tMult;

  const days = [];
  const temps = [];
  for (let d = 1; d <= 365; d++) {
    days.push(d);
    const rad = (2.0 * Math.PI * (d - phaseDay)) / 365.0;
    temps.push(meanT + amp * Math.sin(rad));
  }

  return { days, temps, meanT, amp, depth: dVal, lat: phi, lon };
}

/**
 * Realized Habitat Suitability Index (HSI) modulated by temperature and depth envelopes.
 */
export function habitatSuitability(temp, depth, env = {}) {
  const tempMin = Number.isFinite(Number(env?.temp_pref_min)) ? Number(env.temp_pref_min) : -1.5;
  const tempOpt = Number.isFinite(Number(env?.temp_pref_opt)) ? Number(env.temp_pref_opt) : 5.0;
  const tempMax = Math.max(tempOpt + 0.1, Number.isFinite(Number(env?.temp_pref_max)) ? Number(env.temp_pref_max) : 10.0);

  let sT = 0.0;
  if (temp > tempMin - 2.0 && temp < tempMax) {
    if (temp < tempMin) {
      sT = 0.5 * (1.0 + Math.cos((Math.PI * (tempMin - temp)) / 2.0));
    } else {
      const tempSteepness = Number.isFinite(Number(env?.temp_steepness)) ? Number(env.temp_steepness) : 1.0;
      sT = 1.0 / (1.0 + Math.exp(tempSteepness * (temp - tempOpt)));
      if (temp > tempOpt) {
        sT *= 0.5 * (1.0 + Math.cos((Math.PI * (temp - tempOpt)) / (tempMax - tempOpt)));
      }
    }
  }
  const depthOpt = Number.isFinite(Number(env?.depth_opt)) ? Number(env.depth_opt) : 200.0;
  const depthSigma = Math.max(1.0, Number.isFinite(Number(env?.depth_sigma)) ? Number(env.depth_sigma) : 100.0);
  let sZ = 0.0;
  if (depth > 20.0) {
    sZ = Math.exp(-0.5 * (((depth - depthOpt) / depthSigma) ** 2));
    const taperWidth = Math.min(40.0, Math.max(1.0, depthOpt - 20.0));
    if (depth < 20.0 + taperWidth) {
      sZ *= 0.5 * (1.0 - Math.cos((Math.PI * (depth - 20.0)) / taperWidth));
    }
  }
  return Math.max(0.0, Math.min(1.0, sT * sZ));
}

/**
 * Generate 2D continuous raster grids for bathymetry, temperature, and HSI.
 *
 * @param {number} gridSize - Side length of the square domain.
 * @param {object} aoi - Center coordinate and reference depth.
 * @returns {object} Flat raster arrays and dimensions.
 */
export function generateEnvironmentalGrid(gridSize, aoi = { longitude: -60, latitude: 45, depth: 150 }) {
  const depth = new Float64Array(gridSize * gridSize);
  const temperature = new Float64Array(gridSize * gridSize);
  const hsi = new Float64Array(gridSize * gridSize);

  const cx = gridSize / 2;
  const cy = gridSize / 2;
  const baseLat = Number(aoi.latitude) || 45.0;
  const baseDepth = Number(aoi.depth) || 150.0;

  for (let y = 0; y < gridSize; y++) {
    const lat = baseLat + ((y - cy) / gridSize) * 2.0;
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Shelf valley bathymetric profile with gentle continental slope
      const z = Math.max(30.0, baseDepth + 120.0 * (dist - 0.35) + 18.0 * Math.sin(dx * 4.0));
      const t = bottomTemperature(z, lat);
      const s = habitatSuitability(t, z);

      depth[idx] = z;
      temperature[idx] = t;
      hsi[idx] = s;
    }
  }

  return { gridSize, depth, temperature, hsi };
}

/**
 * Fit non-linear stock-recruitment relationships:
 * 1. Beverton-Holt: R = (alpha * S) / (1 + beta * S) via linear S/R = a + b*S
 * 2. Ricker: R = alpha * S * exp(-beta * S) via linear ln(R/S) = u - v*S
 *
 * @param {number[]} spawners - Vector of spawning stock estimates.
 * @param {number[]} recruits - Vector of recruitment estimates.
 * @returns {object} Fitted parameters, predictions, R2, and AIC metrics.
 */
export function fitStockRecruitment(spawners, recruits) {
  const valid = [];
  for (let i = 0; i < spawners.length; i++) {
    const s = Number(spawners[i]);
    const r = Number(recruits[i]);
    if (s > 0 && r > 0 && Number.isFinite(s) && Number.isFinite(r)) {
      valid.push({ s, r });
    }
  }

  const n = valid.length;
  if (n < 3) {
    return {
      isFitted: false,
      nObs: n,
      bevertonHolt: { alpha: 1.0, beta: 0.0, r2: 0.0, aic: Infinity, predict: (s) => s },
      ricker: { alpha: 1.0, beta: 0.0, r2: 0.0, aic: Infinity, predict: (s) => s },
      bestModel: 'none',
    };
  }

  const sMean = valid.reduce((acc, p) => acc + p.s, 0) / n;
  const rMean = valid.reduce((acc, p) => acc + p.r, 0) / n;
  let ssTot = valid.reduce((acc, p) => acc + (p.r - rMean) ** 2, 0);
  if (ssTot <= 1e-12) ssTot = 1.0;

  // 1. Beverton-Holt linear regression: y = S / R = a + b * S
  const yBH = valid.map((p) => p.s / p.r);
  const yBHMean = yBH.reduce((a, b) => a + b, 0) / n;
  let varS = 0;
  let covSYBH = 0;
  for (let i = 0; i < n; i++) {
    const ds = valid[i].s - sMean;
    varS += ds * ds;
    covSYBH += ds * (yBH[i] - yBHMean);
  }
  if (varS <= 1e-12) varS = 1.0;

  const bBH = covSYBH / varS;
  const aBH = yBHMean - bBH * sMean;
  const alphaBH = aBH > 1e-6 ? 1.0 / aBH : rMean / Math.max(sMean, 1e-6);
  const betaBH = aBH > 1e-6 && bBH > 0.0 ? bBH / aBH : 0.0;
  const bhPredict = (s) => (alphaBH * s) / (1.0 + betaBH * s);

  const ssResBH = valid.reduce((acc, p) => acc + (p.r - bhPredict(p.s)) ** 2, 0);
  const r2BH = Math.max(0.0, 1.0 - ssResBH / ssTot);
  const aicBH = n * Math.log(Math.max(1e-12, ssResBH / n)) + 4.0;

  // 2. Ricker linear regression: y = ln(R / S) = u - v * S
  const yRK = valid.map((p) => Math.log(p.r / p.s));
  const yRKMean = yRK.reduce((a, b) => a + b, 0) / n;
  let covSYRK = 0;
  for (let i = 0; i < n; i++) {
    covSYRK += (valid[i].s - sMean) * (yRK[i] - yRKMean);
  }
  const vRK = -covSYRK / varS;
  const uRK = yRKMean + vRK * sMean;
  const alphaRK = Math.exp(uRK);
  const betaRK = Math.max(0.0, vRK);
  const rkPredict = (s) => alphaRK * s * Math.exp(-betaRK * s);

  const ssResRK = valid.reduce((acc, p) => acc + (p.r - rkPredict(p.s)) ** 2, 0);
  const r2RK = Math.max(0.0, 1.0 - ssResRK / ssTot);
  const aicRK = n * Math.log(Math.max(1e-12, ssResRK / n)) + 4.0;

  const bestModel = aicBH <= aicRK ? 'bevertonHolt' : 'ricker';

  return {
    isFitted: true,
    nObs: n,
    bevertonHolt: {
      alpha: alphaBH,
      beta: betaBH,
      r2: r2BH,
      aic: aicBH,
      predict: bhPredict,
    },
    ricker: {
      alpha: alphaRK,
      beta: betaRK,
      r2: r2RK,
      aic: aicRK,
      predict: rkPredict,
    },
    bestModel,
  };
}

/**
 * Fit the Schaefer surplus production dynamic model:
 * N_{t+1} = N_t + r * N_t * (1 - N_t / K) - C_t
 *
 * @param {number[]} time - Observation timestamps (annual or monthly).
 * @param {number[]} numbers - Observed fishable stock biomass/numbers.
 * @param {number[]} catches - Observed catch removals.
 * @returns {object} Estimated parameters r, K, MSY, predicted trajectory, and R2.
 */
export function fitSchaefer(time, numbers, catches) {
  const n = numbers.length;
  if (n < 3) {
    return {
      isFitted: false,
      r: 0.35,
      K: 1000,
      msy: 0,
      r2: 0,
      predicted: [...numbers],
    };
  }

  const nVals = numbers.map(Number);
  const cVals = catches.map(Number);

  // Process error regression anchor: P_t = N_{t+1} - N_t + C_t = r*N_t - (r/K)*N_t^2
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let t = 0; t < n - 1; t++) {
    const nt = nVals[t];
    const pt = nVals[t + 1] - nt + cVals[t];
    s11 += nt * nt;
    s12 += -(nt ** 3);
    s22 += nt ** 4;
    y1 += nt * pt;
    y2 += -(nt * nt) * pt;
  }
  const det = s11 * s22 - s12 * s12;

  let rInit = 0.35;
  let kInit = nVals.reduce((a, b) => (a > b ? a : b), -Infinity) * 1.5;
  if (det > 1e-9) {
    const a1 = (s22 * y1 - s12 * y2) / det;
    const a2 = (s11 * y2 - s12 * y1) / det;
    if (a1 > 0.01 && a2 > 1e-12) {
      rInit = a1;
      kInit = a1 / a2;
    }
  }

  // Optimize (r, K) via refined grid search over plausible bounds
  function simulate(rVal, kVal) {
    const pred = new Array(n);
    pred[0] = nVals[0];
    for (let t = 0; t < n - 1; t++) {
      const pop = Math.max(1e-6, pred[t]);
      const growth = rVal * pop * (1.0 - pop / kVal);
      pred[t + 1] = Math.max(0.0, pop + growth - cVals[t]);
    }
    return pred;
  }

  let bestR = rInit;
  let bestK = kInit;
  let bestSS = Infinity;

  const rGrid = [0.1, 0.2, 0.35, 0.5, 0.7, 1.0, 1.4];
  const kGrid = [0.6, 0.8, 1.0, 1.3, 1.8, 2.5, 3.5];

  for (const rMul of rGrid) {
    const rTest = Math.max(0.01, rInit * rMul);
    for (const kMul of kGrid) {
      const kTest = Math.max(10.0, kInit * kMul);
      const pred = simulate(rTest, kTest);
      let ss = 0;
      for (let i = 0; i < n; i++) {
        ss += (nVals[i] - pred[i]) ** 2;
      }
      if (ss < bestSS) {
        bestSS = ss;
        bestR = rTest;
        bestK = kTest;
      }
    }
  }

  const predicted = simulate(bestR, bestK);
  const nMean = nVals.reduce((a, b) => a + b, 0) / n;
  let ssTot = nVals.reduce((acc, v) => acc + (v - nMean) ** 2, 0);
  if (ssTot <= 1e-12) ssTot = 1.0;
  const r2 = Math.max(0.0, 1.0 - bestSS / ssTot);
  const msy = (bestR * bestK) / 4.0;

  return {
    isFitted: true,
    r: bestR,
    K: bestK,
    msy,
    r2,
    predicted,
  };
}

/**
 * Fit the Deriso-Schnute delay-difference dynamic model:
 * N_{t+1} = s * (N_t - C_t) + (alpha * N_{t+1-lag}) / (1 + beta * N_{t+1-lag})
 *
 * @param {number[]} time - Observation timestamps.
 * @param {number[]} numbers - Observed population abundance.
 * @param {number[]} catches - Observed removals.
 * @param {number} lag - Spawning-to-recruitment time lag.
 * @returns {object} Estimated parameters s, alpha, beta, predicted trajectory, and R2.
 */
export function fitDelayDifference(time, numbers, catches, lag = 1) {
  const n = numbers.length;
  if (n < lag + 2) {
    return {
      isFitted: false,
      s: 0.8,
      alpha: 0.2,
      beta: 0.001,
      r2: 0,
      predicted: [...numbers],
    };
  }

  const nVals = numbers.map(Number);
  const cVals = catches.map(Number);

  function simulate(sVal, alphaVal, betaVal) {
    const pred = new Array(n);
    for (let t = 0; t <= lag; t++) pred[t] = nVals[t];
    for (let t = lag; t < n - 1; t++) {
      const spawner = Math.max(1e-6, pred[t + 1 - lag]);
      const recruit = (alphaVal * spawner) / (1.0 + betaVal * spawner);
      const escaped = Math.max(0.0, pred[t] - cVals[t]);
      pred[t + 1] = sVal * escaped + recruit;
    }
    return pred;
  }

  let bestS = 0.8;
  let bestAlpha = 0.25;
  let bestBeta = 0.0005;
  let bestSS = Infinity;

  const sCandidates = [0.65, 0.75, 0.82, 0.90];
  const alphaCandidates = [0.1, 0.2, 0.35, 0.5];
  const betaCandidates = [0.0001, 0.0005, 0.002, 0.01];

  for (const s of sCandidates) {
    for (const a of alphaCandidates) {
      for (const b of betaCandidates) {
        const pred = simulate(s, a, b);
        let ss = 0;
        for (let i = lag; i < n; i++) {
          ss += (nVals[i] - pred[i]) ** 2;
        }
        if (ss < bestSS) {
          bestSS = ss;
          bestS = s;
          bestAlpha = a;
          bestBeta = b;
        }
      }
    }
  }

  const predicted = simulate(bestS, bestAlpha, bestBeta);
  const nMean = nVals.slice(lag).reduce((a, b) => a + b, 0) / (n - lag);
  let ssTot = nVals.slice(lag).reduce((acc, v) => acc + (v - nMean) ** 2, 0);
  if (ssTot <= 1e-12) ssTot = 1.0;
  const r2 = Math.max(0.0, 1.0 - bestSS / ssTot);

  return {
    isFitted: true,
    s: bestS,
    alpha: bestAlpha,
    beta: bestBeta,
    r2,
    predicted,
  };
}

/**
 * Fit a Generalized Leslie / stage-projection model across annual stage abundance series.
 */
export function fitGeneralizedLeslieModel(time, numbers, catches = []) {
  const nVals = numbers.map(Number);
  const n = nVals.length;
  if (n < 3) {
    return { isFitted: false, lambda1: 1.0, r2: 0.0, predicted: [...nVals] };
  }
  let num = 0;
  let den = 0;
  for (let i = 0; i < n - 1; i++) {
    const c = Number(catches[i] || 0);
    const base = Math.max(1e-6, nVals[i] - c);
    num += base * nVals[i + 1];
    den += base * base;
  }
  const lambda1 = den > 0 ? Math.max(0.2, Math.min(2.5, num / den)) : 1.0;
  const predicted = [nVals[0]];
  for (let i = 0; i < n - 1; i++) {
    const c = Number(catches[i] || 0);
    predicted.push(Math.max(0, lambda1 * Math.max(0, predicted[i] - c)));
  }
  const meanY = nVals.reduce((a, b) => a + b, 0) / n;
  const ssTot = Math.max(1e-9, nVals.reduce((acc, v) => acc + (v - meanY) ** 2, 0));
  const ssRes = nVals.reduce((acc, v, i) => acc + (v - predicted[i]) ** 2, 0);
  const r2 = Math.max(0.0, 1.0 - ssRes / ssTot);
  return { isFitted: true, lambda1, r2, predicted };
}

/**
 * AIC/R2 comparison across Schaefer, Delay-Difference, and Generalized Leslie models.
 */
export function compareMacroModels(time, numbers, catches) {
  const schaefer = fitSchaefer(time, numbers, catches);
  const delayDifference = fitDelayDifference(time, numbers, catches);
  const leslie = fitGeneralizedLeslieModel(time, numbers, catches);
  const scores = [
    { name: 'schaefer', r2: schaefer.r2 || 0 },
    { name: 'delay_difference', r2: delayDifference.r2 || 0 },
    { name: 'leslie', r2: leslie.r2 || 0 },
  ];
  scores.sort((a, b) => b.r2 - a.r2);
  return { schaefer, delayDifference, leslie, bestModel: scores[0].name };
}

/**
 * Compute Mohn's rho retrospective bias statistic.
 */
export function mohnRho(peelEndpoints, fullValues) {
  if (!peelEndpoints.length || peelEndpoints.length !== fullValues.length) return 0.0;
  let sum = 0.0;
  let cnt = 0;
  for (let i = 0; i < peelEndpoints.length; i++) {
    if (fullValues[i] !== 0) {
      sum += (peelEndpoints[i] - fullValues[i]) / fullValues[i];
      cnt += 1;
    }
  }
  return cnt > 0 ? sum / cnt : 0.0;
}

/**
 * Perform retrospective peels on the Schaefer model and compute Mohn's rho.
 */
export function retrospectiveAnalysis(time, numbers, catches, nPeels = 4) {
  const full = fitSchaefer(time, numbers, catches);
  const peels = [];
  const fullRefs = [];
  for (let p = 1; p <= nPeels; p++) {
    if (numbers.length - p < 4) break;
    const sub = fitSchaefer(time.slice(0, -p), numbers.slice(0, -p), catches.slice(0, -p));
    peels.push(sub.predicted[sub.predicted.length - 1]);
    fullRefs.push(full.predicted[numbers.length - p - 1]);
  }
  return { mohnRho: mohnRho(peels, fullRefs), peelEndpoints: peels };
}

/**
 * Compute binned empirical maturity ogive.
 */
export function computeEmpiricalOgive(agents, sex = 'male', binWidth = 5.0) {
  const sub = (agents || []).filter((a) => a.alive && a.sex === sex);
  if (!sub.length) return { sizes: [], proportions: [], counts: [] };
  const bins = new Map();
  for (const a of sub) {
    const mid = Math.floor(a.cw / binWidth) * binWidth + binWidth * 0.5;
    if (!bins.has(mid)) bins.set(mid, { tot: 0, mat: 0 });
    const rec = bins.get(mid);
    rec.tot += 1;
    if (a.mature) rec.mat += 1;
  }
  const keys = Array.from(bins.keys()).sort((a, b) => a - b);
  return {
    sizes: keys,
    proportions: keys.map((k) => bins.get(k).mat / bins.get(k).tot),
    counts: keys.map((k) => bins.get(k).tot),
  };
}

/**
 * Gaussian KDE density over a carapace width grid.
 */
export function kdeDensity(values, from = 5, to = 160, n = 100, bandwidth = 4.0) {
  const x = Array.from({ length: n }, (_, i) => from + (i / (n - 1)) * (to - from));
  if (!values || !values.length) return { x, y: x.map(() => 0) };
  const bw = Math.max(0.5, bandwidth);
  const invNorm = 1.0 / (values.length * bw * Math.sqrt(2.0 * Math.PI));
  const y = x.map((gx) => {
    let s = 0;
    for (let j = 0; j < values.length; j++) {
      const d = (gx - values[j]) / bw;
      s += Math.exp(-0.5 * d * d);
    }
    return s * invNorm;
  });
  return { x, y };
}

/**
 * Evaluate multi-attribute calibration criteria matching TethysBio::evaluate_population_criteria.
 */
export function evaluatePopulationCriteria(history = [], agents = [], params = {}) {
  const k = params.environment?.benthic_carrying_capacity_density ?? 6000;
  const critCfg = params.criteria || {};
  const maxSizeDrift = critCfg.max_size_drift ?? 0.20;
  const maxMaturityRmse = critCfg.max_maturity_rmse ?? 0.35;
  const maxGrowthRmse = critCfg.max_growth_rmse ?? 15.0;
  const windowSteps = critCfg.window_steps ?? 10;
  const ogiveMinCount = critCfg.maturity_ogive_min_count ?? 5;

  const pops = history.map((h) => h.total || 0);
  const living = (agents || []).filter((a) => a.alive);
  const nLiving = living.length;
  const minPop = pops.length ? Math.min(...pops) : nLiving;
  const maxPop = pops.length ? Math.max(...pops) : nLiving;
  const persistence = nLiving >= 1 && minPop >= 1;
  const noExplosion = maxPop <= k * 3.0;

  let sizeDrift = null;
  let isSizeSteady = false;
  if (history.length >= 4) {
    const tail = history.slice(-Math.min(windowSteps, history.length));
    const sizes = tail.map((h) => Number(h.mean_cw) || 0).filter((v) => v > 0);
    if (sizes.length >= 2) {
      const meanRecent = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      if (meanRecent > 0) {
        sizeDrift = Math.abs(sizes[sizes.length - 1] - sizes[0]) / meanRecent;
        isSizeSteady = sizeDrift <= maxSizeDrift;
      }
    }
  }

  let maturityRmse = null;
  let isMaturityRealistic = false;
  const emp = computeEmpiricalOgive(living, 'male', 5.0);
  if (emp.sizes.length > 0) {
    const m = params.maturity || {};
    const l50 = m.maturity_l50_male ?? 91.8;
    const slope = m.maturity_slope_male ?? 6.9957;
    const gate = m.maturity_size_gate ?? 35.0;
    let se = 0;
    let validBins = 0;
    for (let i = 0; i < emp.sizes.length; i++) {
      if ((emp.counts[i] || 0) < ogiveMinCount) continue;
      const sz = emp.sizes[i];
      const pred = sz < gate ? 0.0 : 1.0 / (1.0 + Math.exp(-slope * (Math.log(sz) - Math.log(l50))));
      se += (emp.proportions[i] - pred) ** 2;
      validBins += 1;
    }
    if (validBins > 0) {
      maturityRmse = Math.sqrt(se / validBins);
      isMaturityRealistic = maturityRmse <= maxMaturityRmse;
    }
  }

  let growthRmse = null;
  let isGrowthRealistic = false;
  if (living.length > 0) {
    const g = params.growth || {};
    const refMale = new Map();
    const refFemale = new Map();
    let cwM = 4.5;
    let cwF = 4.5;
    for (let stg = 4; stg <= 19; stg++) {
      refMale.set(stg, cwM);
      refFemale.set(stg, cwF);
      cwM = Math.min(g.max_size_male ?? 160.0, Math.exp((g.growth_int_male ?? 0.30153) + (g.growth_slp_male ?? 1.00027) * Math.log(cwM)));
      cwF = Math.min(g.max_size_female ?? 95.0, Math.exp((g.growth_int_female ?? 0.1931) + (g.growth_slp_female ?? 1.0372) * Math.log(cwF)));
    }
    const obsByKey = new Map();
    for (const a of living) {
      const key = `${a.sex}:${a.stage}`;
      if (!obsByKey.has(key)) obsByKey.set(key, []);
      obsByKey.get(key).push(a.cw);
    }
    let sqErrSum = 0;
    let nGroups = 0;
    for (const [key, vals] of obsByKey.entries()) {
      if (vals.length < 3) continue;
      const [sex, stgStr] = key.split(':');
      const stg = Number(stgStr);
      const refVal = sex === 'male' ? refMale.get(stg) : refFemale.get(stg);
      if (refVal !== undefined) {
        const meanObs = vals.reduce((a, b) => a + b, 0) / vals.length;
        sqErrSum += (meanObs - refVal) ** 2;
        nGroups += 1;
      }
    }
    if (nGroups > 0) {
      growthRmse = Math.sqrt(sqErrSum / nGroups);
      isGrowthRealistic = growthRmse <= maxGrowthRmse;
    }
  }

  return {
    persistence,
    noExplosion,
    nLiving,
    maxPop,
    k,
    sizeDrift,
    sizeStabilityOk: isSizeSteady,
    maturityRmse,
    isMaturityRealistic,
    growthRmse,
    isGrowthRealistic,
  };
}

/**
 * Export scenario configuration to a TethysBio-compatible TOML string.
 */
export function exportScenarioToml(config = {}) {
  const env = config.environment || {};
  const fish = config.fishery || {};
  return [
    '[simulation]',
    `n_agents = ${config.n_agents ?? 400}`,
    `grid_size = ${config.grid_size ?? 50}`,
    '',
    '[environment]',
    `temp_offset = ${(env.temp_offset ?? 0).toFixed(4)}`,
    `temp_multiplier = ${(env.temp_multiplier ?? 1).toFixed(4)}`,
    `benthic_carrying_capacity_density = ${(env.benthic_carrying_capacity_density ?? 6000).toFixed(2)}`,
    '',
    '[fishery]',
    `fishing_harvest_rate_annual = ${(fish.fishing_harvest_rate_annual ?? 0).toFixed(4)}`,
    `legal_size_male = ${(fish.legal_size_male ?? 95).toFixed(2)}`,
    `fishing_season_start = ${(fish.fishing_season_start ?? 90).toFixed(1)}`,
    `fishing_season_end = ${(fish.fishing_season_end ?? 150).toFixed(1)}`,
  ].join('\n');
}

