import { create } from 'zustand';
import { DEFAULTS } from '../config/parameters.js';
import { Model } from '../model/Model.js';
import { loadConfig } from '../config/snowcrab.js';

const initialParams = DEFAULTS;

export const useStore = create((set, get) => ({
  params: initialParams,
  configName: 'default',
  aoi: { longitude: -60, latitude: 45, depth: 150 },
  model: null,
  history: [],
  running: false,
  day: 0,
  total: 0,
  males: 0,
  females: 0,
  legal: 0,
  catchTotal: 0,
  catchLegal: 0,
  meanCw: 0,
  status: 'idle',

  setParams: (params) => set({ params }),
  setAOI: (aoi) => {
    const nextAOI = { ...get().aoi, ...aoi };
    const { model } = get();
    if (model) model.setAOI(nextAOI);
    set({ aoi: nextAOI, model });
  },

  updateParam: (path, value) => {
    const { params } = get();
    const next = JSON.parse(JSON.stringify(params));
    const parts = path.split('.');
    let obj = next;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    set({ params: next });
  },
  setConfig: (name) => {
    const params = loadConfig(name);
    set({ params, configName: name, model: null, history: [], status: 'idle' });
  },

  initialize: (nAgents) => {
    const { params, aoi } = get();
    const model = new Model(params);
    model.setAOI(aoi);
    model.initialize(nAgents || params.ibm.n_agents);
    const summary = model.summary();
    set({
      model,
      history: model.history,
      status: 'ready',
      day: 0,
      running: false,
      total: summary.total || 0,
      males: summary.males || 0,
      females: summary.females || 0,
      legal: summary.legal || 0,
      catchTotal: summary.catch_total || 0,
      catchLegal: summary.catch_legal || 0,
      meanCw: summary.mean_cw || 0,
    });
  },

  step: () => {
    const { model, params } = get();
    if (!model) return;
    const T = model.temperature + (params.ibm.temp_offset || 0);
    model.step(T);
    const s = model.summary();
    set({
      model,
      history: model.history,
      day: model.day,
      total: s.total || 0,
      males: s.males || 0,
      females: s.females || 0,
      legal: s.legal || 0,
      catchTotal: s.catch_total || 0,
      catchLegal: s.catch_legal || 0,
      meanCw: s.mean_cw || 0,
      status: 'running',
    });
  },

  run: (days) => {
    const { model, params } = get();
    if (!model) return [];
    set({ running: true });
    const T = model.temperature + (params.ibm.temp_offset || 0);
    const history = model.run(days, T);
    const s = model.summary();
    set({
      model,
      history,
      running: false,
      day: model.day,
      total: s.total || 0,
      males: s.males || 0,
      females: s.females || 0,
      legal: s.legal || 0,
      catchTotal: s.catch_total || 0,
      catchLegal: s.catch_legal || 0,
      meanCw: s.mean_cw || 0,
      status: 'done',
    });
    return history;
  },

  exportRun: () => {
    const { history, params, configName } = get();
    const blob = new Blob([JSON.stringify({ params, configName, history }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentsnowcrab_run_${configName}_day${history.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importRun: (json) => {
    try {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      set({ params: data.params, configName: data.configName, history: data.history, status: 'done' });
      return true;
    } catch (e) {
      return false;
    }
  },
}));
