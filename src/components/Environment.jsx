import React from 'react';
import Plot from 'react-plotly.js';
import { useStore } from '../store/simulationStore.js';
import { bottomTemperature, habitatSuitability } from '../model/Analytics.js';

const LONGITUDES = Array.from({ length: 32 }, (_, i) => -66.5 + (9 * i) / 31);
const LATITUDES = Array.from({ length: 24 }, (_, i) => 42 + (6.5 * i) / 23);
const BATHYMETRY_POINTS = LATITUDES.flatMap((latitude) =>
  LONGITUDES.map((longitude) => ({
    longitude,
    latitude,
    depth: 90 + 28 * Math.abs(latitude - 45) + 10 * Math.abs(longitude + 60),
  })),
);

export default function Environment() {
  const { aoi, setAOI, exclusionBoxes, setExclusionBox, clearExclusionBoxes, model } = useStore();
  const mpa = exclusionBoxes?.[0] || { xmin: 25, xmax: 55, ymin: 25, ymax: 55, active: true };

  const clickMap = (event) => {
    const point = event.points?.[0];
    if (point && Number.isFinite(point.lon) && Number.isFinite(point.lat)) {
      const depth = Math.round(90 + 28 * Math.abs(point.lat - 45) + 10 * Math.abs(point.lon + 60));
      setAOI({ longitude: point.lon, latitude: point.lat, depth });
    }
  };

  const updateAoi = (key) => (event) => setAOI({ [key]: Number(event.target.value) });
  const updateMpa = (key) => (event) => {
    const val = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
    setExclusionBox({ [key]: val });
  };

  const pointTemperature = bottomTemperature(aoi.depth, aoi.latitude);
  const pointHSI = habitatSuitability(pointTemperature, aoi.depth);

  const viewportDepths = BATHYMETRY_POINTS.map((p) => p.depth);
  const viewportTemps = BATHYMETRY_POINTS.map((p) => bottomTemperature(p.depth, p.latitude));
  const viewportHSI = BATHYMETRY_POINTS.map((p) =>
    habitatSuitability(bottomTemperature(p.depth, p.latitude), p.depth),
  );

  return (
    <div className="card">
      <h2>Environmental Domain &amp; Marine Protected Area (MPA)</h2>
      <p>
        Click the map to relocate the Area of Interest (AOI) on the Scotian Shelf.
        Environmental drivers dynamically condition demographic rates, molting increments,
        and directed movement taxis.
      </p>

      <Plot
        data={[
          {
            type: 'scattergeo',
            lon: BATHYMETRY_POINTS.map((p) => p.longitude),
            lat: BATHYMETRY_POINTS.map((p) => p.latitude),
            mode: 'markers',
            marker: {
              size: 6,
              color: viewportDepths,
              colorscale: 'Blues',
              reversescale: true,
              colorbar: { title: 'Depth (m)' },
              opacity: 0.75,
            },
            name: 'Scotian Shelf Bathymetry',
            hovertemplate: 'Lon %{lon:.2f}°<br>Lat %{lat:.2f}°<br>Depth %{marker.color:.0f} m<extra></extra>',
          },
          {
            type: 'scattergeo',
            lon: [aoi.longitude],
            lat: [aoi.latitude],
            mode: 'markers',
            marker: { size: 14, color: '#f59e0b', symbol: 'star' },
            name: 'Active AOI',
          },
        ]}
        layout={{
          title: 'Scotian Shelf &amp; Gulf of St. Lawrence Bathymetry',
          paper_bgcolor: '#1e293b',
          plot_bgcolor: '#0f172a',
          font: { color: '#e2e8f0' },
          geo: {
            scope: 'north america',
            showcoastlines: true,
            coastlinecolor: '#475569',
            showland: true,
            landcolor: '#334155',
            showocean: true,
            oceancolor: '#0f172a',
            lonaxis: { range: [-57.5, -66.5] },
            lataxis: { range: [42, 48.5] },
          },
          margin: { l: 8, r: 8, t: 36, b: 8 },
          height: 380,
        }}
        onClick={clickMap}
        useResizeHandler
        style={{ width: '100%', height: 380 }}
      />

      <div className="grid" style={{ marginTop: 12 }}>
        <label>
          Longitude (°W)
          <input
            type="number"
            min="-66.5"
            max="-57.5"
            step="0.05"
            value={aoi.longitude}
            onChange={updateAoi('longitude')}
          />
        </label>
        <label>
          Latitude (°N)
          <input
            type="number"
            min="42"
            max="48.5"
            step="0.05"
            value={aoi.latitude}
            onChange={updateAoi('latitude')}
          />
        </label>
        <label>
          Depth (m)
          <input
            type="number"
            min="20"
            max="800"
            step="5"
            value={aoi.depth}
            onChange={updateAoi('depth')}
          />
        </label>
      </div>

      <p style={{ marginTop: 8 }}>
        Selected AOI: <strong>{aoi.latitude.toFixed(2)}° N, {Math.abs(aoi.longitude).toFixed(2)}° W</strong> ·
        Bottom Temperature: <strong>{pointTemperature.toFixed(2)} °C</strong> ·
        Habitat Suitability: <strong>{pointHSI.toFixed(3)}</strong>
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Marine Protected Area (ExclusionBox) Spatial Settings</h3>
        <p>
          Organisms inside this bounding box are fully protected from commercial fishing
          mortality, establishing a harvest refuge for spawning stock biomass.
        </p>
        <div className="grid">
          <label>
            <input
              type="checkbox"
              checked={mpa.active}
              onChange={updateMpa('active')}
              style={{ width: 'auto', marginRight: 6 }}
            />
            MPA Active (Fishing Excluded)
          </label>
          <label>
            Grid X Min
            <input
              type="number"
              min="0"
              max={model?.gridSize || 100}
              value={mpa.xmin}
              onChange={updateMpa('xmin')}
            />
          </label>
          <label>
            Grid X Max
            <input
              type="number"
              min="0"
              max={model?.gridSize || 100}
              value={mpa.xmax}
              onChange={updateMpa('xmax')}
            />
          </label>
          <label>
            Grid Y Min
            <input
              type="number"
              min="0"
              max={model?.gridSize || 100}
              value={mpa.ymin}
              onChange={updateMpa('ymin')}
            />
          </label>
          <label>
            Grid Y Max
            <input
              type="number"
              min="0"
              max={model?.gridSize || 100}
              value={mpa.ymax}
              onChange={updateMpa('ymax')}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="secondary"
            onClick={() => setExclusionBox({ xmin: 25, xmax: 55, ymin: 25, ymax: 55, active: true })}
          >
            Reset Gully MPA Default
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => clearExclusionBoxes()}
          >
            Clear MPA
          </button>
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>Regional Viewport Environmental Distributions</h3>
      <div className="grid">
        {[
          ['Bathymetric Depth (m)', viewportDepths, '#2563eb'],
          ['Bottom Temperature (°C)', viewportTemps, '#f97316'],
          ['Habitat Suitability (HSI)', viewportHSI, '#22c55e'],
        ].map(([title, values, color]) => (
          <Plot
            key={title}
            data={[{ x: values, type: 'histogram', marker: { color } }]}
            layout={{
              title: { text: title, font: { size: 11, color: '#cbd5e1' } },
              paper_bgcolor: '#1e293b',
              plot_bgcolor: '#0f172a',
              font: { color: '#e2e8f0', size: 9 },
              margin: { l: 36, r: 12, t: 30, b: 30 },
              height: 200,
            }}
            useResizeHandler
            style={{ width: '100%', height: 200 }}
          />
        ))}
      </div>
    </div>
  );
}
