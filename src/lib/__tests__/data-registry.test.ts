import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BoundingBox, Point } from '@/lib/geometry-utils';

// Mock OGC client
vi.mock('@/lib/ogc-client', () => ({
  createOgcClient: vi.fn(() => ({
    getItemsWithCount: vi.fn(),
    getItems: vi.fn(),
    getCollections: vi.fn(),
    getFeature: vi.fn(),
  })),
}));

// Mock sgu-client (WMS queries)
vi.mock('@/clients/sgu-client', () => ({
  sguClient: {
    getRadonRiskAt: vi.fn(),
    getSoilDepthAt: vi.fn(),
    getGroundwaterVulnerabilityAt: vi.fn(),
    getLandslideAt: vi.fn(),
  },
}));

import { queryAll } from '../data-registry';
import { createOgcClient } from '@/lib/ogc-client';
import { sguClient } from '@/clients/sgu-client';

// ============================================================================
// Test data
// ============================================================================

const mockBedrockFeature = {
  type: 'Feature',
  id: 'bedrock-1',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [18.0, 59.3],
        [18.01, 59.3],
        [18.01, 59.31],
        [18.0, 59.31],
        [18.0, 59.3],
      ],
    ],
  },
  properties: {
    objectid: 1,
    geo_enh_tx: 'Örö',
    bergart_tx: 'Granit',
    lito_n_tx: 'Granit, grovkornig',
    tekt_n_tx: 'Svekofennicum',
    b_prop_tx: 'Massiv',
    geom_area: 10000,
  },
};

const mockSoilFeature = {
  type: 'Feature',
  id: 'soil-1',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [18.0, 59.3],
        [18.01, 59.3],
        [18.01, 59.31],
        [18.0, 59.3],
      ],
    ],
  },
  properties: { jg2_tx: 'Morän', jg2: 'Mo', geom_area: 5000 },
};

// WGS84 bbox: minX=minLon, minY=minLat
const southernBbox: BoundingBox = { minX: 17.95, minY: 59.25, maxX: 18.05, maxY: 59.35 };
const northernBbox: BoundingBox = { minX: 17.95, minY: 65.4, maxX: 18.05, maxY: 65.6 };

const stockholmSweref99: Point = { x: 674553, y: 6580992 };

// Stockholm in WGS84 is roughly (59.33, 18.07); this polygon contains it, mockSoilFeature does not
const mockSoilFeatureAtStockholm = {
  type: 'Feature',
  id: 'soil-at-point',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [18.05, 59.32],
        [18.09, 59.32],
        [18.09, 59.34],
        [18.05, 59.34],
        [18.05, 59.32],
      ],
    ],
  },
  properties: { jg2_tx: 'Postglacial sand', jg2: '31', kartering: 'uppsalaasen', geom_area: 438620 },
};

// ============================================================================
// Helpers
// ============================================================================

