/**
 * src/model/Model.js
 *
 * Spatially explicit Individual-Based Model (IBM) for snow crab (Chionoecetes opilio).
 * Couples continuous Eulerian environmental fields (depth, bottom temperature, HSI)
 * with Lagrangian agent dynamics, 20-stage life-history cohort transitions,
 * directed habitat taxis, and spatial marine reserves (ExclusionBox).
 */

import {
  createAgent,
  growthIncrement,
  moltConditionFactor,
  moltProbability,
  maturityProbability,
  mortalityHazards,
  calculateEnergyChange,
  fecundity,
  biomassKg,
  isEmpiricallyMeasured,
} from './Agent.js';
import {
  ExclusionBox,
  isInExclusionZones,
  DEFAULT_STAGE_DISTRIBUTION,
  bottomTemperature,
  habitatSuitability,
} from './Analytics.js';
import { SCOTIAN_SHELF_GEO } from '../data/scotianShelfGeo.js';

const catmullRom = (p0, p1, p2, p3, t) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2.0 * p1 +
    (-p0 + p2) * t +
    (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
    (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
  );
};

export const scotianShelfDepth = (lon, lat) => {
  const g = SCOTIAN_SHELF_GEO;
  if (g && g.z && g.nx && g.ny) {
    const u = ((lon - g.lonMin) / (g.lonMax - g.lonMin)) * (g.nx - 1);
    const v = ((lat - g.latMin) / (g.latMax - g.latMin)) * (g.ny - 1);
    const i1 = Math.max(0, Math.min(g.nx - 2, Math.floor(u)));
    const j1 = Math.max(0, Math.min(g.ny - 2, Math.floor(v)));
    const du = Math.max(0.0, Math.min(1.0, u - i1));
    const dv = Math.max(0.0, Math.min(1.0, v - j1));
    const ix = [
      Math.max(0, i1 - 1),
      i1,
      Math.min(g.nx - 1, i1 + 1),
      Math.min(g.nx - 1, i1 + 2),
    ];
    const rowVal = (jj) => {
      const jc = Math.max(0, Math.min(g.ny - 1, jj));
      const off = jc * g.nx;
      return catmullRom(g.z[off + ix[0]], g.z[off + ix[1]], g.z[off + ix[2]], g.z[off + ix[3]], du);
    };
    const zInterp = catmullRom(rowVal(j1 - 1), rowVal(j1), rowVal(j1 + 1), rowVal(j1 + 2), dv);
    return zInterp;
  }
  return 135;
};

export class Model {
  constructor(params = {}) {
    this.params = params;
    this.aoi = { longitude: -59.0, latitude: 45.0, depth: 135.0 };
    const sim = params.simulation || {};
    const ibm = params.ibm || {};
    const env = params.environment || {};

    this.gridSize = sim.grid_nx || ibm.grid_size || 1000;
    this.unitMeters = sim.unit_meters || ibm.unit_meters || 1.0;
    this.foodAvailability = env.food_availability || ibm.food_availability || 1.0;
    this.benthicCarryingCapacityDensity = env.benthic_carrying_capacity_density || ibm.benthic_carrying_capacity_density || 6000.0;
    this.tempOffset = env.temp_offset ?? ibm.temp_offset ?? 0.0;
    this.tempMultiplier = env.temp_multiplier ?? ibm.temp_multiplier ?? 1.0;
    this.habitatOffset = env.habitat_offset ?? ibm.habitat_offset ?? 0.0;
    this.habitatMultiplier = env.habitat_multiplier ?? ibm.habitat_multiplier ?? 1.0;
    this.backgroundLayer = ibm.background_layer || 'depth';
    this.seed = sim.seed || ibm.seed || 1234;
    this.day = 0;

    this.exclusionBoxes = [];

    this.sampleResolution = 400;
    this.buildEnvironmentalGrid();

    this.agents = [];
    this.pelagicCohorts = {
      egg: 2000,
      zoea1: 1000,
      zoea2: 800,
      megalopa: 500,
    };

    this.stageCounts = new Array(20).fill(0);
    this.history = [];
    this.annual = [];
    this.catchTotal = 0;
    this.catchLegal = 0;
    this.births = 0;
    this.deaths = 0;
  }

  setAOI(aoi) {
    this.aoi = { ...this.aoi, ...aoi };
    if (!this.aoi.depth) {
      this.aoi.depth = scotianShelfDepth(this.aoi.longitude, this.aoi.latitude);
    }
    this.buildEnvironmentalGrid();
  }

