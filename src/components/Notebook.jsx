import React, { useState } from 'react';
import { useStore } from '../store/simulationStore.js';

const SCENARIOS = [
  {
    id: 'unfished',
    title: 'Scenario 1: Unfished Ecological Baseline',
    description:
      'Simulate 3 years under zero fishing mortality to observe carrying capacity equilibrium, natural 20-stage cohort distribution, and thermal taxis.',
    config: {
      'fishery.fishing_probability_daily': 0.0,
      'ibm.toggles.directed_taxis': true,
      'ibm.toggles.molting': true,
      'ibm.toggles.reproduction': true,
    },
    days: 1095,
  },
  {
    id: 'heavy_fishing',
    title: 'Scenario 2: Commercial Overharvest (No MPA)',
    description:
      'Impose high commercial fishing mortality (p = 0.012/day) with no marine protected areas, tracking legal male stock collapse and recruitment impairment.',
    config: {
      'fishery.fishing_probability_daily': 0.012,
      'ibm.toggles.directed_taxis': true,
    },
    days: 730,
    mpaActive: false,
  },
  {
    id: 'mpa_spillover',
    title: 'Scenario 3: Offshore Marine Protected Area (Gully MPA)',
    description:
      'Evaluate spatial harvest refuge (ExclusionBox) with active fishing outside. Examines biomass preservation inside the reserve and spillover into adjacent fishing grounds.',
    config: {
      'fishery.fishing_probability_daily': 0.008,
      'ibm.toggles.directed_taxis': true,
    },
    days: 1095,
    mpaActive: true,
  },
];

export default function Notebook() {
  const { updateParam, setExclusionBox, run, initialize, day, status, legalBiomass, catchTotal } =
    useStore();
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS[0].id);
  const [log, setLog] = useState('Select a scenario and click "Execute Scenario" to run.');

  const handleExecute = (sc) => {
    setLog(`Initializing scenario: ${sc.title}...`);
    initialize();

    // Apply scenario parameters
    for (const [key, val] of Object.entries(sc.config)) {
      updateParam(key, val);
    }
    if (sc.mpaActive !== undefined) {
      setExclusionBox({ active: sc.mpaActive });
    }

    setLog((prev) => `${prev}\nRunning ${sc.days} days of demographic simulation...`);
    setTimeout(() => {
      run(sc.days);
      setLog(
        (prev) =>
          `${prev}\nSimulation completed. Day: ${day + sc.days}. Switch to the Dashboard tab to inspect the 8 analytical panels, macro-model fits, and stock-recruitment curves.`,
      );
    }, 50);
  };

  const curr = SCENARIOS.find((s) => s.id === selectedScenario) || SCENARIOS[0];

  return (
    <div className="card">
      <h2>TethysBio Research Notebook &amp; Scenario Calibration</h2>
      <p>
        Interactive scenario runners based on <code>TethysBioNotes.jl</code>.
        Each experiment calibrates demographic rates, environmental forcing, and spatial
        harvest refugia to investigate population dynamics and fishery management policies.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {SCENARIOS.map((sc) => (
          <button
            key={sc.id}
            type="button"
            className={`secondary ${selectedScenario === sc.id ? 'active' : ''}`}
            onClick={() => setSelectedScenario(sc.id)}
          >
            {sc.title.split(':')[0]}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>{curr.title}</h3>
        <p>{curr.description}</p>
        <div style={{ marginBottom: 12 }}>
          <strong>Configured parameters:</strong>
          <pre
            style={{
              background: '#0f172a',
              padding: 8,
              borderRadius: 6,
              color: '#38bdf8',
              fontSize: '0.8rem',
            }}
          >
            {JSON.stringify(curr.config, null, 2)}
          </pre>
        </div>
        <button className="run" onClick={() => handleExecute(curr)}>
          Execute Scenario ({curr.days} Days)
        </button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Execution Diagnostics</h3>
        <textarea
          readOnly
          value={log}
          style={{ width: '100%', height: '140px', fontFamily: 'monospace' }}
        />
        <p style={{ marginTop: 6, fontSize: '0.85rem' }}>
          Current State: Day <strong>{day}</strong> | Legal Biomass:{' '}
          <strong>{legalBiomass.toFixed(1)} kg</strong> | Cumulative Catch:{' '}
          <strong>{catchTotal}</strong>
        </p>
      </div>
    </div>
  );
}
