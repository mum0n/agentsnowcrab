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
    return Math.max(10.0, zInterp);
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
        const x = Math.floor(Math.random() * this.gridSize);
        const y = Math.floor(Math.random() * this.gridSize);
        const agent = createAgent(created, x, y, this.seed + created, stageId, sex);
        this.agents.push(agent);
        created += 1;
      }
    }

    this.record();
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
        const x = Math.floor(Math.random() * this.gridSize);
        const y = Math.floor(Math.random() * this.gridSize);
        const newId = this.agents.length + this.births;
        this.agents.push(createAgent(newId, x, y, this.seed + newId, 4));
        this.births += 1;
      }
    }

    // 2. Iterate over benthic agents
    const survivors = [];
    const dt = this.params.simulation?.dt ?? 1.0;
    const legalThreshold = fishery.legal_size_male ?? fishery.legal_size_mm ?? 95.0;
    const fishProbDaily = fishery.fishing_probability_daily ?? 0.0;
    const fStart = fishery.fishing_season_start ?? 90;
    const fEnd = fishery.fishing_season_end ?? 150;
    const dayOfYear = (this.day % 365) + 1;
    this.updateEnvironmentalFields(dayOfYear);
    const inSeason = fStart <= fEnd ? (dayOfYear >= fStart && dayOfYear <= fEnd) : (dayOfYear >= fStart || dayOfYear <= fEnd);

    const gsz = this.gridSize;
    const daysPerYear = this.params.simulation?.days_per_year ?? 365.0;
    const maxMovePerYear = this.params.ibm?.max_move_m_per_year ?? this.params.simulation?.max_move_m_per_year ?? 7300.0;
    const unitMeters = Math.max(0.01, Number(this.unitMeters) || this.params.ibm?.unit_meters || 1.0);
    const stepSize = Math.max(0, ((maxMovePerYear / daysPerYear) * dt) / unitMeters);

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
      a.degree_days = (a.degree_days || 0) + Math.max(0.0, cellT + 1.5) * dt;
      if (toggles.use_energetics !== false) {
        const dE = calculateEnergyChange(a, cellT, cellFood, envParams);
        a.energy_reserve = (a.energy_reserve ?? 10.0) + dE * dt;
      }

      // Directed movement taxis toward cold, food-rich / high HSI cells
      if (toggles.directed_taxis !== false && toggles.use_movement !== false) {
        const deltas = [
          { dx: 0, dy: 0 },
          { dx: stepSize, dy: 0 },
          { dx: -stepSize, dy: 0 },
          { dx: 0, dy: stepSize },
          { dx: 0, dy: -stepSize },
        ];
        let bestHsi = -1;
        let chosen = deltas[0];
        for (const d of deltas) {
          const nx = Math.max(0, Math.min(gsz - 1, a.x + d.dx));
          const ny = Math.max(0, Math.min(gsz - 1, a.y + d.dy));
          const h = this.getEnvAt(nx, ny).hsi + (Math.random() - 0.5) * 0.15;
          if (h > bestHsi) {
            bestHsi = h;
            chosen = d;
          }
        }
        a.x = Math.max(0, Math.min(gsz - 1, a.x + chosen.dx));
        a.y = Math.max(0, Math.min(gsz - 1, a.y + chosen.dy));
      }

      // Ecdysis-linked growth and terminal molt
      if (toggles.molting !== false && !a.mature) {
        const moltProb = a.stage <= 6 ? 0.015 : a.stage <= 9 ? 0.008 : 0.004;
        if (Math.random() < moltProb) {
          const maxStage = a.sex === 'male' ? 19 : 16;
          const nextStage = Math.min(maxStage, a.stage + 1);
          const probMat = maturityProbability(a, cellT, m);
          const isMaturing = Math.random() < probMat || nextStage >= maxStage;
          a.cw = growthIncrement(a, cellT, g, isMaturing);
          a.stage = nextStage;
          if (isMaturing) {
            a.mature = true;
            a.shell_age = 0;
          }
        }
      }
      if (a.mature) a.shell_age += dt;

      // Natural mortality
      const haz = mortalityHazards(a, nMeasured, K, cellT, mo, toggles, dt);
      if (Math.random() < haz) {
        a.alive = false;
        this.deaths += 1;
        continue;
      }

      // Commercial fishery harvest (size-based legal male, selectivity, dt-scaled, outside MPAs)
      const inReserve = isInExclusionZones(a.x, a.y, this.exclusionBoxes);
      if (
        fishProbDaily > 0 &&
        inSeason &&
        !inReserve &&
        a.sex === 'male' &&
        a.cw >= legalThreshold &&
        a.cw >= 68.0
      ) {
        const sel = 1.0 / (1.0 + Math.exp(-(a.cw - legalThreshold) / 5.0));
        const pDaily = Math.min(0.999999, fishProbDaily * sel);
        const pHarvest = -Math.expm1(dt * Math.log1p(-pDaily));
        if (Math.random() < pHarvest) {
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
      const annualCatch = this.catchTotal - (this.annual.length ? this.annual[this.annual.length - 1].cumulative_catch : 0);

      this.annual.push({
        year,
        day: this.day,
        biomass_kg: totalBiomassKg,
        legal_biomass_kg: legalBiomassKg,
        annual_catch_kg: annualCatch * 0.45,
        cumulative_catch: this.catchTotal,
        cumulative_births: this.births,
        spawners,
        recruits,
        mean_cw: meanCW,
        f_rate: legalBiomassKg > 0 ? Math.min(0.9, (annualCatch * 0.45) / legalBiomassKg) : 0.0,
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
