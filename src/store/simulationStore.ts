import { create } from 'zustand';
import { produce } from 'immer';
import { Params, DEFAULTS, validateParams, mergeParams } from '../config/schema.ts';
import { Model, scotianShelfDepth } from '../model/Model.js';
import { ExclusionBox } from '../model/Analytics.js';

interface SimulationState {
  params: Params;
  aoi: { longitude: number; latitude: number; depth: number };
  model: Model | null;
  history: Array<Record<string, unknown>>;
  annual: Array<Record<string, unknown>>;
  stageCounts: number[];
  exclusionBoxes: ExclusionBox[];
  running: boolean;
  status: string;
  day: number;
  horizonDays: number;
  backgroundLayer: 'depth' | 'temperature' | 'habitat_quality';

  total: number;
  males: number;
  females: number;
  legal: number;
  catchTotal: number;
  catchLegal: number;
  meanCw: number;
  legalBiomass: number;
  totalBiomass: number;

  initialize: (nAgents?: number) => void;
  step: (customDays?: number) => void;
  run: (days: number) => void;
  pause: () => void;
  stop: () => void;
  rewind: (days?: number) => void;
  setParams: (patch: Partial<typeof DEFAULTS>) => void;
  setAOI: (aoiUpdate: Partial<{ longitude: number; latitude: number; depth: number }>) => void;
  setExclusionBox: (box: Partial<ExclusionBox> | { clear: true }) => void;
  clearExclusionBoxes: () => void;
  setBackgroundLayer: (layer: 'depth' | 'temperature' | 'habitat_quality') => void;
  syncFromModel: () => void;
  reset: () => void;
}

const initialState = {
  params: DEFAULTS,
  aoi: { longitude: -59.0, latitude: 45.0, depth: 135.0 },
  model: null,
  history: [],
  annual: [],
  stageCounts: new Array(20).fill(0),
  exclusionBoxes: [],
  running: false,
  status: 'Ready — day 0 of 730',
  day: 0,
  horizonDays: 730,
  backgroundLayer: 'depth' as const,

  total: 0,
  males: 0,
  females: 0,
  legal: 0,
  catchTotal: 0,
  catchLegal: 0,
  meanCw: 0,
  legalBiomass: 0,
  totalBiomass: 0,
};

