import { describe, it, expect } from 'vitest';
import { queryAll } from '../data-registry';
import { wgs84ToSweref99 } from '@/lib/coordinates';
import type { BoundingBox, Point } from '@/lib/geometry-utils';

// Stockholm area in WGS84: minX=minLon, minY=minLat
const stockholmBbox: BoundingBox = {
  minX: 18.0,
  minY: 59.3,
  maxX: 18.1,
  maxY: 59.35,
};

const stockholmSweref99: Point = wgs84ToSweref99({ latitude: 59.33, longitude: 18.07 });

// Trollhättan/Lilla Edet area — known landslide zone
const landslideSweref99: Point = wgs84ToSweref99({ latitude: 57.98, longitude: 12.08 });
const landslideBbox: BoundingBox = { minX: 12.06, minY: 57.96, maxX: 12.1, maxY: 58.0 };

describe('data-registry integration (real API)', { timeout: 60000 }, () => {
  describe('single point Stockholm — mixed OGC + WMS', () => {
    it('returns bedrock features with rock_type', async () => {
      const { results, errors } = await queryAll(['bedrock'], [stockholmBbox], [stockholmSweref99], 5, 'simplified');

      expect(errors.bedrock).toBeUndefined();
      const features = results.bedrock as Record<string, unknown>[];
      expect(features.length).toBeGreaterThan(0);
      expect(typeof features[0].rock_type).toBe('string');
      expect((features[0].rock_type as string).length).toBeGreaterThan(0);
    });

    it('returns soil_type features', async () => {
      const { results, errors } = await queryAll(['soil_type'], [stockholmBbox], [stockholmSweref99], 5, 'simplified');

      expect(errors.soil_type).toBeUndefined();
      const features = results.soil_type as Record<string, unknown>[];
      expect(features.length).toBeGreaterThan(0);
      expect(typeof features[0].soil_type).toBe('string');
    });

    it('returns radon_risk data with valid radiation_value', async () => {
      const { results, errors } = await queryAll(['radon_risk'], [stockholmBbox], [stockholmSweref99], 5, 'simplified');

      expect(errors.radon_risk).toBeUndefined();
      const data = results.radon_risk as Record<string, unknown>[];
      expect(data.length).toBeGreaterThan(0);
      const radon = data[0] as { radiation_value?: number; risk_level?: string };
      if (radon.radiation_value !== undefined) {
        expect(radon.radiation_value).toBeGreaterThanOrEqual(0);
        expect(radon.radiation_value).toBeLessThanOrEqual(100);
      }
    });

    it('returns soil_depth data', async () => {
      const { results, errors } = await queryAll(['soil_depth'], [stockholmBbox], [stockholmSweref99], 5, 'simplified');

      expect(errors.soil_depth).toBeUndefined();
      const data = results.soil_depth as Record<string, unknown>[];
      expect(data.length).toBeGreaterThan(0);
      const depth = data[0] as { depth_class?: string };
      if (depth.depth_class !== undefined) {
        expect(depth.depth_class).not.toContain('255');
      }
    });

    it('returns groundwater_vulnerability data', async () => {
      const { results, errors } = await queryAll(
        ['groundwater_vulnerability'],
        [stockholmBbox],
        [stockholmSweref99],
        5,
        'simplified',
      );

      expect(errors.groundwater_vulnerability).toBeUndefined();
      const data = results.groundwater_vulnerability as Record<string, unknown>[];
      expect(data.length).toBeGreaterThan(0);
      const gw = data[0] as { vulnerability_class?: string };
      expect(gw.vulnerability_class).toBeDefined();
    });
  });

  describe('landslide with 2km buffer', () => {
    it('returns landslide data at known landslide zone (Trollhättan/Lilla Edet)', async () => {
      const { results, errors } = await queryAll(['landslide'], [landslideBbox], [landslideSweref99], 5, 'simplified');

      expect(errors.landslide).toBeUndefined();
      const data = results.landslide as Record<string, unknown>[];
      // With 2km buffer, should find landslide data in this known zone
      expect(data.length).toBeGreaterThan(0);
      const landslide = data[0] as { description?: string };
      expect(landslide.description).toBeDefined();
    });
  });

  describe('each OGC type returns features at Stockholm', () => {
    it('groundwater_aquifers returns features', async () => {
      const { results, errors } = await queryAll(
        ['groundwater_aquifers'],
        [stockholmBbox],
        [stockholmSweref99],
        5,
        'simplified',
      );

      expect(errors.groundwater_aquifers).toBeUndefined();
      const features = results.groundwater_aquifers as Record<string, unknown>[];
      expect(features.length).toBeGreaterThan(0);
      expect(typeof features[0].aquifer_type).toBe('string');
    });

    it('wells returns features with well_id', async () => {
      const { results, errors } = await queryAll(['wells'], [stockholmBbox], [stockholmSweref99], 5, 'simplified');

      expect(errors.wells).toBeUndefined();
      const features = results.wells as Record<string, unknown>[];
      expect(features.length).toBeGreaterThan(0);
      expect(typeof features[0].well_id).toBe('number');
    });

    it('soil_layers returns features with layer_number', async () => {
      const { results, errors } = await queryAll(['soil_layers'], [stockholmBbox], [stockholmSweref99], 5, 'simplified');

      expect(errors.soil_layers).toBeUndefined();
      const features = results.soil_layers as Record<string, unknown>[];
      expect(features.length).toBeGreaterThan(0);
      expect(typeof features[0].layer_number).toBe('number');
    });
  });

  describe('multi-point corridor', () => {
    it('radon values from multiple points along a corridor', async () => {
      // 3 points spread across Stockholm
      const points: Point[] = [
        wgs84ToSweref99({ latitude: 59.3, longitude: 18.05 }),
        wgs84ToSweref99({ latitude: 59.33, longitude: 18.07 }),
        wgs84ToSweref99({ latitude: 59.36, longitude: 18.09 }),
      ];

      const { results, errors } = await queryAll(['radon_risk'], [stockholmBbox], points, 5, 'simplified');

      expect(errors.radon_risk).toBeUndefined();
      const data = results.radon_risk as Record<string, unknown>[];
      // Should get results for multiple points (some may be null-filtered)
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('partial failure', () => {
    it('one type errors, others still succeed', async () => {
      // Use a valid type alongside an impossible-to-fail type
      // We can't easily force a real API failure, but we can verify the
      // structure handles mixed results by querying multiple types
      const { results, errors } = await queryAll(
        ['bedrock', 'soil_type'],
        [stockholmBbox],
        [stockholmSweref99],
        5,
        'simplified',
      );

      // Both should succeed in a real environment
      const bedrockFeatures = results.bedrock as Record<string, unknown>[];
      const soilFeatures = results.soil_type as Record<string, unknown>[];
      expect(bedrockFeatures.length).toBeGreaterThan(0);
      expect(soilFeatures.length).toBeGreaterThan(0);
      // No errors expected when APIs are available
      expect(Object.keys(errors).length).toBe(0);
    });
  });

  describe('WGS84 coordinates in OGC geometry response', () => {
    it('bedrock geometry coordinates are WGS84, not SWEREF99TM', async () => {
      const { results } = await queryAll(['bedrock'], [stockholmBbox], [stockholmSweref99], 3, 'simplified');

      const features = results.bedrock as Record<string, unknown>[];
      expect(features.length).toBeGreaterThan(0);

      for (const feature of features) {
        const geom = feature.geometry as { type: string; coordinates: unknown } | undefined;
        if (!geom) continue;

        let rings: number[][][] = [];
        if (geom.type === 'Polygon') {
          rings = geom.coordinates as number[][][];
        } else if (geom.type === 'MultiPolygon') {
          for (const poly of geom.coordinates as number[][][][]) {
            rings.push(...poly);
          }
        }

        for (const ring of rings) {
          for (const coord of ring) {
            const lon = coord[0];
            const lat = coord[1];
            // WGS84 Sweden: lon ~11-25, lat ~55-70
            expect(lon).toBeGreaterThan(10);
            expect(lon).toBeLessThan(25);
            expect(lat).toBeGreaterThan(54);
            expect(lat).toBeLessThan(71);
            // Definitely NOT SWEREF99TM (would be >200000)
            expect(lon).toBeLessThan(1000);
          }
        }
      }
    });
  });

  describe('point containment — Ångströmlaboratoriet, Uppsala', () => {
    // Reference: SGU jordartskartan 25K, kartering uppsalaasen, verified 2026-08-23 (Postglacial sand at the point)
    const angstromWgs84 = { latitude: 59.8397, longitude: 17.6469 };
    const angstromSweref99: Point = wgs84ToSweref99(angstromWgs84);
    const angstromBbox: BoundingBox = { minX: 17.643, minY: 59.838, maxX: 17.651, maxY: 59.842 };

    it('marks exactly the soil unit that contains the point and lists it first', async () => {
      const { results, errors } = await queryAll(['soil_type'], [angstromBbox], [angstromSweref99], 50, 'none');

      expect(errors.soil_type).toBeUndefined();
      const features = results.soil_type as Record<string, unknown>[];
      const containing = features.filter((feature) => feature.at_query_points !== undefined);
      expect(containing).toHaveLength(1);
      expect(features[0]).toBe(containing[0]);
      expect(containing[0]).toMatchObject({ soil_type: 'Postglacial sand', mapping_id: 'uppsalaasen', at_query_points: [0] });
    });
  });
});