function getMockOgcClient(features: Record<string, unknown>[], numberMatched = 100) {
  return {
    getItemsWithCount: vi.fn().mockResolvedValue({ features, numberMatched }),
    getItems: vi.fn(),
    getCollections: vi.fn(),
    getFeature: vi.fn(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('queryAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OGC types', () => {
    it('dispatches bedrock to OGC with correct collection', async () => {
      const mockClient = getMockOgcClient([mockBedrockFeature]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      const { results, errors } = await queryAll(['bedrock'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(errors).toEqual({});
      expect(results.bedrock).toHaveLength(1);
      const feature = (results.bedrock as Record<string, unknown>[])[0];
      expect(feature.rock_type).toBe('Granit');
      expect(feature.geological_unit).toBe('Örö');
      expect(mockClient.getItemsWithCount).toHaveBeenCalledWith(
        'geologisk-enhet-yta',
        expect.objectContaining({ bbox: southernBbox, limit: 50 }),
      );
    });

    it('dispatches soil_type to correct collection', async () => {
      const mockClient = getMockOgcClient([mockSoilFeature]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      const { results } = await queryAll(['soil_type'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(results.soil_type).toHaveLength(1);
      expect(mockClient.getItemsWithCount).toHaveBeenCalledWith('grundlager', expect.any(Object));
    });

    it('uses jordarter250k for northern Sweden (centerLat > 65.1)', async () => {
      const mockClient = getMockOgcClient([mockSoilFeature]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      await queryAll(['soil_type'], [northernBbox], [stockholmSweref99], 50, 'simplified');

      // createOgcClient should have been called with the 250k workspace
      expect(createOgcClient).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: expect.stringContaining('jordarter250k') }),
      );
    });

    it('uses jordarter25k-100k for southern Sweden (centerLat <= 65.1)', async () => {
      const mockClient = getMockOgcClient([mockSoilFeature]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      await queryAll(['soil_type'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(createOgcClient).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: expect.stringContaining('jordarter25k-100k') }),
      );
    });

    it('marks the area features that contain a query point and lists them first', async () => {
      const mockClient = getMockOgcClient([mockSoilFeature, mockSoilFeatureAtStockholm]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      const { results } = await queryAll(['soil_type'], [southernBbox], [stockholmSweref99], 50, 'none');

      const features = results.soil_type as Record<string, unknown>[];
      expect(features.map((feature) => feature.id)).toEqual(['soil-at-point', 'soil-1']);
      expect(features[0].at_query_points).toEqual([0]);
      expect(features[1]).not.toHaveProperty('at_query_points');
    });

    it('applies geometry simplification to OGC features', async () => {
      const mockClient = getMockOgcClient([mockBedrockFeature]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      const { results } = await queryAll(['bedrock'], [southernBbox], [stockholmSweref99], 50, 'none');

      const feature = (results.bedrock as Record<string, unknown>[])[0];
      expect(feature.geometry).toBeUndefined();
    });

    it('dispatches wells to brunnar collection', async () => {
      const mockClient = getMockOgcClient([]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      await queryAll(['wells'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(mockClient.getItemsWithCount).toHaveBeenCalledWith('brunnar', expect.any(Object));
    });

    it('dispatches soil_layers to lagerinformation collection', async () => {
      const mockClient = getMockOgcClient([]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      await queryAll(['soil_layers'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(mockClient.getItemsWithCount).toHaveBeenCalledWith('lagerinformation', expect.any(Object));
    });

    it('dispatches groundwater_aquifers to grundvattenmagasin collection', async () => {
      const mockClient = getMockOgcClient([]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);

      await queryAll(['groundwater_aquifers'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(mockClient.getItemsWithCount).toHaveBeenCalledWith('grundvattenmagasin', expect.any(Object));
    });
  });

  describe('WMS types', () => {
    it('dispatches radon_risk to sguClient.getRadonRiskAt', async () => {
      vi.mocked(sguClient.getRadonRiskAt).mockResolvedValue({ radiation_value: 2.5, risk_level: 'low' });

      const { results, errors } = await queryAll(['radon_risk'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(errors).toEqual({});
      expect(results.radon_risk).toHaveLength(1);
      expect(sguClient.getRadonRiskAt).toHaveBeenCalledWith(stockholmSweref99);
    });

    it('dispatches soil_depth to sguClient.getSoilDepthAt', async () => {
      vi.mocked(sguClient.getSoilDepthAt).mockResolvedValue({ depth_class: '5 m' });

      const { results } = await queryAll(['soil_depth'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(results.soil_depth).toHaveLength(1);
      expect(sguClient.getSoilDepthAt).toHaveBeenCalledWith(stockholmSweref99);
    });

    it('dispatches groundwater_vulnerability to sguClient', async () => {
      vi.mocked(sguClient.getGroundwaterVulnerabilityAt).mockResolvedValue({ vulnerability_class: 'low' });

      const { results } = await queryAll(['groundwater_vulnerability'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(results.groundwater_vulnerability).toHaveLength(1);
    });

    it('dispatches landslide to sguClient.getLandslideAt', async () => {
      vi.mocked(sguClient.getLandslideAt).mockResolvedValue({ description: 'Skredärr' });

      const { results } = await queryAll(['landslide'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(results.landslide).toHaveLength(1);
    });

    it('fires WMS query for each point (multi-point)', async () => {
      const point2: Point = { x: 675000, y: 6581000 };
      vi.mocked(sguClient.getRadonRiskAt).mockResolvedValue({ radiation_value: 3.0, risk_level: 'moderate' });

      const { results } = await queryAll(['radon_risk'], [southernBbox], [stockholmSweref99, point2], 50, 'simplified');

      expect(sguClient.getRadonRiskAt).toHaveBeenCalledTimes(2);
      expect(sguClient.getRadonRiskAt).toHaveBeenCalledWith(stockholmSweref99);
      expect(sguClient.getRadonRiskAt).toHaveBeenCalledWith(point2);
      expect(results.radon_risk).toHaveLength(2);
    });

    it('filters null WMS results (no-data)', async () => {
      vi.mocked(sguClient.getRadonRiskAt).mockResolvedValue(null);

      const { results } = await queryAll(['radon_risk'], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(results.radon_risk).toHaveLength(0);
    });
  });

  describe('mixed types and error handling', () => {
    it('queries multiple types in parallel', async () => {
      const mockClient = getMockOgcClient([mockBedrockFeature]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);
      vi.mocked(sguClient.getRadonRiskAt).mockResolvedValue({ radiation_value: 2.0, risk_level: 'low' });

      const { results, errors } = await queryAll(
        ['bedrock', 'radon_risk'],
        [southernBbox],
        [stockholmSweref99],
        50,
        'simplified',
      );

      expect(errors).toEqual({});
      expect(results.bedrock).toHaveLength(1);
      expect(results.radon_risk).toHaveLength(1);
    });

    it('partial failure: one type fails, others still returned', async () => {
      const mockClient = getMockOgcClient([mockBedrockFeature]);
      vi.mocked(createOgcClient).mockReturnValue(mockClient as ReturnType<typeof createOgcClient>);
      vi.mocked(sguClient.getRadonRiskAt).mockRejectedValue(new Error('WMS service unavailable'));

      const { results, errors } = await queryAll(
        ['bedrock', 'radon_risk'],
        [southernBbox],
        [stockholmSweref99],
        50,
        'simplified',
      );

      expect(results.bedrock).toHaveLength(1);
      expect(results.radon_risk).toBeUndefined();
      expect(errors.radon_risk).toBe('WMS service unavailable');
      expect(errors.bedrock).toBeUndefined();
    });

    it('returns empty results and errors when no types requested', async () => {
      const { results, errors } = await queryAll([], [southernBbox], [stockholmSweref99], 50, 'simplified');

      expect(results).toEqual({});
      expect(errors).toEqual({});
    });
  });
});