  setExclusionBox(box) {
    if (!box || box.clear || !box.active) {
      this.exclusionBoxes = [];
    } else {
      this.exclusionBoxes = [new ExclusionBox({ id: 1, name: 'MPA-Custom', ...box, active: true })];
    }
  }

  clearExclusionBoxes() {
    this.exclusionBoxes = [];
  }

  getCarryingCapacity() {
    const areaKm2 = Math.pow((this.gridSize * (this.unitMeters || 1.0)) / 1000.0, 2);
    const density = this.benthicCarryingCapacityDensity || 6000.0;
    return Math.max(1, Math.round(density * areaKm2));
  }

  buildEnvironmentalGrid() {
    const nr = this.sampleResolution;
    const centerDepth = this.aoi.depth || scotianShelfDepth(this.aoi.longitude, this.aoi.latitude);
    const baseLat = Number(this.aoi.latitude) || 45.0;

    const depthGrid = new Float64Array(nr * nr);
    const tempGrid = new Float64Array(nr * nr);
    const hsiGrid = new Float64Array(nr * nr);

    for (let j = 0; j < nr; j++) {
      const v = (j - nr / 2) / (nr / 2);
      const lat = baseLat + v * 0.3;
      for (let i = 0; i < nr; i++) {
        const u = (i - nr / 2) / (nr / 2);
        const lon = (Number(this.aoi.longitude) || -59.0) + u * 0.5;
        const z = scotianShelfDepth(lon, lat);
        const t = bottomTemperature(z, lat, this.tempOffset);
        let s = habitatSuitability(t, z, this.params.environment);
        s = Math.max(0.0, Math.min(1.0, (s + this.habitatOffset) * this.habitatMultiplier));

        const idx = j * nr + i;
        depthGrid[idx] = z;
        tempGrid[idx] = t;
        hsiGrid[idx] = s;
      }
    }

    this.env = {
      resolution: nr,
      depth: depthGrid,
      baseTemperature: new Float64Array(tempGrid),
      temperature: tempGrid,
      hsi: hsiGrid,
    };
  }

  updateEnvironmentalFields(dayOfYear) {
    if (!this.env?.baseTemperature) return;
    const { depth, baseTemperature, temperature, hsi } = this.env;
    const phaseArg = (2.0 * Math.PI * (dayOfYear - 80.0)) / 365.0;
    const sinPhase = Math.sin(phaseArg);
    const tMult = this.tempMultiplier ?? 1.0;
    const hOff = this.habitatOffset ?? 0.0;
    const hMult = this.habitatMultiplier ?? 1.0;
    for (let k = 0; k < depth.length; k++) {
      const z = depth[k];
      const baseAmp = Math.max(0.5, 5.0 * Math.exp(-z / 100.0));
      const t = baseTemperature[k] + baseAmp * tMult * sinPhase;
      temperature[k] = t;
      const s = habitatSuitability(t, z, this.params.environment);
      hsi[k] = Math.max(0.0, Math.min(1.0, (s + hOff) * hMult));
    }
  }

  getEnvAt(x, y) {
    const nr = this.sampleResolution;
    const ix = Math.max(0, Math.min(nr - 1, Math.floor((x / this.gridSize) * nr)));
    const iy = Math.max(0, Math.min(nr - 1, Math.floor((y / this.gridSize) * nr)));
    const idx = iy * nr + ix;
    return {
      depth: this.env.depth[idx],
      temperature: this.env.temperature[idx],
      hsi: this.env.hsi[idx],
    };
  }

