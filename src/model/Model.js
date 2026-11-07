import { createAgent, growthIncrement, maturityProbability, mortalityHazards, fecundity } from './Agent.js';

export class Model {
  constructor(params = {}) {
    this.params = params;
    this.aoi = { longitude: -60, latitude: 45, depth: 150 };
    this.setAOI(this.aoi);
    const ibm = params.ibm || {};
    this.gridSize = ibm.grid_size || 100;
    this.K = ibm.benthic_carrying_capacity || 10000;
    this.tempRef = ibm.temp_ref || 10;
    this.seed = ibm.seed || 1234;
    this.day = 0;
    this.agents = [];
    this.grid = new Array(this.gridSize * this.gridSize).fill(0);
    this.history = [];
    this.catchTotal = 0;
    this.catchLegal = 0;
    this.births = 0;
    this.deaths = 0;
  }

  setAOI(aoi) {
    this.aoi = { ...this.aoi, ...aoi };
    const depth = Number(this.aoi.depth);
    const latitude = Number(this.aoi.latitude);
    this.depth = depth;
    this.temperature =
      2 +
      2.5 * Math.exp(-(((depth - 150) / 60) ** 2)) +
      0.3 * (45 - latitude);
  }

  initialize(nAgents = 2000) {
    this.agents = [];
    this.catchTotal = 0;
    this.catchLegal = 0;
    this.births = 0;
    this.deaths = 0;
    this.day = 0;
    this.grid.fill(0);
    let placed = 0;
    while (placed < nAgents) {
      const x = Math.floor(Math.random() * this.gridSize);
      const y = Math.floor(Math.random() * this.gridSize);
      const idx = y * this.gridSize + x;
      if (this.grid[idx] < 5) {
        this.agents.push(createAgent(this.agents.length + placed, x, y, this.seed + placed));
        this.grid[idx] += 1;
        placed += 1;
      }
    }
    this.record();
  }

  step(T = 10) {
    const g = this.params.growth || {};
    const m = this.params.maturity || {};
    const mo = this.params.mortality || {};
    const rep = this.params.reproduction || {};
    const fishery = this.params.fishery || {};
    const ibm = this.params.ibm || {};
    const toggles = ibm.toggles || {};
    const K = this.K;
    const N = this.agents.filter(a => a.alive).length;

    const survivors = [];
    for (const a of this.agents) {
      if (!a.alive) continue;
      // movement
      const dx = Math.random() < 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const dy = Math.random() < 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      a.x = Math.min(Math.max(0, a.x + dx), this.gridSize - 1);
      a.y = Math.min(Math.max(0, a.y + dy), this.gridSize - 1);

      // growth / molting
      if (toggles.molting && !a.mature) {
        const nextCW = growthIncrement(a, T, g);
        a.cw = nextCW;
        // maturity check
        if (!a.mature && Math.random() < maturityProbability(a, T, m)) {
          a.mature = true;
          a.shell_age = 0;
        }
      }
      if (a.mature) a.shell_age += 1;

      // mortality
      const haz = mortalityHazards(a, N, K, T, mo);
      if (Math.random() < haz) {
        a.alive = false;
        this.deaths += 1;
        continue;
      }

      // fishery harvest (legal males >= size)
      if (
        toggles.bioenergetics !== false &&
        a.sex === 'male' &&
        a.mature &&
        a.cw >= (fishery.legal_size_mm || 95) &&
        Math.random() < (fishery.fishing_probability_daily || 0)
      ) {
        a.fishery_removed = true;
        a.alive = false;
        this.catchTotal += 1;
        this.catchLegal += 1;
        this.deaths += 1;
        continue;
      }

      // reproduction
      if (toggles.reproduction && a.sex === 'female' && a.mature) {
        a.eggs = fecundity(a, rep);
        this.births += Math.round(a.eggs * 0.01); // recruitment proxy
      }

      survivors.push(a);
    }
    this.agents = survivors;
    this.day += 1;
    this.record();
  }

  record() {
    const alive = this.agents.filter(a => a.alive);
    const males = alive.filter(a => a.sex === 'male');
    const females = alive.filter(a => a.sex === 'female');
    const legal = males.filter(a => a.mature && a.cw >= (this.params.fishery.legal_size_mm || 95));
    const meanCW = alive.length ? alive.reduce((s, a) => s + a.cw, 0) / alive.length : 0;
    const matureFemales = females.filter(a => a.mature);
    const matureMales = males.filter(a => a.mature);
    const juvenileCount = alive.length - matureFemales.length - matureMales.length;
    const biomassIndex = alive.reduce((sum, a) => sum + Math.pow(a.cw, 3), 0);
    this.history.push({
      day: this.day,
      total: alive.length,
      males: males.length,
      females: females.length,
      legal: legal.length,
      catch_total: this.catchTotal,
      catch_legal: this.catchLegal,
      mean_cw: meanCW,
      mature_females: matureFemales.length,
      mature_males: matureMales.length,
      recruits: juvenileCount,
      biomass_index: biomassIndex,
      births: this.births,
      deaths: this.deaths,
    });
  }

  run(days, T = 10, onStep) {
    for (let i = 0; i < days; i++) {
      this.step(T);
      if (onStep) onStep(this.day, this.history[this.history.length - 1]);
    }
    return this.history;
  }

  summary() {
    const last = this.history[this.history.length - 1] || {};
    return last;
  }
}
