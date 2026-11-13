import { describe, it, expect } from 'vitest';
import {
  bottomTemperature,
  habitatSuitability,
  seasonalBottomTemperatureCycle,
  fitStockRecruitment,
  fitSchaefer,
  fitDelayDifference,
} from './model/Analytics.js';

describe('Analytics - Environmental', () => {
  it('bottomTemperature returns reasonable values', () => {
    const t = bottomTemperature(150, 45, 0);
    expect(t).toBeCloseTo(2.0 + 2.5 * Math.exp(0) + 0, 2);
  });

  it('bottomTemperature increases with tempOffset', () => {
    const t1 = bottomTemperature(150, 45, 0);
    const t2 = bottomTemperature(150, 45, 1.0);
    expect(t2).toBeCloseTo(t1 + 1.0, 2);
  });

  it('habitatSuitability returns values in [0,1]', () => {
    for (let d = 10; d < 500; d += 50) {
      for (let t = -1; t < 10; t += 1) {
        const hsi = habitatSuitability(t, d);
        expect(hsi).toBeGreaterThanOrEqual(0);
        expect(hsi).toBeLessThanOrEqual(1);
      }
    }
  });

  it('habitatSuitability peaks at optimal temp/depth', () => {
    const hsiOptimal = habitatSuitability(2.0, 150);
    const hsiWarm = habitatSuitability(8.0, 150);
    const hsiShallow = habitatSuitability(2.0, 50);
    expect(hsiOptimal).toBeGreaterThan(hsiWarm);
    expect(hsiOptimal).toBeGreaterThan(hsiShallow);
  });

  it('seasonalBottomTemperatureCycle returns 365 days', () => {
    const cycle = seasonalBottomTemperatureCycle(-60, 45, 150, 0, 1.0, 80);
    expect(cycle.days.length).toBe(365);
    expect(cycle.temps.length).toBe(365);
    expect(cycle.meanT).toBeGreaterThan(-5);
    expect(cycle.meanT).toBeLessThan(10);
  });
});

describe('Analytics - Stock-Recruitment', () => {
  it('fitStockRecruitment returns unfitted for insufficient data', () => {
    const result = fitStockRecruitment([100], [50]);
    expect(result.isFitted).toBe(false);
  });

  it('fitStockRecruitment fits Beverton-Holt on perfect data', () => {
    const spawners = [100, 200, 300, 400, 500];
    const recruits = [200, 300, 375, 429, 476];
    const result = fitStockRecruitment(spawners, recruits);
    expect(result.isFitted).toBe(true);
    expect(result.bestModel).toBe('bevertonHolt');
  });

  it('fitStockRecruitment fits Ricker on perfect data', () => {
    const spawners = [100, 200, 300, 400, 500];
    const recruits = [271, 406, 448, 448, 425];
    const result = fitStockRecruitment(spawners, recruits);
    expect(result.isFitted).toBe(true);
  });
});

describe('Analytics - Surplus Production', () => {
  it('fitSchaefer returns unfitted for insufficient data', () => {
    const result = fitSchaefer([2000, 2010], [1000, 900], [100, 100]);
    expect(result.isFitted).toBe(false);
  });

  it('fitSchaefer recovers parameters from synthetic data', () => {
    const r = 0.5;
    const K = 10000;
    const catches = [100, 120, 150, 180, 200];
    const biomasses = [K * 0.9];
    for (let t = 1; t < 5; t++) {
      const growth = r * biomasses[t - 1] * (1 - biomasses[t - 1] / K);
      biomasses.push(Math.max(0, biomasses[t - 1] + growth - catches[t - 1]));
    }
    const years = [0, 1, 2, 3, 4];
    const result = fitSchaefer(years, biomasses, catches);
    expect(result.isFitted).toBe(true);
    expect(result.r).toBeGreaterThan(0.3);
    expect(result.r).toBeLessThan(0.7);
    expect(result.K).toBeGreaterThan(8000);
    expect(result.K).toBeLessThan(12000);
  });
});

describe('Analytics - Delay-Difference', () => {
  it('fitDelayDifference returns unfitted for insufficient data', () => {
    const result = fitDelayDifference([0, 1], [1000, 900], [100, 100], 1);
    expect(result.isFitted).toBe(false);
  });

  it('fitDelayDifference fits on synthetic data', () => {
    const n = [5000];
    const c = [200, 250, 300, 350, 400];
    const s = 0.8;
    const alpha = 0.3;
    const beta = 0.001;
    for (let t = 1; t < 5; t++) {
      const spawner = n[t - 1];
      const recruit = (alpha * spawner) / (1 + beta * spawner);
      const escaped = Math.max(0, n[t - 1] - c[t - 1]);
      n.push(s * escaped + recruit);
    }
    const years = [0, 1, 2, 3, 4];
    const result = fitDelayDifference(years, n, c, 1);
    expect(result.isFitted).toBe(true);
    expect(result.s).toBeGreaterThan(0.5);
    expect(result.s).toBeLessThan(1.0);
  });
});