  sampleHabitablePosition() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(Math.random() * this.gridSize);
      const y = Math.floor(Math.random() * this.gridSize);
      const e = this.getEnvAt(x, y);
      if (e.depth > 0 && e.hsi > 0) return { x, y };
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(Math.random() * this.gridSize);
      const y = Math.floor(Math.random() * this.gridSize);
      const e = this.getEnvAt(x, y);
      if (e.depth > 0) return { x, y };
    }
    return {
      x: Math.floor(Math.random() * this.gridSize),
      y: Math.floor(Math.random() * this.gridSize),
    };
  }

  initialize(nAgents = 120, options = {}) {
    this.agents = [];
    this.day = 0;
    this.catchTotal = 0;
    this.catchLegal = 0;
    this.births = 0;
    this.deaths = 0;
    this.history = [];
    this.annual = [];

    const targetN = Math.max(20, nAgents || 120);

    this.pelagicCohorts = {
      egg: 2000,
      zoea1: 1000,
      zoea2: 800,
      megalopa: 500,
    };

    const benthicStages = DEFAULT_STAGE_DISTRIBUTION.slice(4);
    const weightSum = benthicStages.reduce((a, b) => a + b, 0);

    let created = 0;
    for (let sIdx = 0; sIdx < benthicStages.length; sIdx++) {
      const stageId = sIdx + 4;
      const count = Math.max(1, Math.round((benthicStages[sIdx] / weightSum) * targetN));
      const sex = stageId <= 8 ? (Math.random() < 0.5 ? 'male' : 'female') : (stageId <= 14 ? 'male' : 'female');

      for (let i = 0; i < count; i++) {
        const { x, y } = this.sampleHabitablePosition();
        const agent = createAgent(created, x, y, this.seed + created, stageId, sex);
        this.agents.push(agent);
        created += 1;
      }
    }

    this.record();
  }

  /**
   * Build an O(N) coarse B x B density grid of empirically measured organisms
   * (stage >= 11 or mature) and store local density / carrying-capacity ratios.
   */
  buildLocalCrowdingGrid(kDensity, unitMeters) {
    const gsz = this.gridSize;
    const rawB = this.params.environment?.local_crowding_box_size ?? 0;
    const B = Math.max(1, Math.min(gsz, rawB > 0 ? Math.round(rawB) : Math.round(gsz / 5)));
    const nTiles = Math.max(1, Math.ceil(gsz / B));
    const counts = new Float64Array(nTiles * nTiles);
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive || !isEmpiricallyMeasured(a)) continue;
      const tx = Math.min(nTiles - 1, Math.max(0, Math.floor(a.x / B)));
      const ty = Math.min(nTiles - 1, Math.max(0, Math.floor(a.y / B)));
      counts[ty * nTiles + tx] += 1.0;
    }
    const tileAreaKm2 = Math.max(1.0e-9, ((B * unitMeters) ** 2) / 1.0e6);
    const ratios = new Float64Array(nTiles * nTiles);
    const kDen = Math.max(1.0e-6, kDensity);
    for (let idx = 0; idx < counts.length; idx++) {
      ratios[idx] = (counts[idx] / tileAreaKm2) / kDen;
    }
    this._crowding = { B, nTiles, ratios, tileDelta: (1.0 / tileAreaKm2) / kDen };
  }

  decrementLocalCrowding(agent) {
    const c = this._crowding;
    if (!c || !isEmpiricallyMeasured(agent)) return;
    const tx = Math.min(c.nTiles - 1, Math.max(0, Math.floor(agent.x / c.B)));
    const ty = Math.min(c.nTiles - 1, Math.max(0, Math.floor(agent.y / c.B)));
    const idx = ty * c.nTiles + tx;
    c.ratios[idx] = Math.max(0.0, c.ratios[idx] - c.tileDelta);
  }

  getLocalCrowding(x, y) {
    const c = this._crowding;
    if (!c) return 0.0;
    // Bilinear interpolation across B x B tile centers for C^0 continuity
    const fx = Math.min(c.nTiles - 1, Math.max(0.0, (x + 0.5) / c.B - 0.5));
    const fy = Math.min(c.nTiles - 1, Math.max(0.0, (y + 0.5) / c.B - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(c.nTiles - 1, x0 + 1);
    const y1 = Math.min(c.nTiles - 1, y0 + 1);
    const wx = fx - x0;
    const wy = fy - y0;
    const r00 = c.ratios[y0 * c.nTiles + x0];
    const r10 = c.ratios[y0 * c.nTiles + x1];
    const r01 = c.ratios[y1 * c.nTiles + x0];
    const r11 = c.ratios[y1 * c.nTiles + x1];
    return (1.0 - wx) * ((1.0 - wy) * r00 + wy * r01) + wx * ((1.0 - wy) * r10 + wy * r11);
  }

  /**
   * Unit vector pointing toward the least-crowded neighboring B x B tile when
   * the current tile exceeds carrying capacity.
   */
  getCrowdingEscapeDir(x, y) {
    const c = this._crowding;
    if (!c) return { gx: 0, gy: 0 };
    const tx = Math.min(c.nTiles - 1, Math.max(0, Math.floor(x / c.B)));
    const ty = Math.min(c.nTiles - 1, Math.max(0, Math.floor(y / c.B)));
    const cur = c.ratios[ty * c.nTiles + tx];
    if (cur <= 1.0) return { gx: 0, gy: 0 };
    let bestVal = cur;
    let bestDx = 0;
    let bestDy = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || nx >= c.nTiles || ny < 0 || ny >= c.nTiles) continue;
        const v = c.ratios[ny * c.nTiles + nx];
        if (v < bestVal) {
          bestVal = v;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    const mag = Math.hypot(bestDx, bestDy);
    return mag > 0 ? { gx: bestDx / mag, gy: bestDy / mag } : { gx: 0, gy: 0 };
  }

  step(ambientT = null) {
    const g = this.params.growth || {};
    const m = this.params.maturity || {};
    const mo = this.params.mortality || {};
    const rep = this.params.reproduction || {};
    const fishery = this.params.fishery || {};
    const ibm = this.params.ibm || {};
    const toggles = ibm.toggles || {};
    const K = this.getCarryingCapacity();
    const nMeasured = this.agents.filter((a) => a.alive && isEmpiricallyMeasured(a)).length;

    // 1. Advance pelagic larval cohorts
    const z1Hatch = this.pelagicCohorts.egg * 0.005;
    this.pelagicCohorts.egg = Math.max(0, this.pelagicCohorts.egg - z1Hatch);

    const z1ToZ2 = this.pelagicCohorts.zoea1 * 0.025;
    this.pelagicCohorts.zoea1 = Math.max(0, this.pelagicCohorts.zoea1 * 0.985 + z1Hatch - z1ToZ2);

    const z2ToMeg = this.pelagicCohorts.zoea2 * 0.03;
    this.pelagicCohorts.zoea2 = Math.max(0, this.pelagicCohorts.zoea2 * 0.985 + z1ToZ2 - z2ToMeg);

    const settlement = this.pelagicCohorts.megalopa * 0.04;
    this.pelagicCohorts.megalopa = Math.max(0, this.pelagicCohorts.megalopa * 0.98 + z2ToMeg - settlement);

    const recruits = Math.min(5, Math.floor(settlement * 0.01));
    for (let r = 0; r < recruits; r++) {
      if (this.agents.length < K * 1.5) {
        const { x, y } = this.sampleHabitablePosition();
        const newId = this.agents.length + this.births;
        this.agents.push(createAgent(newId, x, y, this.seed + newId, 4));
        this.births += 1;
      }
    }

    // 2. Iterate over benthic agents
    const survivors = [];
    const dt = this.params.simulation?.dt ?? 1.0;
    const legalThreshold = fishery.legal_size_male ?? fishery.legal_size_mm ?? 95.0;
    const fStart = fishery.fishing_season_start ?? 90;
    const fEnd = fishery.fishing_season_end ?? 150;
    const seasonDays = fStart <= fEnd ? (fEnd - fStart + 1) : ((365 - fStart + 1) + fEnd);
    const annualHarvestRate = fishery.fishing_harvest_rate_annual;
    const fDailyHazard = annualHarvestRate !== undefined
      ? -Math.log(1.0 - Math.min(0.999999, Math.max(0.0, annualHarvestRate))) / Math.max(1, seasonDays)
      : -Math.log(1.0 - Math.min(0.999999, Math.max(0.0, fishery.fishing_probability_daily ?? 0.0)));
    const dayOfYear = (this.day % 365) + 1;
    this.updateEnvironmentalFields(dayOfYear);
    const inSeason = fStart <= fEnd ? (dayOfYear >= fStart && dayOfYear <= fEnd) : (dayOfYear >= fStart || dayOfYear <= fEnd);

    const gsz = this.gridSize;
    const daysPerYear = this.params.simulation?.days_per_year ?? 365.0;
    const maxMovePerYear = this.params.ibm?.max_move_m_per_year ?? this.params.simulation?.max_move_m_per_year ?? 7300.0;
    const unitMeters = Math.max(0.01, Number(this.unitMeters) || this.params.ibm?.unit_meters || 1.0);
    const stepSize = Math.max(0, ((maxMovePerYear / daysPerYear) * dt) / unitMeters);
    const kDenParam = this.params.environment?.benthic_carrying_capacity_density ?? 6000.0;
    this.buildLocalCrowdingGrid(kDenParam, unitMeters);

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive) continue;

      const envAt = this.getEnvAt(a.x, a.y);
      const cellT = ambientT !== null ? ambientT : envAt.temperature;
      const envParams = this.params.environment || {};
      const cellFood = Array.isArray(this.foodAvailability)
        ? (this.foodAvailability[Math.min(this.foodAvailability.length - 1, Math.max(0, Math.round(a.y) * gsz + Math.round(a.x)))] ?? 5.0)
        : (Number(this.foodAvailability) || 1.0) * 5.0;

      // Bioenergetics & degree-day accumulation
      const orgParams = this.params.organism || {};
      a.degree_days = (a.degree_days || 0) + Math.max(0.0, cellT + 1.5) * dt;
      if (toggles.use_energetics !== false && toggles.bioenergetics !== false) {
        const dE = calculateEnergyChange(a, cellT, cellFood, envParams, orgParams);
        a.energy_reserve = (a.energy_reserve ?? 10.0) + dE * dt;
      }

      // Movement and habitat taxis aligned with TethysBio
      // (lethargy gate, 9-point Moore stencil, HSI * Gaussian temp * hyperbolic food, softmax)
      const useEnergetics = toggles.use_energetics !== false && toggles.bioenergetics !== false;
      const lethargic =
        useEnergetics &&
        a.energy_reserve <= 0.0 &&
        Math.random() < (orgParams.energy_deficit_removal_probability ?? 0.75);

      if (toggles.use_movement !== false && stepSize > 0.0 && !lethargic) {
        const deltas = [
          { dx: 0, dy: 0 },
          { dx: stepSize, dy: 0 },
          { dx: -stepSize, dy: 0 },
          { dx: 0, dy: stepSize },
          { dx: 0, dy: -stepSize },
          { dx: stepSize, dy: stepSize },
          { dx: stepSize, dy: -stepSize },
          { dx: -stepSize, dy: stepSize },
          { dx: -stepSize, dy: -stepSize },
        ];

        if (toggles.directed_taxis === false) {
          const valid = [];
          const aquatic = [];
          for (const d of deltas) {
            const nx = Math.max(0, Math.min(gsz - 1, a.x + d.dx));
            const ny = Math.max(0, Math.min(gsz - 1, a.y + d.dy));
            const envCand = this.getEnvAt(nx, ny);
            if (envCand.depth > 0) aquatic.push(d);
            if (envCand.depth >= 20.0 && envCand.hsi > 0.0) valid.push(d);
          }
          const pool = valid.length > 0 ? valid : aquatic;
          if (pool.length > 0) {
            const chosen = pool[Math.floor(Math.random() * pool.length)];
            a.x = Math.max(0, Math.min(gsz - 1, a.x + chosen.dx));
            a.y = Math.max(0, Math.min(gsz - 1, a.y + chosen.dy));
          }
        } else {
          const tOptMove = envParams.habitat_temperature_optimum ?? 2.5;
          const tSigMove = Math.max(0.1, envParams.habitat_temperature_sigma ?? 1.5);
          const tempMaxMove = envParams.temp_pref_max ?? 10.0;
          const foodWeight = envParams.habitat_food_weight ?? 0.5;
          const halfSat = Math.max(1.0e-6, envParams.half_saturation_food ?? 2.0);
          const tau = Math.max(0.01, envParams.movement_softmax_temperature ?? 0.5);
          const crowdExp = envParams.benthic_carrying_capacity_exponent ?? 2.0;
          const curCrowd = this.getLocalCrowding(a.x, a.y);
          const crowdDir = curCrowd > 1.0 ? this.getCrowdingEscapeDir(a.x, a.y) : { gx: 0, gy: 0 };

          const utilities = [];
          const escapeUtilities = [];
          const aquaticCandidates = [];
          let maxU = -Infinity;
          let maxEsc = -Infinity;
          for (const d of deltas) {
            const nx = Math.max(0, Math.min(gsz - 1, a.x + d.dx));
            const ny = Math.max(0, Math.min(gsz - 1, a.y + d.dy));
            const envCand = this.getEnvAt(nx, ny);
            if (envCand.depth <= 0) {
              utilities.push(0.0);
              escapeUtilities.push(0.0);
              continue;
            }
            aquaticCandidates.push(d);
            const sTemp = Math.exp(-((envCand.temperature - tOptMove) ** 2) / (2.0 * tSigMove * tSigMove));
            const candCrowd = this.getLocalCrowding(nx, ny);
            const sCrowd = candCrowd > 1.0 ? 1.0 / (1.0 + Math.pow(candCrowd - 1.0, crowdExp)) : 1.0;
            const dMag = Math.hypot(d.dx, d.dy);
            const crowdBias = (curCrowd > 1.0 && dMag > 0)
              ? 1.0 + 0.35 * ((d.dx * crowdDir.gx + d.dy * crowdDir.gy) / dMag)
              : 1.0;

            let u = 0.0;
            if (envCand.depth >= 20.0 && envCand.hsi > 0.0 && envCand.temperature < tempMaxMove) {
              const candFood = Array.isArray(this.foodAvailability)
                ? (this.foodAvailability[Math.min(this.foodAvailability.length - 1, Math.max(0, Math.round(ny) * gsz + Math.round(nx)))] ?? 5.0)
                : (Number(this.foodAvailability) || 1.0) * 5.0;
              const sFood = candFood / (candFood + halfSat);
              u = envCand.hsi * sTemp * (1.0 + foodWeight * sFood) * sCrowd * crowdBias;
            }
            if (u > maxU) maxU = u;
            utilities.push(u);

            // Continuous escape utility for inhospitable cells (never zero on aquatic cells)
            const depthDeficit = Math.max(0.0, 20.0 - envCand.depth);
            const sDepthEsc = Math.exp(-((depthDeficit / 10.0) ** 2));
            const uEsc = Math.max(1.0e-12, sDepthEsc * sTemp * (0.1 + Math.max(0.0, envCand.hsi)) * sCrowd * crowdBias);
            if (uEsc > maxEsc) maxEsc = uEsc;
            escapeUtilities.push(uEsc);
          }

          let chosen = deltas[0];
          if (maxU > 0.0) {
            const weights = utilities.map((u) => (u > 0.0 ? Math.exp((u - maxU) / tau) : 0.0));
            const wSum = weights.reduce((acc, w) => acc + w, 0.0);
            if (wSum > 0.0) {
              let r = Math.random() * wSum;
              for (let k = 0; k < deltas.length; k++) {
                r -= weights[k];
                if (r <= 0.0) {
                  chosen = deltas[k];
                  break;
                }
              }
            }
          } else if (aquaticCandidates.length > 0) {
            // Inhospitable escape: probe 8 compass directions at longer range if local gradient is flat
            const probeRadii = [Math.max(stepSize * 3.0, gsz * 0.05), Math.max(stepSize * 8.0, gsz * 0.15)];
            let bestProbeScore = -Infinity;
            let bestProbeDir = null;
            for (const rad of probeRadii) {
              for (let angIdx = 0; angIdx < 8; angIdx++) {
                const ang = (angIdx * Math.PI) / 4.0;
                const ux = Math.cos(ang);
                const uy = Math.sin(ang);
                const px = Math.max(0, Math.min(gsz - 1, a.x + rad * ux));
                const py = Math.max(0, Math.min(gsz - 1, a.y + rad * uy));
                const envP = this.getEnvAt(px, py);
                if (envP.depth <= 0) continue;
                const sTempP = Math.exp(-((envP.temperature - tOptMove) ** 2) / (2.0 * tSigMove * tSigMove));
                const sDepthP = Math.exp(-((Math.max(0.0, 20.0 - envP.depth) / 10.0) ** 2));
                const hospBonus = (envP.depth >= 20.0 && envP.hsi > 0.0 && envP.temperature < tempMaxMove) ? 2.0 : 0.0;
                const score = hospBonus + sDepthP * sTempP * (0.1 + Math.max(0.0, envP.hsi));
                if (score > bestProbeScore) {
                  bestProbeScore = score;
                  bestProbeDir = { ux, uy };
                }
              }
            }
            const escWeights = deltas.map((d, idx) => {
              const uEsc = escapeUtilities[idx];
              if (uEsc <= 0.0) return 0.0;
              const dMag = Math.hypot(d.dx, d.dy);
              const dirBonus = (bestProbeDir && dMag > 0)
                ? 0.5 * ((d.dx * bestProbeDir.ux + d.dy * bestProbeDir.uy) / dMag)
                : 0.0;
              return Math.exp(((uEsc - maxEsc) + dirBonus) / tau);
            });
            const ewSum = escWeights.reduce((acc, w) => acc + w, 0.0);
            if (ewSum > 0.0) {
              let r = Math.random() * ewSum;
              for (let k = 0; k < deltas.length; k++) {
                r -= escWeights[k];
                if (r <= 0.0) {
                  chosen = deltas[k];
                  break;
                }
              }
            } else {
              chosen = aquaticCandidates[Math.floor(Math.random() * aquaticCandidates.length)];
            }
          }
          a.x = Math.max(0, Math.min(gsz - 1, a.x + chosen.dx));
          a.y = Math.max(0, Math.min(gsz - 1, a.y + chosen.dy));
        }
      }

      // Ecdysis-linked growth and terminal molt (TethysBio-aligned gating and hazard)
      if (toggles.molting !== false && !a.mature) {
        const moltProb = moltProbability(a, cellT, this.day, this.params, dt);
        if (Math.random() < moltProb) {
          const maxStage = a.sex === 'male'
            ? (orgParams.max_stage_male ?? 19)
            : (orgParams.max_stage_female ?? 16);
          const nextStage = Math.min(maxStage, a.stage + 1);
          const probMat = maturityProbability(a, cellT, m);
          const isMaturing = Math.random() < probMat || nextStage >= maxStage;
          const condition = moltConditionFactor(a, orgParams, toggles);
          const prevCw = a.cw;
          const prevMassG = biomassKg(a) * 1000.0;
          let targetCw = growthIncrement(a, cellT, g, isMaturing, condition);

          const computeMassG = (cwVal, matFlag) => {
            const c = Math.max(1.0, cwVal);
            if (a.sex === 'male') {
              const alpha = matFlag ? 0.0002665 : 0.000183;
              const beta = matFlag ? 3.098 : 3.16;
              return alpha * (c ** beta);
            }
            const alpha = matFlag ? 0.00045 : 0.000344;
            const beta = matFlag ? 2.92 : 2.98;
            return alpha * (c ** beta);
          };

          const matAfter = a.mature || isMaturing;
          let targetMassG = computeMassG(targetCw, matAfter);
          let deltaMassG = Math.max(0.0, targetMassG - prevMassG);
          const preReserve = a.energy_reserve ?? 0.0;
          const energeticsOn = toggles.use_energetics !== false && toggles.bioenergetics !== false;
          if (energeticsOn && deltaMassG > 0.0 && preReserve < deltaMassG) {
            const availMassG = prevMassG + Math.max(0.0, preReserve);
            const betaApprox = a.sex === 'female' ? 2.95 : 3.12;
            const scaledCw = targetCw * Math.pow(availMassG / Math.max(targetMassG, 1.0e-9), 1.0 / betaApprox);
            const minExp = isMaturing ? (g.growth_min_expansion_mature ?? 0.06) : (g.growth_min_expansion_immature ?? 0.12);
            targetCw = Math.max(prevCw * (1.0 + minExp), Math.min(targetCw, scaledCw));
            targetMassG = computeMassG(targetCw, matAfter);
            deltaMassG = Math.max(0.0, targetMassG - prevMassG);
          }

          a.cw = targetCw;
          a.stage = nextStage;
          a.last_molt_day = this.day;
          a.degree_days = 0.0;
          if (energeticsOn) {
            const overheadCap = preReserve * (orgParams.molt_energy_retention ?? 0.1);
            a.energy_reserve = Math.max(0.0, Math.min(overheadCap, preReserve - deltaMassG));
          }
          if (isMaturing) {
            a.mature = true;
            a.shell_age = 0;
          }
        }
      }
      if (a.mature) a.shell_age += dt;

      // Natural mortality (including localized B x B crowding feedback)
      const localCrowd = this.getLocalCrowding(a.x, a.y);
      const haz = mortalityHazards(a, nMeasured, K, cellT, mo, toggles, dt, this.day, localCrowd);
      if (Math.random() < haz) {
        this.decrementLocalCrowding(a);
        a.alive = false;
        this.deaths += 1;
        continue;
      }

      // Commercial fishery harvest (size-based legal male, selectivity, dt-scaled, outside MPAs)
      const inReserve = isInExclusionZones(a.x, a.y, this.exclusionBoxes);
      if (
        fDailyHazard > 0 &&
        inSeason &&
        !inReserve &&
        a.sex === 'male' &&
        a.cw >= legalThreshold &&
        a.cw >= 68.0
      ) {
        const sel = 1.0 / (1.0 + Math.exp(-(a.cw - legalThreshold) / 5.0));
        const pHarvest = 1.0 - Math.exp(-fDailyHazard * sel * dt);
        if (Math.random() < pHarvest) {
          this.decrementLocalCrowding(a);
          a.fishery_removed = true;
          a.alive = false;
          this.catchTotal += 1;
          this.catchLegal += 1;
          this.catchBiomassKg = (this.catchBiomassKg || 0) + biomassKg(a);
          this.deaths += 1;
          continue;
        }
      }

      // Female egg extrusion
      if (toggles.reproduction !== false && toggles.use_reproduction !== false && a.sex === 'female' && a.mature) {
        if (this.day % 365 === 60) {
          a.eggs = fecundity(a, rep);
          this.pelagicCohorts.egg += a.eggs;
        }
      }

      survivors.push(a);
    }

    this.agents = survivors;
    this.day += 1;
    this.record();
  }

  run(days = 10, ambientT = null) {
    const numDays = Math.max(1, Math.round(days));
    for (let d = 0; d < numDays; d++) {
      this.step(ambientT);
    }
    return this.history;
  }

  record() {
    const alive = this.agents.filter((a) => a.alive);
    const males = alive.filter((a) => a.sex === 'male');
    const females = alive.filter((a) => a.sex === 'female');
    const legalMales = males.filter(
      (a) => a.mature && a.cw >= (this.params.fishery?.legal_size_male ?? 95.0),
    );
    const matureFemales = females.filter((a) => a.mature);
    const matureMales = males.filter((a) => a.mature);

    this.stageCounts = new Array(20).fill(0);
    this.stageCounts[0] = Math.round(this.pelagicCohorts.egg);
    this.stageCounts[1] = Math.round(this.pelagicCohorts.zoea1);
    this.stageCounts[2] = Math.round(this.pelagicCohorts.zoea2);
    this.stageCounts[3] = Math.round(this.pelagicCohorts.megalopa);

    for (let i = 0; i < alive.length; i++) {
      const st = Math.min(19, Math.max(4, alive[i].stage || 4));
      this.stageCounts[st] += 1;
    }

    const meanCW = alive.length
      ? alive.reduce((s, a) => s + a.cw, 0) / alive.length
      : 0.0;
    const legalBiomassKg = legalMales.reduce((sum, a) => sum + biomassKg(a), 0.0);
    const totalBiomassKg = alive.reduce((sum, a) => sum + biomassKg(a), 0.0);

    const recordPoint = {
      day: this.day,
      total: alive.length,
      males: males.length,
      females: females.length,
      legal: legalMales.length,
      catch_total: this.catchTotal,
      catch_legal: this.catchLegal,
      mean_cw: meanCW,
      mature_females: matureFemales.length,
      mature_males: matureMales.length,
      legal_biomass_kg: legalBiomassKg,
      total_biomass_kg: totalBiomassKg,
      stage_counts: [...this.stageCounts],
      births: this.births,
      deaths: this.deaths,
    };
    this.history.push(recordPoint);

    if (this.day > 0 && this.day % 365 === 0) {
      const year = Math.round(this.day / 365);
      const prevBirths = this.annual.length ? (this.annual[this.annual.length - 1].cumulative_births || 0) : 0;
      const recruits = Math.max(0, this.births - prevBirths);
      const spawners = matureFemales.length;
      const prevCatchKg = this.annual.length ? (this.annual[this.annual.length - 1].cumulative_catch_kg || 0) : 0;
      const totalCatchKg = this.catchBiomassKg || 0;
      const annualCatchKg = Math.max(0, totalCatchKg - prevCatchKg);
      const availLegalBiomassKg = legalBiomassKg + annualCatchKg;

      this.annual.push({
        year,
        day: this.day,
        biomass_kg: totalBiomassKg,
        legal_biomass_kg: legalBiomassKg,
        annual_catch_kg: annualCatchKg,
        cumulative_catch: this.catchTotal,
        cumulative_catch_kg: totalCatchKg,
        cumulative_births: this.births,
        spawners,
        recruits,
        mean_cw: meanCW,
        f_rate: availLegalBiomassKg > 0 ? annualCatchKg / availLegalBiomassKg : 0.0,
      });
    }
  }

  summary() {
    const last = this.history[this.history.length - 1] || {};
    return {
      day: this.day,
      total: last.total || 0,
      males: last.males || 0,
      females: last.females || 0,
      legal: last.legal || 0,
      catch_total: this.catchTotal,
      catch_legal: this.catchLegal,
      mean_cw: last.mean_cw || 0,
      legal_biomass_kg: last.legal_biomass_kg || 0,
      total_biomass_kg: last.total_biomass_kg || 0,
    };
  }
}
