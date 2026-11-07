import React from 'react';
import Plot from 'react-plotly.js';
import { useStore } from '../store/simulationStore.js';

const LONGITUDES = Array.from({ length: 32 }, (_, i) => -66.5 + (9 * i) / 31);
const LATITUDES = Array.from({ length: 24 }, (_, i) => 42 + (6.5 * i) / 23);
const BATHYMETRY_POINTS = LATITUDES.flatMap((latitude) =>
  LONGITUDES.map((longitude) => ({
    longitude,
    latitude,
    depth: 90 + 28 * Math.abs(latitude - 45) + 10 * Math.abs(longitude + 60),
  })),
);

function temperatureAt(latitude, depth) {
  return 2 + 2.5 * Math.exp(-(((depth - 150) / 60) ** 2)) + 0.3 * (45 - latitude);
}

function suitabilityAt(latitude, depth) {
  const temperature = temperatureAt(latitude, depth);
  return Math.exp(-0.5 * ((temperature - 2) / 2.2) ** 2) *
    Math.exp(-0.5 * ((depth - 150) / 75) ** 2);
}

export default function Environment() {
  const { aoi, setAOI } = useStore();
  const clickMap = (event) => {
    const point = event.points?.[0];
    if (point && Number.isFinite(point.lon) && Number.isFinite(point.lat)) {
      setAOI({ longitude: point.lon, latitude: point.lat });
    }
  };
  const update = (key) => (event) => setAOI({ [key]: Number(event.target.value) });
  const viewportDepths = BATHYMETRY_POINTS.map((point) => point.depth);
  const viewportTemps = BATHYMETRY_POINTS.map((point) => temperatureAt(point.latitude, point.depth));
  const viewportHSI = BATHYMETRY_POINTS.map((point) => suitabilityAt(point.latitude, point.depth));
  const pointTemperature = temperatureAt(aoi.latitude, aoi.depth);
  const traces = BATHYMETRY_POINTS.map((point) => point.depth);

  return (
    <div className="card">
      <h2>Environmental Data and AOI</h2>
      <p>Click the map to select a location. The plotted bathymetry is illustrative until local data are added.</p>
      <Plot
        data={[
          {
            type: 'scattergeo',
            lon: BATHYMETRY_POINTS.map((point) => point.longitude),
            lat: BATHYMETRY_POINTS.map((point) => point.latitude),
            mode: 'markers',
            marker: {
              size: 6,
              color: traces,
              colorscale: 'Blues',
              reversescale: true,
              colorbar: { title: 'Depth (m)' },
              opacity: 0.75,
            },
            name: 'Illustrative bathymetry',
            hovertemplate: 'Lon %{lon:.2f}°<br>Lat %{lat:.2f}°<br>Depth %{marker.color:.0f} m<extra></extra>',
          },
          {
            type: 'scattergeo',
            lon: [aoi.longitude],
            lat: [aoi.latitude],
            mode: 'markers',
            marker: { size: 14, color: 'red', symbol: 'star' },
            name: 'Selected AOI',
          },
        ]}
        layout={{
          title: 'Area of Interest (AOI) Selection',
          geo: {
            scope: 'north america',
            showcoastlines: true,
            coastlinecolor: '#475569',
            showland: true,
            landcolor: '#cbd5e1',
            showocean: true,
            oceancolor: '#e0f2fe',
            lonaxis: { range: [-66.5, -57.5] },
            lataxis: { range: [42, 48.5] },
          },
          margin: { l: 8, r: 8, t: 42, b: 8 },
          height: 420,
        }}
        onClick={clickMap}
        useResizeHandler
        style={{ width: '100%', height: 420 }}
      />
      <div className="grid">
        <label>Longitude
          <input type="number" min="-66.5" max="-57.5" step="0.01" value={aoi.longitude} onChange={update('longitude')} />
        </label>
        <label>Latitude
          <input type="number" min="42" max="48.5" step="0.01" value={aoi.latitude} onChange={update('latitude')} />
        </label>
        <label>Depth (m)
          <input type="number" min="0" max="1000" step="1" value={aoi.depth} onChange={update('depth')} />
        </label>
      </div>
      <p>Selected: {aoi.latitude.toFixed(2)}° N, {Math.abs(aoi.longitude).toFixed(2)}° W ·
        Bottom temperature {pointTemperature.toFixed(2)} °C · HSI {suitabilityAt(aoi.latitude, aoi.depth).toFixed(3)}
      </p>
      <h3>Environmental distributions across the viewport</h3>
      <div className="grid">
        {[
          ['Depth (m)', viewportDepths, '#2563eb'],
          ['Bottom temperature (°C)', viewportTemps, '#ea580c'],
          ['Habitat suitability index', viewportHSI, '#16a34a'],
        ].map(([title, values, color]) => (
          <Plot
            key={title}
            data={[{ x: values, type: 'histogram', marker: { color } }]}
            layout={{ title, margin: { l: 42, r: 12, t: 40, b: 40 }, height: 250 }}
            useResizeHandler
            style={{ width: '100%', height: 250 }}
          />
        ))}
      </div>
    </div>
  );
}
