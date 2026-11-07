import React, { useEffect } from 'react';
import { useStore } from '../store/simulationStore.js';
import Plot from 'react-plotly.js';

export default function Simulation() {
  const {
    params, configName, setConfig, model, initialize, running, status,
    day, total, males, females, legal, catchTotal, catchLegal, meanCw,
    step, run, history, updateParam, exportRun, importRun,
  } = useStore();

  useEffect(() => {
    if (!model) initialize(params.ibm.n_agents);
  }, [model, initialize, params.ibm.n_agents]);

  const handleRun = () => run(params.ibm.days || 365);

  return (
    <div className="card">
      <h2>Simulation</h2>
      <div className="grid">
        <div>
          <label>Config
            <select value={configName} onChange={(e) => setConfig(e.target.value)}>
              <option value="default">default</option>
              <option value="snowcrab">snowcrab</option>
            </select>
          </label>
          <label>Days <input type="number" value={params.ibm.days || 365} onChange={(e) => updateParam('ibm.days', +e.target.value || 365)} /></label>
          <label>Initial agents <input type="number" value={params.ibm.n_agents} onChange={(e) => updateParam('ibm.n_agents', +e.target.value)} /></label>
          <label>Grid size <input type="number" value={params.ibm.grid_size} onChange={(e) => updateParam('ibm.grid_size', +e.target.value)} /></label>
          <label>Fishing prob <input type="number" step="0.001" value={params.fishery.fishing_probability_daily} onChange={(e) => updateParam('fishery.fishing_probability_daily', +e.target.value)} /></label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="run" onClick={handleRun} disabled={running || status === 'running'}>
            {running ? 'Running...' : status === 'done' ? 'Re-run' : 'Initialize & Run'}
          </button>
          <button onClick={() => step()} disabled={running || !model} style={{ marginTop: 6 }}>Step 1 day</button>
          <button onClick={() => exportRun()} style={{ marginTop: 6 }}>Export run (JSON)</button>
          <input type="file" accept=".json" onChange={(e) => { if (e.target.files[0]) { const fr = new FileReader(); fr.onload = () => importRun(fr.result); fr.readAsText(e.target.files[0]); } }} style={{ marginTop: 6 }} />
          <p>Status: <strong>{status}</strong> | Day: {day}</p>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div><strong>Total</strong> {total}</div>
        <div><strong>Males</strong> {males}</div>
        <div><strong>Females</strong> {females}</div>
        <div><strong>Legal males</strong> {legal}</div>
        <div><strong>Catch total</strong> {catchTotal}</div>
        <div><strong>Catch legal</strong> {catchLegal}</div>
        <div><strong>Mean CW (mm)</strong> {meanCw.toFixed(1)}</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Plot
          data={[{ x: history.map((h) => h.day), y: history.map((h) => h.total), type: 'scatter', mode: 'lines', name: 'Total' },
          { x: history.map((h) => h.day), y: history.map((h) => h.males), type: 'scatter', mode: 'lines', name: 'Males' },
          { x: history.map((h) => h.day), y: history.map((h) => h.females), type: 'scatter', mode: 'lines', name: 'Females' }]}
          layout={{ title: 'Population over time', margin: { t: 40, b: 40 } }}
          useResizeHandler
          style={{ width: '100%', height: 300 }}
        />
      </div>
    </div>
  );
}