export const useSimulationStore = create<SimulationState>()((set, get) => ({
  ...initialState,

  initialize: (nAgents = 120) => {
    const { params, aoi, exclusionBoxes, durationYears } = get();
    const model = new Model(params);
    model.setAOI(aoi);
    if (exclusionBoxes.length > 0) {
      model.setExclusionBox(exclusionBoxes[0]);
    }
    model.initialize(nAgents || params.simulation.n_agents);
    const summary = model.summary();
    const hDays = (params.simulation.sim_years || 2) * 365;

    set(produce((state) => {
      state.model = model;
      state.history = [...model.history];
      state.annual = [...model.annual];
      state.stageCounts = [...model.stageCounts];
      state.status = `Ready — day 0 of ${hDays}`;
      state.day = 0;
      state.running = false;
      state.horizonDays = hDays;
      state.total = summary.total || 0;
      state.males = summary.males || 0;
      state.females = summary.females || 0;
      state.legal = summary.legal || 0;
      state.catchTotal = summary.catch_total || 0;
      state.catchLegal = summary.catch_legal || 0;
      state.meanCw = summary.mean_cw || 0;
      state.legalBiomass = summary.legal_biomass_kg || 0;
      state.totalBiomass = summary.total_biomass_kg || 0;
    }));
  },

  step: (customDays = null) => {
    const { model, stepDays, horizonDays, day } = get();
    if (!model) {
      get().initialize();
      return;
    }
    const advanceBy = customDays !== null ? customDays : stepDays;
    const targetDay = Math.min(horizonDays, day + advanceBy);
    const needed = targetDay - day;
    if (needed > 0) {
      model.run(needed);
    }
    get().syncFromModel();
  },

  run: (days: number) => {
    const { model, horizonDays, day } = get();
    if (!model) {
      get().initialize();
      return;
    }
    const targetDay = Math.min(horizonDays, day + days);
    const needed = targetDay - day;
    if (needed > 0) {
      model.run(needed);
    }
    get().syncFromModel();
  },

  pause: () => {
    set({ running: false, status: `Paused — day ${get().day} of ${get().horizonDays}` });
  },

  stop: () => {
    get().initialize();
  },

  rewind: (days = null) => {
    const { rewindDays, day, horizonDays } = get();
    const rDays = days !== null ? days : rewindDays;
    const targetDay = Math.max(0, day - rDays);
    get().initialize();
    if (targetDay > 0) {
      const { model } = get();
      if (model) {
        model.run(targetDay);
        get().syncFromModel();
        set({ status: `Rewound — day ${targetDay} of ${horizonDays}` });
      }
    }
  },

  setParams: (patch) => {
    const { params, model } = get();
    const nextParams = mergeParams(params, patch);
    set({ params: nextParams });
    if (model) {
      if (patch.simulation?.grid_nx) model.gridSize = patch.simulation.grid_nx;
      if (patch.simulation?.unit_meters) model.unitMeters = patch.simulation.unit_meters;
      if (patch.environment?.temp_offset !== undefined) { model.tempOffset = patch.environment.temp_offset; model.buildEnvironmentalGrid(); }
      if (patch.environment?.temp_multiplier !== undefined) { model.tempMultiplier = patch.environment.temp_multiplier; model.buildEnvironmentalGrid(); }
      if (patch.environment?.habitat_offset !== undefined) { model.habitatOffset = patch.environment.habitat_offset; model.buildEnvironmentalGrid(); }
      if (patch.environment?.habitat_multiplier !== undefined) { model.habitatMultiplier = patch.environment.habitat_multiplier; model.buildEnvironmentalGrid(); }
      if (patch.environment?.food_availability !== undefined) model.foodAvailability = patch.environment.food_availability;
      if (patch.environment?.benthic_carrying_capacity_density !== undefined) model.benthicCarryingCapacityDensity = patch.environment.benthic_carrying_capacity_density;
      if (patch.ibm?.background_layer) model.backgroundLayer = patch.ibm.background_layer;
    }
  },

  setAOI: (aoiUpdate) => {
    const { aoi, model } = get();
    const nextAOI = { ...aoi, ...aoiUpdate };
    if (!nextAOI.depth) {
      nextAOI.depth = scotianShelfDepth(nextAOI.longitude, nextAOI.latitude);
    }
    if (model) model.setAOI(nextAOI);
    set({ aoi: nextAOI, status: `AOI updated: ${nextAOI.latitude.toFixed(2)}°N, ${Math.abs(nextAOI.longitude).toFixed(2)}°W` });
  },

  setExclusionBox: (box) => {
    const { model } = get();
    if (box.clear || !box.active) {
      if (model) model.clearExclusionBoxes();
      set({ exclusionBoxes: [], status: 'Exclusion area cleared.' });
      return;
    }
    const b = new ExclusionBox({ id: 1, name: 'MPA-Custom', ...box, active: true });
    if (model) model.setExclusionBox(b);
    set({ exclusionBoxes: [b], status: `Exclusion area set: X [${Math.round(b.xmin)}–${Math.round(b.xmax)}], Y [${Math.round(b.ymin)}–${Math.round(b.ymax)}]` });
  },

  clearExclusionBoxes: () => {
    const { model } = get();
    if (model) model.clearExclusionBoxes();
    set({ exclusionBoxes: [], status: 'Exclusion area cleared.' });
  },

  setBackgroundLayer: (layer) => {
    const { model, params } = get();
    const nextParams = { ...params, ibm: { ...params.ibm, background_layer: layer } };
    if (model) model.backgroundLayer = layer;
    set({ backgroundLayer: layer, params: nextParams });
  },

  syncFromModel: () => {
    const { model } = get();
    if (!model) return;
    const s = model.summary();
    set(produce((state) => {
      state.model = model;
      state.history = [...model.history];
      state.annual = [...model.annual];
      state.stageCounts = [...model.stageCounts];
      state.day = model.day;
      state.total = s.total || 0;
      state.males = s.males || 0;
      state.females = s.females || 0;
      state.legal = s.legal || 0;
      state.catchTotal = s.catch_total || 0;
      state.catchLegal = s.catch_legal || 0;
      state.meanCw = s.mean_cw || 0;
      state.legalBiomass = s.legal_biomass_kg || 0;
      state.totalBiomass = s.total_biomass_kg || 0;
      state.status = state.running ? `Running — day ${model.day} of ${state.horizonDays}` : `Ready — day ${model.day} of ${state.horizonDays}`;
    }));
  },

  reset: () => set(initialState),
}));

export const useUIStore = create((set) => ({
  activeTab: 1,
  stepDays: 10,
  durationYears: 2,
  rewindDays: 10,
  setActiveTab: (tab: number) => set({ activeTab: tab }),
  setStepDays: (days: number) => set({ stepDays: Math.max(1, days) }),
  setDurationYears: (years: number) => set({ durationYears: Math.max(1, years), horizonDays: Math.max(1, years) * 365 }),
  setRewindDays: (days: number) => set({ rewindDays: Math.max(1, days) }),
}));