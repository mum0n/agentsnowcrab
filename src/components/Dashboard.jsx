import React, { useState, useEffect, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useStore } from '../store/simulationStore.js';
import {
  STAGE_LABELS,
  fitStockRecruitment,
  fitSchaefer,
  fitDelayDifference,
  bottomTemperature,
  habitatSuitability,
  seasonalBottomTemperatureCycle,
} from '../model/Analytics.js';
import { SCOTIAN_SHELF_GEO } from '../data/scotianShelfGeo.js';
import { scotianShelfDepth } from '../model/Model.js';

const ETOPO_DEPTH_MATRIX = Array.from({ length: SCOTIAN_SHELF_GEO.ny }, (_, j) =>
  Array.from({ length: SCOTIAN_SHELF_GEO.nx }, (__, i) => {
    const z = SCOTIAN_SHELF_GEO.z[j * SCOTIAN_SHELF_GEO.nx + i];
    return z > 0 ? Math.min(600, z) : null;
  }),
);

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState(1);

  const {
    aoi,
    setAOI,
    exclusionBoxes,
    setExclusionBox,
    clearExclusionBoxes,
    model,
    day,
    status,
    running,
    history,
    annual,
    stageCounts,
    stepDays,
    durationYears,
    rewindDays,
    horizonDays,
    backgroundLayer,
    setBackgroundLayer,
    setStepDays,
    setDurationYears,
    setRewindDays,
    initialize,
    step,
    start,
    pause,
    stop,
    rewind,
    updateParam,
    params,
  } = useStore();

  useEffect(() => {
    if (!model) initialize();
  }, [model, initialize]);

  const agents = model?.agents ?? [];
  const gsz = model?.gridSize || 1000;
  const mpa = exclusionBoxes?.[0] || null;

  // Canonical 7 biological classes with reduced sizes
  const larvaeAgents = agents.filter((a) => (a.stage || 4) <= 3 || a.sex === 'undifferentiated');
  const immFemales = agents.filter((a) => (a.stage || 4) > 3 && a.sex === 'female' && !a.mature);
  const immMales = agents.filter((a) => (a.stage || 4) > 3 && a.sex === 'male' && !a.mature);
  const matFemales = agents.filter((a) => a.sex === 'female' && a.mature && !a.eggs);
  const oviFemales = agents.filter((a) => a.sex === 'female' && a.eggs > 0);
  const legalThresh = params.fishery?.legal_size_male || 95.0;
  const sublegalMatMales = agents.filter((a) => a.sex === 'male' && a.mature && a.cw < legalThresh);
  const legalMatMales = agents.filter((a) => a.sex === 'male' && a.mature && a.cw >= legalThresh);

  // Background Raster Matrix for Spatial Habitat Map
  const spatialMatrix = useMemo(() => {
    if (!model?.env) return null;
    const nr = model.env.resolution || 50;
    const raw =
      backgroundLayer === 'depth'
        ? model.env.depth
        : backgroundLayer === 'temperature'
        ? model.env.temperature
        : model.env.hsi;
    if (!raw) return null;

    const mat = [];
    for (let j = 0; j < nr; j++) {
      const row = [];
      for (let i = 0; i < nr; i++) {
        row.push(raw[j * nr + i]);
      }
      mat.push(row);
    }
    return {
      mat,
      x: Array.from({ length: nr }, (_, i) => (i / (nr - 1)) * gsz),
      y: Array.from({ length: nr }, (_, j) => (j / (nr - 1)) * gsz),
    };
  }, [model, backgroundLayer, gsz]);

  // Seasonal Bottom Temperature Climatology calculation (Tab 1 Right Panel)
  const tempCycle = useMemo(() => {
    const depth = aoi.depth || scotianShelfDepth(aoi.longitude, aoi.latitude);
    const toff = params.environment?.temp_offset || 0.0;
    const tmult = params.environment?.temp_multiplier || 1.0;
    return seasonalBottomTemperatureCycle(aoi.longitude, aoi.latitude, depth, toff, tmult, 80.0);
  }, [aoi, params]);

  // Environmental driver distributions
  const gridDepths = useMemo(() => (model?.env?.depth ? Array.from(model.env.depth) : []), [model]);
  const gridTemps = useMemo(() => (model?.env?.temperature ? Array.from(model.env.temperature) : []), [model]);
  const gridHsis = useMemo(() => (model?.env?.hsi ? Array.from(model.env.hsi) : []), [model]);

  // Sizes for ogives & densities
  const sizes = useMemo(() => Array.from({ length: 140 }, (_, i) => 20 + i), []);
  const mParam = params.maturity || {};
  const legalSize = params.fishery?.legal_size_male || 95.0;

  const theoryMatMale = sizes.map((cw) => {
    if (cw < (mParam.maturity_size_gate || 35.0)) return 0.0;
    const z = (mParam.maturity_slope_male || 6.9957) * (Math.log(cw) - Math.log(mParam.maturity_l50_male || 91.8));
    return 1.0 / (1.0 + Math.exp(-z));
  });

  const theoryMatFemale = sizes.map((cw) => {
    if (cw < (mParam.maturity_size_gate || 35.0)) return 0.0;
    const z = (mParam.maturity_slope_female || 12.9812) * (Math.log(cw) - Math.log(mParam.maturity_l50_female || 51.6));
    return 1.0 / (1.0 + Math.exp(-z));
  });

  const selectivity = sizes.map((cw) => 1.0 / (1.0 + Math.exp(-0.25 * (cw - legalSize))));

  const empiricalOgive = useMemo(() => {
    const bins = {};
    for (let b = 30; b <= 140; b += 10) bins[b] = { total: 0, mature: 0 };
    for (const a of agents) {
      const b = Math.floor(a.cw / 10) * 10;
      if (bins[b]) {
        bins[b].total += 1;
        if (a.mature) bins[b].mature += 1;
      }
    }
    const x = [];
    const y = [];
    for (let b = 30; b <= 140; b += 10) {
      if (bins[b].total >= 2) {
        x.push(b + 5);
        y.push(bins[b].mature / bins[b].total);
      }
    }
    return { x, y };
  }, [agents]);

  // Macro-ecological model fits (Tab 4)
  const macroFits = useMemo(() => {
    if (!annual || annual.length < 3) return null;
    const times = annual.map((a) => a.year);
    const biomasses = annual.map((a) => a.legal_biomass_kg);
    const catches = annual.map((a) => a.annual_catch_kg);
    const schaefer = fitSchaefer(times, biomasses, catches);
    const delayDiff = fitDelayDifference(times, biomasses, catches, 1);
    return { times, biomasses, catches, schaefer, delayDiff };
  }, [annual]);

  // Stock-recruitment fitting (Tab 4)
  const srFits = useMemo(() => {
    if (!annual || annual.length < 2) return null;
    const spawners = annual.map((a) => a.spawners);
    const recruits = annual.map((a) => a.recruits);
    const fits = fitStockRecruitment(spawners, recruits);

    if (!fits.isFitted) return null;
    const sMin = Math.max(1, Math.min(...spawners));
    const sMax = Math.max(...spawners) * 1.4;
    const sCurve = [];
    const rkCurve = [];
    const bhCurve = [];
    for (let i = 0; i <= 60; i++) {
      const s = sMin + (i / 60) * (sMax - sMin);
      sCurve.push(s);
      rkCurve.push(fits.ricker.predict(s));
      bhCurve.push(fits.bevertonHolt.predict(s));
    }
    return { fits, spawners, recruits, sCurve, rkCurve, bhCurve };
  }, [annual]);

  const lightPlotLayout = (extra = {}) => ({
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { color: '#0f172a', size: 11, family: 'system-ui, sans-serif' },
    margin: { l: 50, r: 20, t: 40, b: 40 },
    ...extra,
  });

  const clickRegionalMap = (event) => {
    const point = event.points?.[0];
    const lon = Number.isFinite(point?.lon) ? point.lon : point?.x;
    const lat = Number.isFinite(point?.lat) ? point.lat : point?.y;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      const depth = scotianShelfDepth(lon, lat);
      setAOI({ longitude: lon, latitude: lat, depth });
    }
  };

  const handleSpatialBoxSelect = (event) => {
    if (!event || !event.range) return;
    const { x, y } = event.range;
    if (x && y && x.length === 2 && y.length === 2) {
      const xmin = Math.max(0, Math.min(gsz, Math.round(Math.min(x[0], x[1]))));
      const xmax = Math.max(0, Math.min(gsz, Math.round(Math.max(x[0], x[1]))));
      const ymin = Math.max(0, Math.min(gsz, Math.round(Math.min(y[0], y[1]))));
      const ymax = Math.max(0, Math.min(gsz, Math.round(Math.max(y[0], y[1]))));
      if (xmax - xmin >= 10 && ymax - ymin >= 10) {
        setExclusionBox({ xmin, xmax, ymin, ymax, active: true });
      }
    }
  };

  const currentT = bottomTemperature(aoi.depth || 135, aoi.latitude, params.environment?.temp_offset || 0);
  const currentHSI = habitatSuitability(currentT, aoi.depth || 135);

  const meanDepthVal = gridDepths.length ? (gridDepths.reduce((a, b) => a + b, 0) / gridDepths.length).toFixed(1) : '135.0';
  const spanDepthVal = gridDepths.length ? (Math.max(...gridDepths) - Math.min(...gridDepths)).toFixed(1) : '0.0';
  const meanTempVal = gridTemps.length ? (gridTemps.reduce((a, b) => a + b, 0) / gridTemps.length).toFixed(2) : '3.40';
  const spanTempVal = gridTemps.length ? (Math.max(...gridTemps) - Math.min(...gridTemps)).toFixed(2) : '0.00';
  const meanHsiVal = gridHsis.length ? (gridHsis.reduce((a, b) => a + b, 0) / gridHsis.length).toFixed(3) : '0.750';
  const minHsiVal = gridHsis.length ? Math.min(...gridHsis).toFixed(3) : '0.000';
  const maxHsiVal = gridHsis.length ? Math.max(...gridHsis).toFixed(3) : '1.000';

  return (
    <div>
      {/* Top Header */}
      <header className="tethysbio-header">
        <h1>TethysBio Interactive Dashboard</h1>
        <div className="status">{status}</div>

        <div className="tethysbio-toolbar-row">
          <nav className="tethysbio-tab-bar">
            <button
              type="button"
              className={`tethysbio-tab-btn ${activeTab === 1 ? 'active' : ''}`}
              onClick={() => setActiveTab(1)}
            >
              1. Controls &amp; AOI Setup
            </button>
            <button
              type="button"
              className={`tethysbio-tab-btn ${activeTab === 2 ? 'active' : ''}`}
              onClick={() => setActiveTab(2)}
            >
              2. Simulation &amp; Habitat
            </button>
            <button
              type="button"
              className={`tethysbio-tab-btn ${activeTab === 3 ? 'active' : ''}`}
              onClick={() => setActiveTab(3)}
            >
              3. Demographics &amp; Growth
            </button>
            <button
              type="button"
              className={`tethysbio-tab-btn ${activeTab === 4 ? 'active' : ''}`}
              onClick={() => setActiveTab(4)}
            >
              4. Assessment &amp; Calibration
            </button>
          </nav>

          {/* Top Transport Toolbar */}
          <div className="transport-controls">
            <div className="transport-btn-group">
              <button type="button" className="btn-start" onClick={start}>
                ▶ Start
              </button>
              <button type="button" className="btn-step" onClick={() => step()}>
                ▶❚ Step
              </button>
              <button type="button" className="btn-pause" onClick={pause}>
                ⏸ Pause
              </button>
              <button type="button" className="btn-stop" onClick={stop}>
                ⏹ Stop / Reset
              </button>
            </div>

            <span style={{ color: '#cbd5e1', margin: '0 4px' }}>|</span>

            <div className="transport-inputs">
              <label className="transport-label">
                Step (d):
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="transport-input"
                  value={stepDays}
                  onChange={(e) => setStepDays(e.target.value)}
                />
              </label>
              <label className="transport-label">
                Duration (y):
                <input
                  type="number"
                  min="1"
                  max="50"
                  className="transport-input"
                  value={durationYears}
                  onChange={(e) => setDurationYears(e.target.value)}
                />
              </label>
              <label className="transport-label">
                Rewind (d):
                <input
                  type="number"
                  min="1"
                  max="3650"
                  className="transport-input"
                  value={rewindDays}
                  onChange={(e) => setRewindDays(e.target.value)}
                />
              </label>
              <button type="button" className="btn-rewind" onClick={() => rewind()}>
                ⏪ Rewind
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="tethysbio-layout">
        {/* ================================================================== */}
        {/* TAB 1: Controls & AOI Setup (5:4 Aspect Ratio side-by-side) */}
        {/* ================================================================== */}
        {activeTab === 1 && (
          <div className="tab1-grid">
            {/* Left: Regional Scotian Shelf Map */}
            <div className="card-panel">
              <h2>Scotian Shelf Regional Bathymetry (Click Map to Select AOI)</h2>
              <div style={{ width: '100%', aspectRatio: '5 / 4', position: 'relative' }}>
                <Plot
                  data={[
                    {
                      type: 'heatmap',
                      x: SCOTIAN_SHELF_GEO.lons,
                      y: SCOTIAN_SHELF_GEO.lats,
                      z: ETOPO_DEPTH_MATRIX,
                      zsmooth: 'best',
                      colorscale: [
                        [0.0, '#bae6fd'],
                        [0.15, '#38bdf8'],
                        [0.35, '#0284c7'],
                        [0.6, '#1e3a8a'],
                        [1.0, '#08142c'],
                      ],
                      colorbar: { title: 'Depth (m)', thickness: 12, len: 0.9 },
                      hovertemplate: 'Lon %{x:.2f}°W<br>Lat %{y:.2f}°N<br>Depth %{z:.0f} m<extra></extra>',
                      showscale: true,
                    },
                    ...(SCOTIAN_SHELF_GEO.isobaths || []).map((iso) => ({
                      type: 'scatter',
                      mode: 'lines',
                      x: iso.lon,
                      y: iso.lat,
                      line: {
                        color: iso.level === 200 ? 'rgba(255, 255, 255, 0.65)' : 'rgba(255, 255, 255, 0.4)',
                        width: iso.level === 200 ? 1.0 : 0.6,
                      },
                      hoverinfo: 'skip',
                      showlegend: false,
                    })),
                    ...(SCOTIAN_SHELF_GEO.coastline || []).map((poly) => ({
                      type: 'scatter',
                      mode: 'lines',
                      x: poly.lon,
                      y: poly.lat,
                      fill: 'toself',
                      fillcolor: 'rgba(226, 232, 240, 0.95)',
                      line: { color: '#64748b', width: 1.0 },
                      hoverinfo: 'skip',
                      showlegend: false,
                    })),
                    {
                      type: 'scatter',
                      x: [aoi.longitude],
                      y: [aoi.latitude],
                      mode: 'markers',
                      marker: {
                        size: 14,
                        color: '#dc2626',
                        symbol: 'circle',
                        line: { color: '#ffffff', width: 2.5 },
                      },
                      name: 'AOI Center',
                      showlegend: false,
                    },
                  ]}
                  layout={lightPlotLayout({
                    autosize: true,
                    xaxis: {
                      title: 'Longitude (°W)',
                      range: [-66.5, -57.5],
                      showgrid: true,
                      gridcolor: '#e2e8f0',
                    },
                    yaxis: {
                      title: 'Latitude (°N)',
                      range: [42.0, 48.5],
                      showgrid: true,
                      gridcolor: '#e2e8f0',
                      scaleanchor: 'x',
                      scaleratio: 1.38,
                    },
                    margin: { l: 45, r: 15, t: 15, b: 35 },
                  })}
                  onClick={clickRegionalMap}
                  useResizeHandler
                  style={{ width: '100%', height: '100%' }}
                />
              </div>

              {/* Text placed below map */}
              <div style={{ marginTop: 12, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a8a' }}>
                    Selected: {aoi.latitude.toFixed(2)}°N, {Math.abs(aoi.longitude).toFixed(2)}°W
                  </div>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    Depth: <strong>{aoi.depth || 135} m</strong> | Temp: <strong>{currentT.toFixed(2)} °C</strong> | HSI: <strong>{currentHSI.toFixed(3)}</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
                    Longitude (°W):
                    <input
                      type="number"
                      step="0.1"
                      className="ctrl-input"
                      style={{ width: 80 }}
                      value={aoi.longitude}
                      onChange={(e) => setAOI({ longitude: parseFloat(e.target.value) || -59.0 })}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
                    Latitude (°N):
                    <input
                      type="number"
                      step="0.1"
                      className="ctrl-input"
                      style={{ width: 80 }}
                      value={aoi.latitude}
                      onChange={(e) => setAOI({ latitude: parseFloat(e.target.value) || 45.0 })}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Presets:</span>
                  <button type="button" className="preset-btn" onClick={() => setAOI({ longitude: -59.0, latitude: 45.0 })}>
                    Laurentian (-59°W, 45°N)
                  </button>
                  <button type="button" className="preset-btn" onClick={() => setAOI({ longitude: -60.0, latitude: 43.8 })}>
                    Sable Bank (-60°W, 43.8°N)
                  </button>
                  <button type="button" className="preset-btn" onClick={() => setAOI({ longitude: -58.5, latitude: 44.5 })}>
                    Banquereau (-58.5°W, 44.5°N)
                  </button>
                  <button type="button" className="preset-btn" onClick={() => setAOI({ longitude: -62.8, latitude: 43.8 })}>
                    Emerald (-62.8°W, 43.8°N)
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Seasonal Bottom Temperature Climatology (5:4 Aspect Ratio) */}
            <div className="card-panel">
              <h2>Seasonal Bottom Temperature Climatology</h2>
              <div style={{ width: '100%', aspectRatio: '5 / 4', position: 'relative' }}>
                <Plot
                  data={[
                    // Thermal envelope band (0 to 4 °C)
                    {
                      x: [1, 365, 365, 1],
                      y: [0, 0, 4, 4],
                      fill: 'toself',
                      fillcolor: 'rgba(13, 148, 136, 0.15)',
                      line: { width: 0 },
                      hoverinfo: 'skip',
                      name: 'Preferred Habitat Envelope (0–4°C)',
                      type: 'scatter',
                    },
                    // Mean dashed line
                    {
                      x: [1, 365],
                      y: [tempCycle.meanT, tempCycle.meanT],
                      mode: 'lines',
                      line: { color: '#64748b', dash: 'dash', width: 1.5 },
                      name: `Mean: ${tempCycle.meanT.toFixed(1)}°C`,
                      type: 'scatter',
                    },
                    // Seasonal Cycle crimson line
                    {
                      x: tempCycle.days,
                      y: tempCycle.temps,
                      mode: 'lines',
                      line: { color: '#dc2626', width: 2.8 },
                      name: 'Seasonal Cycle',
                      type: 'scatter',
                    },
                  ]}
                  layout={lightPlotLayout({
                    autosize: true,
                    title: {
                      text: `Seasonal Bottom Temperature Climatology<br>(${aoi.latitude.toFixed(2)}°N, ${Math.abs(aoi.longitude).toFixed(2)}°W | Depth: ${tempCycle.depth.toFixed(0)} m)`,
                      font: { size: 13, color: '#0f172a' },
                    },
                    xaxis: {
                      title: 'Day of Year',
                      tickmode: 'array',
                      tickvals: [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335],
                      ticktext: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                      range: [1, 365],
                      showgrid: true,
                      gridcolor: '#e2e8f0',
                    },
                    yaxis: {
                      title: 'Bottom Temp (°C)',
                      range: [-1, 7],
                      showgrid: true,
                      gridcolor: '#e2e8f0',
                    },
                    legend: {
                      x: 0.98,
                      y: 0.98,
                      xanchor: 'right',
                      yanchor: 'top',
                      bgcolor: 'rgba(255,255,255,0.85)',
                      bordercolor: '#cbd5e1',
                      borderwidth: 1,
                    },
                    margin: { l: 45, r: 15, t: 45, b: 35 },
                  })}
                  useResizeHandler
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 2: Simulation & Habitat */}
        {/* ================================================================== */}
        {activeTab === 2 && (
          <div className="tab2-grid">
            {/* Left Column: Spatial Plot + Below 2-Column Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Spatial Plot Card */}
              <div className="card-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                    Spatial Habitat &amp; Organism Distribution (Day {day} / Year {(day / 365).toFixed(1)})
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>
                    Drag mouse to set Exclusion Area
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>
                  Day {day} (Yr {(day / 365).toFixed(1)}) / {horizonDays} [{running ? 'RUNNING' : 'STOPPED'}]
                </div>

                <div style={{ width: '100%', aspectRatio: '1 / 1', position: 'relative' }}>
                  <Plot
                    data={[
                      ...(spatialMatrix
                        ? [
                            {
                              z: spatialMatrix.mat,
                              x: spatialMatrix.x,
                              y: spatialMatrix.y,
                              type: 'heatmap',
                              zsmooth: 'best',
                              colorscale:
                                backgroundLayer === 'temperature'
                                  ? 'Inferno'
                                  : backgroundLayer === 'depth'
                                  ? 'Viridis'
                                  : 'Viridis',
                              showscale: true,
                              colorbar: {
                                title:
                                  backgroundLayer === 'temperature'
                                    ? 'Temp (°C)'
                                    : backgroundLayer === 'depth'
                                    ? 'Depth (m)'
                                    : 'HSI',
                                thickness: 12,
                                len: 0.85,
                              },
                              opacity: 0.85,
                              hoverinfo: 'none',
                            },
                          ]
                        : []),
                      {
                        x: larvaeAgents.map((a) => a.x),
                        y: larvaeAgents.map((a) => a.y),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Larvae / Undifferentiated',
                        marker: { color: '#E69F00', size: 4, line: { color: '#0f172a', width: 0.6 } },
                      },
                      {
                        x: immFemales.map((a) => a.x),
                        y: immFemales.map((a) => a.y),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Immature Female',
                        marker: { color: '#CC79A7', size: 4.5, line: { color: '#0f172a', width: 0.6 } },
                      },
                      {
                        x: immMales.map((a) => a.x),
                        y: immMales.map((a) => a.y),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Immature Male',
                        marker: { color: '#56B4E9', size: 4.5, line: { color: '#0f172a', width: 0.6 } },
                      },
                      {
                        x: matFemales.map((a) => a.x),
                        y: matFemales.map((a) => a.y),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Mature Female',
                        marker: { color: '#785EF0', size: 5.5, line: { color: '#0f172a', width: 0.6 } },
                      },
                      {
                        x: oviFemales.map((a) => a.x),
                        y: oviFemales.map((a) => a.y),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Ovigerous Female',
                        marker: { color: '#D55E00', size: 5.5, line: { color: '#0f172a', width: 0.6 } },
                      },
                      {
                        x: sublegalMatMales.map((a) => a.x),
                        y: sublegalMatMales.map((a) => a.y),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Sublegal Mature Male',
                        marker: { color: '#0072B2', size: 5.5, line: { color: '#0f172a', width: 0.6 } },
                      },
                      {
                        x: legalMatMales.map((a) => a.x),
                        y: legalMatMales.map((a) => a.y),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Legal Mature Male (≥95mm)',
                        marker: { color: '#003B73', size: 6.5, line: { color: '#0f172a', width: 0.7 } },
                      },
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      dragmode: 'select',
                      xaxis: {
                        title: 'Grid X (cells)',
                        range: [0, gsz],
                        scaleanchor: 'y',
                        scaleratio: 1,
                        constrain: 'domain',
                        showgrid: true,
                        gridcolor: '#e2e8f0',
                      },
                      yaxis: {
                        title: 'Grid Y (cells)',
                        range: [0, gsz],
                        constrain: 'domain',
                        showgrid: true,
                        gridcolor: '#e2e8f0',
                      },
                      shapes: mpa && mpa.active
                        ? [
                            {
                              type: 'rect',
                              x0: mpa.xmin,
                              x1: mpa.xmax,
                              y0: mpa.ymin,
                              y1: mpa.ymax,
                              line: { color: '#f59e0b', width: 2, dash: 'dash' },
                              fillcolor: 'rgba(245, 158, 11, 0.25)',
                            },
                          ]
                        : [],
                      showlegend: false,
                      margin: { l: 45, r: 15, t: 15, b: 35 },
                    })}
                    onSelected={handleSpatialBoxSelect}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>

                {/* Below Plot MPA Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '4px 8px', background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 11 }}>
                    <span style={{ fontWeight: 600, color: '#334155' }}>Exclusion: </span>
                    <span style={{ color: '#64748b', fontFamily: 'monospace' }}>
                      {mpa && mpa.active ? `X [${Math.round(mpa.xmin)}–${Math.round(mpa.xmax)}], Y [${Math.round(mpa.ymin)}–${Math.round(mpa.ymax)}]` : 'None'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearExclusionBoxes}
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: '#475569',
                    }}
                  >
                    Clear MPA
                  </button>
                </div>
              </div>

              {/* 2-Column Controls (Numeric Entries, No Sliders) */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {/* Col 1: Simulation & Environmental Controls */}
                  <div className="controls-col-card">
                    <div className="controls-col-title">Simulation &amp; Environmental Controls</div>

                    <div className="ctrl-row">
                      <span>Grid Resolution (cells):</span>
                      <input
                        type="number"
                        className="ctrl-input"
                        value={params.ibm?.grid_size || 1000}
                        onChange={(e) => updateParam('ibm.grid_size', parseInt(e.target.value) || 1000)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span>Grid Unit / Cell Size (m):</span>
                      <input
                        type="number"
                        step="0.5"
                        className="ctrl-input"
                        value={params.ibm?.unit_meters || 1.0}
                        onChange={(e) => updateParam('ibm.unit_meters', parseFloat(e.target.value) || 1.0)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span>Base Bottom Temp Offset (°C):</span>
                      <input
                        type="number"
                        step="0.1"
                        className="ctrl-input"
                        value={params.environment?.temp_offset || 0.0}
                        onChange={(e) => updateParam('environment.temp_offset', parseFloat(e.target.value) || 0.0)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span>Seasonal Temp Multiplier:</span>
                      <input
                        type="number"
                        step="0.05"
                        className="ctrl-input"
                        value={params.environment?.temp_multiplier || 1.0}
                        onChange={(e) => updateParam('environment.temp_multiplier', parseFloat(e.target.value) || 1.0)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span>Habitat Suitability Offset:</span>
                      <input
                        type="number"
                        step="0.05"
                        className="ctrl-input"
                        value={params.environment?.habitat_offset || 0.0}
                        onChange={(e) => updateParam('environment.habitat_offset', parseFloat(e.target.value) || 0.0)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span>Habitat Multiplier:</span>
                      <input
                        type="number"
                        step="0.05"
                        className="ctrl-input"
                        value={params.environment?.habitat_multiplier || 1.0}
                        onChange={(e) => updateParam('environment.habitat_multiplier', parseFloat(e.target.value) || 1.0)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span>Food Availability Multiplier:</span>
                      <input
                        type="number"
                        step="0.05"
                        className="ctrl-input"
                        value={params.environment?.food_availability || 1.0}
                        onChange={(e) => updateParam('environment.food_availability', parseFloat(e.target.value) || 1.0)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span>Carrying Capacity (/km²):</span>
                      <input
                        type="number"
                        step="500"
                        className="ctrl-input"
                        value={params.environment?.benthic_carrying_capacity_density || 6000}
                        onChange={(e) => updateParam('environment.benthic_carrying_capacity_density', parseFloat(e.target.value) || 6000)}
                      />
                    </div>
                    <div className="ctrl-row">
                      <span style={{ fontWeight: 600 }}>Background Layer:</span>
                      <select
                        value={backgroundLayer}
                        onChange={(e) => setBackgroundLayer(e.target.value)}
                        style={{ padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 11, background: '#ffffff', color: '#0f172a' }}
                      >
                        <option value="depth">Seabed Depth (m)</option>
                        <option value="temperature">Bottom Temperature</option>
                        <option value="habitat_quality">Habitat Quality (HSI)</option>
                      </select>
                    </div>
                  </div>

                  {/* Col 2: Commercial Fishing Activity & Biological Processes */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="controls-col-card">
                      <div className="controls-col-title">Commercial Fishing Activity</div>
                      <div className="ctrl-row">
                        <span>Fishing Start (Day):</span>
                        <input
                          type="number"
                          className="ctrl-input"
                          value={params.fishery?.fishing_season_start || 90}
                          onChange={(e) => updateParam('fishery.fishing_season_start', parseInt(e.target.value) || 90)}
                        />
                      </div>
                      <div className="ctrl-row">
                        <span>Fishing End (Day):</span>
                        <input
                          type="number"
                          className="ctrl-input"
                          value={params.fishery?.fishing_season_end || 150}
                          onChange={(e) => updateParam('fishery.fishing_season_end', parseInt(e.target.value) || 150)}
                        />
                      </div>
                      <div className="ctrl-row">
                        <span>Daily Harvest Probability:</span>
                        <input
                          type="number"
                          step="0.0005"
                          className="ctrl-input"
                          value={params.fishery?.fishing_probability_daily || 0.002}
                          onChange={(e) => updateParam('fishery.fishing_probability_daily', parseFloat(e.target.value) || 0.002)}
                        />
                      </div>
                      <div className="ctrl-row">
                        <span>Legal Male Size (mm):</span>
                        <input
                          type="number"
                          step="1.0"
                          className="ctrl-input"
                          value={params.fishery?.legal_size_male || 95.0}
                          onChange={(e) => updateParam('fishery.legal_size_male', parseFloat(e.target.value) || 95.0)}
                        />
                      </div>
                    </div>

                    <div className="controls-col-card" style={{ flexGrow: 1 }}>
                      <div className="controls-col-title">Biological Processes</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={params.ibm?.toggles?.use_energetics ?? true}
                            onChange={(e) => updateParam('ibm.toggles.use_energetics', e.target.checked)}
                          />
                          <span>Bioenergetics</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={params.ibm?.toggles?.use_thermal ?? true}
                            onChange={(e) => updateParam('ibm.toggles.use_thermal', e.target.checked)}
                          />
                          <span>Thermal Stress</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={params.ibm?.toggles?.use_cannibalism ?? false}
                            onChange={(e) => updateParam('ibm.toggles.use_cannibalism', e.target.checked)}
                          />
                          <span>Cannibalism</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={params.ibm?.toggles?.use_senescence ?? true}
                            onChange={(e) => updateParam('ibm.toggles.use_senescence', e.target.checked)}
                          />
                          <span>Senescence</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={params.ibm?.toggles?.use_movement ?? true}
                            onChange={(e) => updateParam('ibm.toggles.use_movement', e.target.checked)}
                          />
                          <span>Taxis Movement</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={params.ibm?.toggles?.use_reproduction ?? true}
                            onChange={(e) => updateParam('ibm.toggles.use_reproduction', e.target.checked)}
                          />
                          <span>Reproduction</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Population Abundance + Environmental Distributions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Abundance Trajectories (aligned height with spatial plot) */}
              <div className="card-panel">
                <h2>Population Abundance Trajectories</h2>
                <div style={{ width: '100%', height: 350 }}>
                  <Plot
                    data={[
                      {
                        x: history.map((r) => r.day),
                        y: history.map((r) => Math.log10(Math.max(1, r.total))),
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Total Living',
                        line: { color: '#0284c7', width: 2.2 },
                      },
                      {
                        x: history.map((r) => r.day),
                        y: history.map((r) => Math.log10(Math.max(1, r.mature_females))),
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Mature Females',
                        line: { color: '#785EF0', width: 1.8 },
                      },
                      {
                        x: history.map((r) => r.day),
                        y: history.map((r) => Math.log10(Math.max(1, r.mature_males))),
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Mature Males',
                        line: { color: '#0072B2', width: 1.8 },
                      },
                      {
                        x: history.map((r) => r.day),
                        y: history.map((r) => Math.log10(Math.max(1, r.legal))),
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Legal Males (≥95mm)',
                        line: { color: '#dc2626', width: 2.0, dash: 'dash' },
                      },
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      xaxis: { title: 'Time (days)', showgrid: true, gridcolor: '#e2e8f0' },
                      yaxis: { title: 'log10(count)', showgrid: true, gridcolor: '#e2e8f0', range: [0, 5] },
                      legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#cbd5e1', borderwidth: 1 },
                      margin: { l: 45, r: 15, t: 15, b: 35 },
                    })}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>

              {/* Environmental Distributions Card */}
              <div className="card-panel">
                <h2>Environmental Distributions</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, height: 210 }}>
                  {/* Depth */}
                  <div>
                    <Plot
                      data={[{ x: gridDepths, type: 'histogram', marker: { color: 'rgba(30, 58, 138, 0.45)', line: { color: '#1e3a8a', width: 1 } }, nbinsx: 16 }]}
                      layout={lightPlotLayout({
                        autosize: true,
                        title: { text: `Seabed Depth<br>(μ = ${meanDepthVal} m, Δ = ${spanDepthVal} m)`, font: { size: 11, color: '#1e293b' } },
                        xaxis: { title: 'Depth (m)', showgrid: true, gridcolor: '#f1f5f9' },
                        yaxis: { title: 'Cells', showgrid: true, gridcolor: '#f1f5f9' },
                        margin: { l: 35, r: 10, t: 35, b: 30 },
                      })}
                      useResizeHandler
                      style={{ width: '100%', height: '100%' }}
                    />
                  </div>
                  {/* Temp */}
                  <div>
                    <Plot
                      data={[{ x: gridTemps, type: 'histogram', marker: { color: 'rgba(185, 28, 28, 0.45)', line: { color: '#b91c1c', width: 1 } }, nbinsx: 16 }]}
                      layout={lightPlotLayout({
                        autosize: true,
                        title: { text: `Bottom Temperature<br>(μ = ${meanTempVal} °C, Δ = ${spanTempVal} °C)`, font: { size: 11, color: '#1e293b' } },
                        xaxis: { title: 'Temp (°C)', showgrid: true, gridcolor: '#f1f5f9' },
                        yaxis: { title: 'Cells', showgrid: true, gridcolor: '#f1f5f9' },
                        margin: { l: 35, r: 10, t: 35, b: 30 },
                      })}
                      useResizeHandler
                      style={{ width: '100%', height: '100%' }}
                    />
                  </div>
                  {/* HSI */}
                  <div>
                    <Plot
                      data={[{ x: gridHsis, type: 'histogram', marker: { color: 'rgba(15, 118, 110, 0.45)', line: { color: '#0f766e', width: 1 } }, nbinsx: 16 }]}
                      layout={lightPlotLayout({
                        autosize: true,
                        title: { text: `Habitat Suitability (HSI)<br>(μ = ${meanHsiVal}, [${minHsiVal}, ${maxHsiVal}])`, font: { size: 11, color: '#1e293b' } },
                        xaxis: { title: 'HSI [0, 1]', range: [0, 1], showgrid: true, gridcolor: '#f1f5f9' },
                        yaxis: { title: 'Cells', showgrid: true, gridcolor: '#f1f5f9' },
                        margin: { l: 35, r: 10, t: 35, b: 30 },
                      })}
                      useResizeHandler
                      style={{ width: '100%', height: '100%' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 3: Demographics & Growth (2 Columns) */}
        {/* ================================================================== */}
        {activeTab === 3 && (
          <div className="tab3-grid">
            {/* Column 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card-panel">
                <h2>Stage Structure &amp; Cohort Progression</h2>
                <div style={{ width: '100%', height: 320 }}>
                  <Plot
                    data={[
                      {
                        x: STAGE_LABELS,
                        y: stageCounts.map((c) => Math.log10(Math.max(1, c))),
                        type: 'bar',
                        marker: {
                          color: [
                            '#a78bfa', '#a78bfa', '#a78bfa', '#a78bfa',
                            '#38bdf8', '#38bdf8', '#38bdf8', '#38bdf8', '#38bdf8',
                            '#2563eb', '#2563eb', '#2563eb', '#2563eb', '#2563eb', '#1d4ed8',
                            '#f43f5e', '#f43f5e', '#f43f5e', '#f43f5e', '#be123c',
                          ],
                        },
                      },
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      xaxis: { title: 'Life-History Stage', tickangle: -45, showgrid: true, gridcolor: '#f1f5f9' },
                      yaxis: { title: 'log10(Abundance)', showgrid: true, gridcolor: '#f1f5f9' },
                      margin: { l: 45, r: 15, t: 15, b: 65 },
                    })}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>

              <div className="card-panel">
                <h2>Maturity Ogives &amp; Fishery Selectivity</h2>
                <div style={{ width: '100%', height: 320 }}>
                  <Plot
                    data={[
                      {
                        x: sizes,
                        y: theoryMatMale,
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Male Ogive (L50=91.8)',
                        line: { color: '#0284c7', width: 2.2 },
                      },
                      {
                        x: sizes,
                        y: theoryMatFemale,
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Female Ogive (L50=51.6)',
                        line: { color: '#e11d48', width: 2.2 },
                      },
                      {
                        x: sizes,
                        y: selectivity,
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Gear Selectivity (95mm)',
                        line: { color: '#f59e0b', dash: 'dash', width: 2 },
                      },
                      ...(empiricalOgive.x.length > 0
                        ? [
                            {
                              x: empiricalOgive.x,
                              y: empiricalOgive.y,
                              type: 'scatter',
                              mode: 'markers',
                              name: 'Empirical Maturity',
                              marker: { color: '#0f172a', size: 7, symbol: 'diamond' },
                            },
                          ]
                        : []),
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      xaxis: { title: 'Carapace Width (mm)', range: [20, 160], showgrid: true, gridcolor: '#f1f5f9' },
                      yaxis: { title: 'P(Mature) / Selectivity', range: [0, 1.05], showgrid: true, gridcolor: '#f1f5f9' },
                      legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#cbd5e1', borderwidth: 1 },
                      margin: { l: 45, r: 15, t: 15, b: 40 },
                    })}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>
            </div>

            {/* Column 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card-panel">
                <h2>Size Frequency by Sex &amp; Maturity</h2>
                <div style={{ width: '100%', height: 320 }}>
                  <Plot
                    data={[
                      {
                        x: immMales.map((a) => a.cw),
                        type: 'histogram',
                        name: 'Immature Male',
                        opacity: 0.6,
                        marker: { color: '#56B4E9' },
                        nbinsx: 25,
                      },
                      {
                        x: sublegalMatMales.map((a) => a.cw),
                        type: 'histogram',
                        name: 'Sublegal Mature Male',
                        opacity: 0.6,
                        marker: { color: '#0072B2' },
                        nbinsx: 25,
                      },
                      {
                        x: legalMatMales.map((a) => a.cw),
                        type: 'histogram',
                        name: 'Legal Mature Male (≥95mm)',
                        opacity: 0.6,
                        marker: { color: '#003B73' },
                        nbinsx: 25,
                      },
                      {
                        x: immFemales.map((a) => a.cw),
                        type: 'histogram',
                        name: 'Immature Female',
                        opacity: 0.6,
                        marker: { color: '#CC79A7' },
                        nbinsx: 25,
                      },
                      {
                        x: matFemales.map((a) => a.cw),
                        y: matFemales.map(() => 1),
                        type: 'histogram',
                        name: 'Mature Female',
                        opacity: 0.6,
                        marker: { color: '#785EF0' },
                        nbinsx: 25,
                      },
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      barmode: 'overlay',
                      xaxis: { title: 'Carapace Width (mm)', range: [0, 165], showgrid: true, gridcolor: '#f1f5f9' },
                      yaxis: { title: 'Organisms', showgrid: true, gridcolor: '#f1f5f9' },
                      shapes: [
                        {
                          type: 'line',
                          x0: legalSize,
                          x1: legalSize,
                          y0: 0,
                          y1: 1,
                          yref: 'paper',
                          line: { color: '#dc2626', width: 2, dash: 'dash' },
                        },
                      ],
                      annotations: [
                        {
                          x: legalSize,
                          y: 0.95,
                          yref: 'paper',
                          text: `Legal (${legalSize} mm)`,
                          font: { color: '#dc2626', size: 10 },
                          showarrow: false,
                        },
                      ],
                      legend: { x: 0.65, y: 0.98, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#cbd5e1', borderwidth: 1 },
                      margin: { l: 45, r: 15, t: 15, b: 40 },
                    })}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>

              <div className="card-panel">
                <h2>Carapace Width Composition by Cohort</h2>
                <div style={{ width: '100%', height: 320 }}>
                  <Plot
                    data={[
                      {
                        x: agents.map((a) => STAGE_LABELS[Math.min(19, a.stage || 4)]),
                        y: agents.map((a) => a.cw),
                        type: 'box',
                        boxpoints: 'all',
                        jitter: 0.3,
                        pointpos: -1.8,
                        marker: { size: 4, color: '#1e3a8a' },
                        name: 'CW Distribution',
                      },
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      xaxis: { title: 'Stage', tickangle: -45, showgrid: true, gridcolor: '#f1f5f9' },
                      yaxis: { title: 'Carapace Width (mm)', showgrid: true, gridcolor: '#f1f5f9' },
                      margin: { l: 45, r: 15, t: 15, b: 65 },
                    })}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 4: Assessment & Calibration */}
        {/* ================================================================== */}
        {activeTab === 4 && (
          <div>
            {/* Top Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => step(365)}
                  style={{
                    background: '#1e3a8a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 5,
                    padding: '6px 14px',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Refit Macro
                </button>
                <span style={{ fontSize: 12, color: '#475569' }}>
                  Calibrate Schaefer surplus production, Delay-Difference, and Beverton-Holt / Ricker stock-recruitment models.
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Annual survey series: <strong>{annual.length} years</strong>
              </div>
            </div>

            <div className="tab4-grid">
              {/* S-R Diagnostics */}
              <div className="card-panel">
                <h2>Stock-Recruitment Relationship (Male Component)</h2>
                <div style={{ width: '100%', height: 380 }}>
                  <Plot
                    data={[
                      {
                        x: srFits ? srFits.spawners.map((s) => Math.log10(s)) : history.map((r) => Math.log10(Math.max(1, r.mature_females))),
                        y: srFits ? srFits.recruits.map((r) => Math.log10(r)) : history.map((r) => Math.log10(Math.max(1, r.stage_counts?.[13] || 1))),
                        type: 'scatter',
                        mode: 'markers',
                        name: 'Observed Pairs',
                        marker: { color: '#0284c7', size: 9, line: { color: '#1e3a8a', width: 1.5 } },
                      },
                      ...(srFits?.fits?.isFitted
                        ? [
                            {
                              x: srFits.sCurve.map((s) => Math.log10(s)),
                              y: srFits.rkCurve.map((r) => Math.log10(Math.max(1e-3, r))),
                              type: 'scatter',
                              mode: 'lines',
                              name: `Ricker: R = ${srFits.fits.ricker.alpha.toFixed(2)}·S·exp(-${srFits.fits.ricker.beta.toExponential(2)}·S) (R²=${srFits.fits.ricker.r2.toFixed(2)})`,
                              line: { color: '#f59e0b', width: 2.5 },
                            },
                            {
                              x: srFits.sCurve.map((s) => Math.log10(s)),
                              y: srFits.bhCurve.map((r) => Math.log10(Math.max(1e-3, r))),
                              type: 'scatter',
                              mode: 'lines',
                              name: `Beverton-Holt: R = ${srFits.fits.bevertonHolt.alpha.toFixed(2)}·S / (1 + ${srFits.fits.bevertonHolt.beta.toExponential(2)}·S) (R²=${srFits.fits.bevertonHolt.r2.toFixed(2)})`,
                              line: { color: '#16a34a', width: 2.5, dash: 'dash' },
                            },
                          ]
                        : []),
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      title: {
                        text: srFits?.fits?.isFitted
                          ? `Preferred Model: ${srFits.fits.bestModel === 'ricker' ? 'Ricker' : 'Beverton-Holt'}`
                          : 'Awaiting multi-year annual recruitment data',
                        font: { size: 12, color: '#334155' },
                      },
                      xaxis: { title: 'log10(Annual Eggs / 2)', showgrid: true, gridcolor: '#e2e8f0' },
                      yaxis: { title: 'log10(Males at Recruitment Stage)', showgrid: true, gridcolor: '#e2e8f0' },
                      legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#cbd5e1', borderwidth: 1 },
                      margin: { l: 45, r: 15, t: 35, b: 35 },
                    })}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>

              {/* Biomass, Catch & Macro-Models */}
              <div className="card-panel">
                <h2>Biomass, Catch &amp; Stock Assessment Model Fits</h2>
                <div style={{ width: '100%', height: 380 }}>
                  <Plot
                    data={[
                      {
                        x: history.map((r) => r.day),
                        y: history.map((r) => r.legal_biomass_kg),
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Fishable Biomass (kg)',
                        line: { color: '#0284c7', width: 2 },
                      },
                      {
                        x: history.map((r) => r.day),
                        y: history.map((r) => r.catch_total * 0.45),
                        type: 'scatter',
                        mode: 'lines',
                        name: 'Cumulative Catch (kg)',
                        line: { color: '#d97706', width: 2 },
                      },
                      ...(macroFits?.schaefer?.isFitted
                        ? [
                            {
                              x: macroFits.times.map((t) => t * 365),
                              y: macroFits.schaefer.predicted,
                              type: 'scatter',
                              mode: 'lines+markers',
                              name: `Schaefer (r=${macroFits.schaefer.r.toFixed(2)}, K=${macroFits.schaefer.K.toFixed(0)}, R²=${macroFits.schaefer.r2.toFixed(2)})`,
                              line: { color: '#16a34a', width: 2, dash: 'dot' },
                            },
                          ]
                        : []),
                      ...(macroFits?.delayDiff?.isFitted
                        ? [
                            {
                              x: macroFits.times.map((t) => t * 365),
                              y: macroFits.delayDiff.predicted,
                              type: 'scatter',
                              mode: 'lines+markers',
                              name: `Delay-Diff (s=${macroFits.delayDiff.s.toFixed(2)}, R²=${macroFits.delayDiff.r2.toFixed(2)})`,
                              line: { color: '#db2777', width: 2, dash: 'dashdot' },
                            },
                          ]
                        : []),
                    ]}
                    layout={lightPlotLayout({
                      autosize: true,
                      xaxis: { title: 'Simulation Time (days)', showgrid: true, gridcolor: '#e2e8f0' },
                      yaxis: { title: 'Biomass (kg) / Catch', showgrid: true, gridcolor: '#e2e8f0' },
                      legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#cbd5e1', borderwidth: 1 },
                      margin: { l: 45, r: 15, t: 15, b: 35 },
                    })}
                    useResizeHandler
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>
            </div>

            {/* Full Width Table: Annual Production Summary */}
            <div className="card-panel" style={{ marginTop: 16 }}>
              <h2>Annual Production Summary</h2>
              {annual.length === 0 ? (
                <div style={{ padding: 14, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
                  No annual production cycles completed yet. Run the simulation for at least 1 year (365 days).
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Day</th>
                        <th>Legal Biomass (kg)</th>
                        <th>Total Biomass (kg)</th>
                        <th>Annual Catch (kg)</th>
                        <th>Male Recruits</th>
                        <th>Eggs Extruded</th>
                        <th>Mean CW (mm)</th>
                        <th>Harvest Rate F</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annual.map((row) => (
                        <tr key={row.year}>
                          <td>{row.year}</td>
                          <td>{row.day}</td>
                          <td>{(row.legal_biomass_kg || 0).toFixed(1)}</td>
                          <td>{(row.biomass_kg || 0).toFixed(1)}</td>
                          <td>{(row.annual_catch_kg || 0).toFixed(1)}</td>
                          <td>{row.recruits || 0}</td>
                          <td>{(row.spawners * 2 || 0).toLocaleString()}</td>
                          <td>{(row.mean_cw || 0).toFixed(1)}</td>
                          <td>{(row.f_rate || 0).toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
