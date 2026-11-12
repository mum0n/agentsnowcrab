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

export const scotianShelfDepth = (lon, lat) => {
  const g = SCOTIAN_SHELF_GEO;
  if (g && g.z && g.nx && g.ny) {
    const u = ((lon - g.lonMin) / (g.lonMax - g.lonMin)) * (g.nx - 1);
    const v = ((lat - g.latMin) / (g.latMax - g.latMin)) * (g.ny - 1);
    const i0 = Math.max(0, Math.min(g.nx - 2, Math.floor(u)));
    const j0 = Math.max(0, Math.min(g.ny - 2, Math.floor(v)));
    const du = Math.max(0.0, Math.min(1.0, u - i0));
    const dv = Math.max(0.0, Math.min(1.0, v - j0));
    const z00 = g.z[j0 * g.nx + i0];
    const z10 = g.z[j0 * g.nx + i0 + 1];
    const z01 = g.z[(j0 + 1) * g.nx + i0];
    const z11 = g.z[(j0 + 1) * g.nx + i0 + 1];
    const zInterp = (1 - du) * (1 - dv) * z00 + du * (1 - dv) * z10 + (1 - du) * dv * z01 + du * dv * z11;
    return Math.round(Math.max(10.0, zInterp));
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

    this.sampleResolution = 50;
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
      const lat = baseLat + v * 0.05;
      for (let i = 0; i < nr; i++) {
        const u = (i - nr / 2) / (nr / 2);
        const dist = Math.sqrt(u * u + v * v);
        const z = Math.max(10.0, centerDepth + 40.0 * (dist - 0.5) + 8.0 * Math.sin(u * 3.5));
        const t = bottomTemperature(z, lat, this.tempOffset);
        let s = habitatSuitability(t, z);
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
      temperature: tempGrid,
      hsi: hsiGrid,
    };
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
    const legalThreshold = fishery.legal_size_male ?? fishery.legal_size_mm ?? 95.0;
    const fishProbDaily = fishery.fishing_probability_daily ?? 0.002;
    const dayOfYear = (this.day % 365) + 1;
    const inSeason = dayOfYear >= (fishery.fishing_season_start ?? 90) && dayOfYear <= (fishery.fishing_season_end ?? 150);

    const gsz = this.gridSize;
    const stepSize = Math.max(1, Math.round(gsz * 0.02));

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive) continue;

      const envAt = this.getEnvAt(a.x, a.y);
      const cellT = ambientT !== null ? ambientT : envAt.temperature;

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

      // Molting and growth increments
      if (toggles.molting !== false && !a.mature) {
        const moltProb = a.stage <= 6 ? 0.015 : a.stage <= 9 ? 0.008 : 0.004;
        if (Math.random() < moltProb) {
          a.cw = growthIncrement(a, cellT, g);
          if (a.sex === 'male') {
            a.stage = Math.min(19, a.stage + 1);
          } else {
            a.stage = Math.min(16, a.stage + 1);
          }

          if (!a.mature && Math.random() < maturityProbability(a, cellT, m)) {
            a.mature = true;
            a.shell_age = 0;
          }
        }
      }
      if (a.mature) a.shell_age += 1;

      // Natural mortality
      const haz = mortalityHazards(a, nMeasured, K, cellT, mo, toggles);
      if (Math.random() < haz) {
        a.alive = false;
        this.deaths += 1;
        continue;
      }

      // Commercial fishery harvest (strictly excluded inside active ExclusionBox MPAs)
      const inReserve = isInExclusionZones(a.x, a.y, this.exclusionBoxes);
      if (
        inSeason &&
        !inReserve &&
        a.sex === 'male' &&
        a.mature &&
        a.cw >= legalThreshold &&
        Math.random() < fishProbDaily
      ) {
        a.fishery_removed = true;
        a.alive = false;
        this.catchTotal += 1;
        this.catchLegal += 1;
        this.deaths += 1;
        continue;
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
      const recruits = this.stageCounts[13] || 1;
      const spawners = Math.max(1, Math.round(this.pelagicCohorts.egg / 2));
      const annualCatch = this.catchTotal - (this.annual.length ? this.annual[this.annual.length - 1].cumulative_catch : 0);

      this.annual.push({
        year,
        day: this.day,
        biomass_kg: totalBiomassKg,
        legal_biomass_kg: legalBiomassKg,
        annual_catch_kg: annualCatch * 0.45,
        cumulative_catch: this.catchTotal,
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
