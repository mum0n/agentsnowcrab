import React, { useEffect } from 'react';
import { useStore } from '../store/simulationStore.js';
import Plot from 'react-plotly.js';

export default function Simulation() {
  const {
    params,
    configName,
    setConfig,
    model,
    initialize,
    running,
    status,
    day,
    total,
    males,
    females,
    legal,
    catchTotal,
    catchLegal,
    meanCw,
    legalBiomass,
    totalBiomass,
    step,
    history,
    updateParam,
    exportRun,
    importRun,
    stageMultipliers,
    setStageMultipliers,
    cwShift,
    setCwShift,
  } = useStore();

  useEffect(() => {
    if (!model) initialize(params.ibm.n_agents);
  }, [model, initialize, params.ibm.n_agents]);

  const handleRunDays = (days) => step(days);

  const applyPreset = (preset) => {
    if (preset === 'balanced') {
      setStageMultipliers({ pelagic: 1.0, juvenile: 1.0, maleAdult: 1.0, femaleAdult: 1.0 });
      setCwShift(0.0);
    } else if (preset === 'recruitment') {
      setStageMultipliers({ pelagic: 2.2, juvenile: 2.5, maleAdult: 0.6, femaleAdult: 0.7 });
      setCwShift(-6.0);
    } else if (preset === 'spawner') {
      setStageMultipliers({ pelagic: 0.8, juvenile: 0.7, maleAdult: 2.0, femaleAdult: 2.2 });
      setCwShift(6.0);
    } else if (preset === 'truncated') {
      setStageMultipliers({ pelagic: 1.2, juvenile: 1.4, maleAdult: 0.2, femaleAdult: 0.8 });
      setCwShift(-12.0);
    }
  };

  const reseedWithCustomStructure = () => {
    initialize(params.ibm.n_agents, { stageMultipliers, cwShift });
  };

  const toggles = params.ibm?.toggles || {};
  const toggleKey = (key) => () => {
    updateParam(`ibm.toggles.${key}`, !toggles[key]);
  };

  return (
    <div className="card">
      <h2>Simulation Execution &amp; Bioenergetic Steering</h2>
      <div className="grid">
        <div>
          <label>
            Configuration Profile
            <select value={configName} onChange={(e) => setConfig(e.target.value)}>
              <option value="snowcrab">snowcrab (Scotian Shelf)</option>
              <option value="default">default</option>
            </select>
          </label>
          <label>
            Initial Agents
            <input
              type="number"
              value={params.ibm.n_agents}
              onChange={(e) => updateParam('ibm.n_agents', +e.target.value)}
            />
          </label>
          <label>
            Grid Dimensions (N × N)
            <input
              type="number"
              value={params.ibm.grid_size}
              onChange={(e) => updateParam('ibm.grid_size', +e.target.value)}
            />
          </label>
          <label>
            Grid Cell Unit (meters)
            <input
              type="number"
              step="0.5"
              min="0.1"
              value={params.ibm.unit_meters || 1.0}
              onChange={(e) => updateParam('ibm.unit_meters', +e.target.value)}
            />
          </label>
          <label>
            Food Availability Multiplier
            <input
              type="number"
              step="0.05"
              min="0.1"
              value={params.ibm.food_availability || 1.0}
              onChange={(e) => updateParam('ibm.food_availability', +e.target.value)}
            />
          </label>
          <label>
            Carrying Capacity Density (crabs/km², Instar 8+)
            <input
              type="number"
              step="500"
              min="100"
              value={params.ibm.benthic_carrying_capacity_density || 6000.0}
              onChange={(e) => updateParam('ibm.benthic_carrying_capacity_density', +e.target.value)}
            />
          </label>
          <label>
            Daily Fishing Mortality Probability
            <input
              type="number"
              step="0.001"
              value={params.fishery.fishing_probability_daily}
              onChange={(e) =>
                updateParam('fishery.fishing_probability_daily', +e.target.value)
              }
            />
          </label>
          <label>
            Legal Commercial Carapace Width (mm)
            <input
              type="number"
              value={params.fishery.legal_size_mm}
              onChange={(e) => updateParam('fishery.legal_size_mm', +e.target.value)}
            />
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3>Transport Controls</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="run"
              onClick={() => handleRunDays(365)}
              disabled={running}
            >
              {running ? 'Simulating...' : 'Run 1 Year (365d)'}
            </button>
            <button onClick={() => step()} disabled={running || !model}>
              Step 1 Day
            </button>
            <button onClick={() => handleRunDays(30)} disabled={running || !model}>
              Step 30 Days
            </button>
            <button onClick={() => initialize()} disabled={running}>
              Reset Population
            </button>
          </div>

          <h3 style={{ marginTop: 10 }}>Biological Process Toggles</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              ['directed_taxis', 'Directed Taxis'],
              ['molting', 'Hiatt Molting'],
              ['reproduction', 'Reproduction'],
              ['adult_senescence', 'Senescence'],
              ['thermal_stress', 'Thermal Stress'],
              ['cannibalism', 'Cannibalism'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`secondary ${toggles[key] !== false ? 'active' : ''}`}
                onClick={toggleKey(key)}
                style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              >
                {label}: {toggles[key] !== false ? 'ON' : 'OFF'}
              </button>
            ))}
          </div>

          <h3 style={{ marginTop: 12 }}>Size &amp; Stage Structure Adjustments</h3>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
              onClick={() => applyPreset('balanced')}
            >
              Balanced
            </button>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
              onClick={() => applyPreset('recruitment')}
            >
              Recruitment Pulse
            </button>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
              onClick={() => applyPreset('spawner')}
            >
              Spawner Heavy
            </button>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
              onClick={() => applyPreset('truncated')}
            >
              Truncated / Overfished
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.8rem' }}>
            <label>
              Pelagic Larvae: {(stageMultipliers?.pelagic || 1.0).toFixed(1)}×
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={stageMultipliers?.pelagic || 1.0}
                onChange={(e) => setStageMultipliers({ pelagic: Number(e.target.value) })}
              />
            </label>
            <label>
              Juveniles: {(stageMultipliers?.juvenile || 1.0).toFixed(1)}×
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={stageMultipliers?.juvenile || 1.0}
                onChange={(e) => setStageMultipliers({ juvenile: Number(e.target.value) })}
              />
            </label>
            <label>
              Adult Males: {(stageMultipliers?.maleAdult || 1.0).toFixed(1)}×
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={stageMultipliers?.maleAdult || 1.0}
                onChange={(e) => setStageMultipliers({ maleAdult: Number(e.target.value) })}
              />
            </label>
            <label>
              Adult Females: {(stageMultipliers?.femaleAdult || 1.0).toFixed(1)}×
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={stageMultipliers?.femaleAdult || 1.0}
                onChange={(e) => setStageMultipliers({ femaleAdult: Number(e.target.value) })}
              />
            </label>
          </div>

          <label style={{ fontSize: '0.8rem', marginTop: 4 }}>
            Carapace Width Shift: {(cwShift >= 0 ? '+' : '') + Number(cwShift || 0).toFixed(1)} mm
            <input
              type="range"
              min="-15"
              max="15"
              step="0.5"
              value={cwShift || 0}
              onChange={(e) => setCwShift(Number(e.target.value))}
            />
          </label>

          <button
            type="button"
            className="run"
            style={{ marginTop: 6, padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={reseedWithCustomStructure}
            disabled={running}
          >
            Reseed Population with Custom Structure
          </button>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => exportRun()}>Export Run (JSON)</button>
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                if (e.target.files[0]) {
                  const fr = new FileReader();
                  fr.onload = () => importRun(fr.result);
                  fr.readAsText(e.target.files[0]);
                }
              }}
            />
          </div>
          <p style={{ marginTop: 6 }}>
            Status: <strong>{status}</strong> | Elapsed: <strong>Day {day}</strong> (Year{' '}
            {(day / 365).toFixed(2)})
          </p>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div><strong>Total Organisms:</strong> {total}</div>
        <div><strong>Males:</strong> {males}</div>
        <div><strong>Females:</strong> {females}</div>
        <div><strong>Legal Males:</strong> {legal}</div>
        <div><strong>Legal Biomass:</strong> {legalBiomass.toFixed(1)} kg</div>
        <div><strong>Total Biomass:</strong> {totalBiomass.toFixed(1)} kg</div>
        <div><strong>Cumulative Catch:</strong> {catchTotal}</div>
        <div><strong>Mean CW:</strong> {meanCw.toFixed(1)} mm</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Plot
          data={[
            {
              x: history.map((h) => h.day),
              y: history.map((h) => h.total),
              type: 'scatter',
              mode: 'lines',
              name: 'Total Population',
              line: { color: '#38bdf8', width: 2 },
            },
            {
              x: history.map((h) => h.day),
              y: history.map((h) => h.males),
              type: 'scatter',
              mode: 'lines',
              name: 'Males',
              line: { color: '#60a5fa' },
            },
            {
              x: history.map((h) => h.day),
              y: history.map((h) => h.females),
              type: 'scatter',
              mode: 'lines',
              name: 'Females',
              line: { color: '#34d399' },
            },
            {
              x: history.map((h) => h.day),
              y: history.map((h) => h.legal),
              type: 'scatter',
              mode: 'lines',
              name: 'Legal Males (>=95mm)',
              line: { color: '#f59e0b', dash: 'dash' },
            },
          ]}
          layout={{
            title: 'Demographic Trajectories Over Time',
            paper_bgcolor: '#1e293b',
            plot_bgcolor: '#0f172a',
            font: { color: '#e2e8f0', size: 10 },
            margin: { t: 36, b: 36, l: 48, r: 16 },
            height: 280,
          }}
          useResizeHandler
          style={{ width: '100%', height: 280 }}
        />
      </div>
    </div>
  );
}
