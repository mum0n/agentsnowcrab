import React, { useEffect } from 'react';
import Plot from 'react-plotly.js';
import { useStore } from '../store/simulationStore.js';

export default function Dashboard() {
  const {
    total, males, females, legal, catchTotal, catchLegal, meanCw, day, status, history, model, params,
    initialize,
  } = useStore();
  useEffect(() => {
    if (!model) initialize(params.ibm.n_agents);
  }, [model, initialize, params.ibm.n_agents]);
  const agents = model?.agents ?? [];
  const maleAgents = agents.filter((agent) => agent.sex === 'male');
  const femaleAgents = agents.filter((agent) => agent.sex === 'female');
  const adultCount = agents.filter((agent) => agent.mature).length;
  const juvenileCount = agents.length - adultCount;
  const sizes = Array.from({ length: 240 }, (_, index) => 20 + index * 0.6);
  const viewportDepths = Array.from({ length: 24 * 20 }, (_, index) => {
    const longitude = -66.5 + (9 * (index % 24)) / 23;
    const latitude = 42 + (6.5 * Math.floor(index / 24)) / 19;
    return 90 + 28 * Math.abs(latitude - 45) + 10 * Math.abs(longitude + 60);
  });
  const maturity = sizes.map((size) => {
    const z = params.maturity.alpha + params.maturity.beta * Math.log(size);
    return 1 / (1 + Math.exp(-z));
  });
  const selectivity = sizes.map((size) =>
    1 / (1 + Math.exp(-0.2 * (size - params.fishery.legal_size_mm))),
  );
  const panelLayout = (title, extra = {}) => ({
    title,
    margin: { l: 48, r: 16, t: 42, b: 42 },
    height: 330,
    ...extra,
  });
  const panels = [
    {
      title: 'Spatial Habitat & Organisms',
      data: [
        {
          x: maleAgents.map((agent) => agent.x),
          y: maleAgents.map((agent) => agent.y),
          type: 'scatter',
          mode: 'markers',
          name: 'Male',
          marker: { color: '#2563eb', size: 6 },
        },
        {
          x: femaleAgents.map((agent) => agent.x),
          y: femaleAgents.map((agent) => agent.y),
          type: 'scatter',
          mode: 'markers',
          name: 'Female',
          marker: { color: '#e11d48', size: 6 },
        },
      ],
      layout: panelLayout('Spatial distribution in model grid', { xaxis: { title: 'Grid X' }, yaxis: { title: 'Grid Y' } }),
    },
    {
      title: 'Environmental Distributions',
      data: [{ x: viewportDepths, type: 'histogram', name: 'Depth (m)', marker: { color: '#2563eb' } }],
      layout: panelLayout('Depth distribution across map viewport', { xaxis: { title: 'Depth (m)' }, yaxis: { title: 'Cells' } }),
    },
    {
      title: 'Population Abundance',
      data: [
        { x: history.map((row) => row.day), y: history.map((row) => Math.log10(row.total + 1)), type: 'scatter', mode: 'lines', name: 'Total' },
        { x: history.map((row) => row.day), y: history.map((row) => Math.log10(row.males + 1)), type: 'scatter', mode: 'lines', name: 'Males' },
        { x: history.map((row) => row.day), y: history.map((row) => Math.log10(row.females + 1)), type: 'scatter', mode: 'lines', name: 'Females' },
      ],
      layout: panelLayout('Population abundance (log10)', { xaxis: { title: 'Day' }, yaxis: { title: 'log10(count + 1)' } }),
    },
    {
      title: 'Stage Structure',
      data: [{ x: ['Juvenile', 'Adult'], y: [juvenileCount, adultCount], type: 'bar', marker: { color: ['#0ea5e9', '#8b5cf6'] } }],
      layout: panelLayout('Current stage structure', { xaxis: { title: 'Stage' }, yaxis: { title: 'Living organisms', rangemode: 'tozero' } }),
    },
    {
      title: 'Size Frequency by Sex & Maturity',
      data: ['male', 'female'].flatMap((sex) =>
        [false, true].map((mature) => ({
          x: agents
            .filter((agent) => agent.sex === sex && agent.mature === mature)
            .map((agent) => agent.cw),
          type: 'histogram',
          name: `${sex} ${mature ? 'mature' : 'immature'}`,
          opacity: 0.55,
        })),
      ),
      layout: panelLayout('Carapace width (mm)', { barmode: 'overlay', xaxis: { title: 'CW (mm)' }, yaxis: { title: 'Organisms' } }),
    },
    {
      title: 'Maturity Ogives & Selectivity',
      data: [
        { x: sizes, y: maturity, type: 'scatter', mode: 'lines', name: 'Maturity' },
        { x: sizes, y: selectivity, type: 'scatter', mode: 'lines', name: 'Selectivity' },
      ],
      layout: panelLayout('Maturity ogive and fishery selectivity', {
        xaxis: { title: 'CW (mm)' },
        yaxis: { title: 'Probability', range: [0, 1] },
      }),
    },
    {
      title: 'Biomass, Catch & Macro-Models',
      data: [
        { x: history.map((row) => row.day), y: history.map((row) => row.biomass_index), type: 'scatter', mode: 'lines', name: 'Biomass index (CW³)' },
        { x: history.map((row) => row.day), y: history.map((row) => row.catch_total), type: 'scatter', mode: 'lines', name: 'Cumulative catch' },
      ],
      layout: panelLayout('Biomass index and catch', { xaxis: { title: 'Day' }, yaxis: { title: 'Index / organisms' } }),
    },
    {
      title: 'Stock-Recruitment',
      data: [{
        x: history.map((row) => row.mature_females),
        y: history.map((row) => row.recruits),
        type: 'scatter',
        mode: 'markers',
        name: 'Model outputs',
      }],
      layout: panelLayout('Mature females and juvenile recruits', {
        xaxis: { title: 'Mature females', rangemode: 'tozero' },
        yaxis: { title: 'Juvenile recruits', rangemode: 'tozero' },
      }),
    },
  ];

  return (
    <>
      <div className="card">
        <h2>Population Summary</h2>
        <div className="grid">
          <div><strong>Total abundance</strong><div>{total}</div></div>
          <div><strong>Males</strong><div>{males}</div></div>
          <div><strong>Females</strong><div>{females}</div></div>
          <div><strong>Legal males</strong><div>{legal}</div></div>
          <div><strong>Catch total</strong><div>{catchTotal}</div></div>
          <div><strong>Catch legal</strong><div>{catchLegal}</div></div>
          <div><strong>Mean CW (mm)</strong><div>{meanCw.toFixed(1)}</div></div>
          <div><strong>Day</strong><div>{day}</div></div>
        </div>
        <p>Status: <strong>{status}</strong> | History points: {history.length}</p>
      </div>
      <div className="grid">
        {panels.map((panel) => (
          <section className="card" key={panel.title}>
            <h2>{panel.title}</h2>
            <Plot
              data={panel.data}
              layout={panel.layout}
              useResizeHandler
              style={{ width: '100%', height: panel.layout.height }}
            />
          </section>
        ))}
      </div>
    </>
  );
}
