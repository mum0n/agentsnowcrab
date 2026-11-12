import { create } from 'zustand';
import { DEFAULTS } from '../config/parameters.js';
import { Model, scotianShelfDepth } from '../model/Model.js';
import { loadConfig } from '../config/snowcrab.js';

let timerId = null;

export const useStore = create((set, get) => ({
  params: DEFAULTS,
  configName: 'snowcrab',
  aoi: { longitude: -59.0, latitude: 45.0, depth: 135.0 },
  model: null,
  history: [],
  annual: [],
  stageCounts: new Array(20).fill(0),
  exclusionBoxes: [],
  running: false,
  status: 'Ready — day 0 of 730',
  day: 0,
  stepDays: 10,
  durationYears: 2,
  rewindDays: 10,
  horizonDays: 730,
  backgroundLayer: 'depth',

  total: 0,
  males: 0,
  females: 0,
  legal: 0,
  catchTotal: 0,
  catchLegal: 0,
  meanCw: 0,
  legalBiomass: 0,
  totalBiomass: 0,

  setAOI: (aoiUpdate) => {
    const prev = get().aoi;
    const nextAOI = { ...prev, ...aoiUpdate };
    if (!nextAOI.depth) {
      nextAOI.depth = scotianShelfDepth(nextAOI.longitude, nextAOI.latitude);
    }
    const { model } = get();
    if (model) {
      model.setAOI(nextAOI);
    }
    set({
      aoi: nextAOI,
      model,
      status: `AOI updated: ${nextAOI.latitude.toFixed(2)}°N, ${Math.abs(nextAOI.longitude).toFixed(2)}°W; model will reset on next transport update.`,
    });
  },

  setExclusionBox: (box) => {
    const { model } = get();
    if (box.clear || !box.active) {
      if (model) model.clearExclusionBoxes();
      set({ exclusionBoxes: [], status: 'Exclusion area cleared.' });
      return;
    }
    const b = { id: 1, name: 'MPA-Custom', active: true, ...box };
    if (model) model.setExclusionBox(b);
    set({
      exclusionBoxes: [b],
      status: `Exclusion area set: X [${Math.round(b.xmin)}–${Math.round(b.xmax)}], Y [${Math.round(b.ymin)}–${Math.round(b.ymax)}]`,
    });
  },

  clearExclusionBoxes: () => {
    const { model } = get();
    if (model) model.clearExclusionBoxes();
    set({ exclusionBoxes: [], status: 'Exclusion area cleared.' });
  },

  setBackgroundLayer: (layer) => {
    const { model, params } = get();
    const nextParams = JSON.parse(JSON.stringify(params));
    nextParams.ibm.background_layer = layer;
    if (model) model.backgroundLayer = layer;
    set({ backgroundLayer: layer, params: nextParams });
  },

  updateParam: (path, value) => {
    const { params, model } = get();
    const next = JSON.parse(JSON.stringify(params));
    const parts = path.split('.');
    let obj = next;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;

    if (model) {
      if (path === 'ibm.grid_size') model.gridSize = value;
      if (path === 'ibm.unit_meters') model.unitMeters = value;
      if (path === 'environment.temp_offset' || path === 'ibm.temp_offset') {
        model.tempOffset = value;
        model.buildEnvironmentalGrid();
      }
      if (path === 'environment.temp_multiplier' || path === 'ibm.temp_multiplier') {
        model.tempMultiplier = value;
        model.buildEnvironmentalGrid();
      }
      if (path === 'environment.habitat_offset' || path === 'ibm.habitat_offset') {
        model.habitatOffset = value;
        model.buildEnvironmentalGrid();
      }
      if (path === 'environment.habitat_multiplier' || path === 'ibm.habitat_multiplier') {
        model.habitatMultiplier = value;
        model.buildEnvironmentalGrid();
      }
      if (path === 'environment.food_availability' || path === 'ibm.food_availability') {
        model.foodAvailability = value;
      }
      if (path === 'environment.benthic_carrying_capacity_density' || path === 'ibm.benthic_carrying_capacity_density') {
        model.benthicCarryingCapacityDensity = value;
      }
    }

    set({ params: next });
  },

  setStepDays: (days) => set({ stepDays: Math.max(1, parseInt(days) || 10) }),
  setDurationYears: (years) => {
    const y = Math.max(1, parseInt(years) || 2);
    set({ durationYears: y, horizonDays: y * 365 });
  },
  setRewindDays: (days) => set({ rewindDays: Math.max(1, parseInt(days) || 10) }),

  initialize: (nAgents = 120) => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    const { params, aoi, exclusionBoxes, durationYears } = get();
    const model = new Model(params);
    model.setAOI(aoi);
    if (exclusionBoxes && exclusionBoxes.length > 0) {
      model.setExclusionBox(exclusionBoxes[0]);
    }
    model.initialize(nAgents || 120);
    const summary = model.summary();
    const hDays = durationYears * 365;

    set({
      model,
      history: [...model.history],
      annual: [...model.annual],
      stageCounts: [...model.stageCounts],
      status: `Ready — day 0 of ${hDays}`,
      day: 0,
      running: false,
      horizonDays: hDays,
      total: summary.total || 0,
      males: summary.males || 0,
      females: summary.females || 0,
      legal: summary.legal || 0,
      catchTotal: summary.catch_total || 0,
      catchLegal: summary.catch_legal || 0,
      meanCw: summary.mean_cw || 0,
      legalBiomass: summary.legal_biomass_kg || 0,
      totalBiomass: summary.total_biomass_kg || 0,
    });
  },

  step: (customDays = null) => {
    let { model, stepDays, horizonDays, day } = get();
    if (!model) {
      get().initialize();
      model = get().model;
    }
    const advanceBy = customDays !== null ? customDays : stepDays;
    const targetDay = Math.min(horizonDays, day + advanceBy);
    const needed = targetDay - day;
    if (needed > 0) {
      model.run(needed);
    }
    const s = model.summary();
    set({
      model,
      history: [...model.history],
      annual: [...model.annual],
      stageCounts: [...model.stageCounts],
      day: model.day,
      total: s.total || 0,
      males: s.males || 0,
      females: s.females || 0,
      legal: s.legal || 0,
      catchTotal: s.catch_total || 0,
      catchLegal: s.catch_legal || 0,
      meanCw: s.mean_cw || 0,
      legalBiomass: s.legal_biomass_kg || 0,
      totalBiomass: s.total_biomass_kg || 0,
      status: `Simulation running — day ${model.day} of ${horizonDays}`,
    });
  },

  start: () => {
    if (timerId) clearInterval(timerId);
    set({ running: true });

    timerId = setInterval(() => {
      const { day, horizonDays, step } = get();
      if (day >= horizonDays) {
        clearInterval(timerId);
        timerId = null;
        set({ running: false, status: `Simulation completed — day ${day} of ${horizonDays}` });
        return;
      }
      step();
    }, 400);
  },

  pause: () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    const { day, horizonDays } = get();
    set({ running: false, status: `Simulation paused — day ${day} of ${horizonDays}` });
  },

  stop: () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    get().initialize();
  },

  rewind: (days = null) => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    const { rewindDays, day, horizonDays } = get();
    const rDays = days !== null ? days : rewindDays;
    const targetDay = Math.max(0, day - rDays);
    get().initialize();
    if (targetDay > 0) {
      get().model.run(targetDay);
      const s = get().model.summary();
      set({
        history: [...get().model.history],
        annual: [...get().model.annual],
        stageCounts: [...get().model.stageCounts],
        day: targetDay,
        total: s.total || 0,
        males: s.males || 0,
        females: s.females || 0,
        legal: s.legal || 0,
        catchTotal: s.catch_total || 0,
        catchLegal: s.catch_legal || 0,
        meanCw: s.mean_cw || 0,
        legalBiomass: s.legal_biomass_kg || 0,
        totalBiomass: s.total_biomass_kg || 0,
        status: `Simulation rewound — day ${targetDay} of ${horizonDays}`,
      });
    }
  },
}));
