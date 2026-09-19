import { createOgcClient } from '@/lib/ogc-client';
import { geometryContainsPoint, simplifyGeometry, type BoundingBox, type LonLat, type Point } from '@/lib/geometry-utils';
import { sweref99ToWgs84 } from '@/lib/coordinates';
import type { GeoJsonFeature, GeoJsonGeometry } from '@/types/geojson';
import type { DataType, GeometryDetail } from '@/types/common-schemas';
import {
  transformBedrockFeature,
  transformSoilFeature,
  transformAquiferFeature,
  transformWellFeature,
  transformSoilLayerFeature,
} from '@/types/features';
import { sguClient } from '@/clients/sgu-client';

// ============================================================================
// OGC client factory (lazy — called at query time so mocks apply correctly)
// ============================================================================

const OGC_BASE = 'https://api.sgu.se/oppnadata';

function getOgcClient(workspace: string) {
  return createOgcClient({ baseUrl: `${OGC_BASE}/${workspace}/ogc/features/v1` });
}

// ============================================================================
// Registry types
// ============================================================================

type RegistryTransform = (feature: GeoJsonFeature) => Record<string, unknown>;

interface OgcEntry {
  mode: 'ogc';
  getClient: (bbox: BoundingBox) => ReturnType<typeof createOgcClient>;
  collection: string;
  transform: RegistryTransform;
}

interface WmsEntry {
  mode: 'wms';
  query: (point: Point) => Promise<unknown>;
}

type RegistryEntry = OgcEntry | WmsEntry;

// ============================================================================
// Data registry — unified OGC + WMS entries
// ============================================================================

// WGS84 latitude threshold separating northern from southern Sweden for soil type scale.
// Below: use 25k-100k scale; above: use 250k scale (only 250k covers the far north).
const NORTH_LATITUDE_THRESHOLD = 65.1;

const DATA_REGISTRY: Record<DataType, RegistryEntry> = {
  bedrock: {
    mode: 'ogc',
    getClient: () => getOgcClient('berggrund50k-250k'),
    collection: 'geologisk-enhet-yta',
    transform: transformBedrockFeature as unknown as RegistryTransform,
  },
  soil_type: {
    mode: 'ogc',
    getClient: (bbox) => {
      // bbox is WGS84: minY=minLat, maxY=maxLat
      const centerLat = (bbox.minY + bbox.maxY) / 2;
      return centerLat > NORTH_LATITUDE_THRESHOLD ? getOgcClient('jordarter250k') : getOgcClient('jordarter25k-100k');
    },
    collection: 'grundlager',
    transform: transformSoilFeature as unknown as RegistryTransform,
  },
  groundwater_aquifers: {
    mode: 'ogc',
    getClient: () => getOgcClient('grundvattenmagasin'),
    collection: 'grundvattenmagasin',
    transform: transformAquiferFeature as unknown as RegistryTransform,
  },
  wells: {
    mode: 'ogc',
    getClient: () => getOgcClient('brunnar'),
    collection: 'brunnar',
    transform: transformWellFeature as unknown as RegistryTransform,
  },
  soil_layers: {
    mode: 'ogc',
    getClient: () => getOgcClient('jordlagerfoljder'),
    collection: 'lagerinformation',
    transform: transformSoilLayerFeature as unknown as RegistryTransform,
  },
  radon_risk: { mode: 'wms', query: sguClient.getRadonRiskAt },
  soil_depth: { mode: 'wms', query: sguClient.getSoilDepthAt },
  groundwater_vulnerability: { mode: 'wms', query: sguClient.getGroundwaterVulnerabilityAt },
  landslide: { mode: 'wms', query: sguClient.getLandslideAt },
};

// ============================================================================
// Query helpers
// ============================================================================

function queryPointIndexesInside(geometry: GeoJsonGeometry | undefined, queryPoints: LonLat[]): number[] {
  if (!geometry) return [];
  return queryPoints.flatMap((point, index) => (geometryContainsPoint(geometry, point) ? [index] : []));
}

function containingFeaturesFirst(features: Record<string, unknown>[]): Record<string, unknown>[] {
  const containing = features.filter((feature) => feature.at_query_points !== undefined);
  const nearby = features.filter((feature) => feature.at_query_points === undefined);
  return [...containing, ...nearby];
}

async function queryOgcPerPoint(
  entry: OgcEntry,
  perPointBboxes: BoundingBox[],
  sweref99Points: Point[],
  limit: number,
  geometryDetail: GeometryDetail,
): Promise<{ features: Record<string, unknown>[] }> {
  // Query each point's bbox independently, deduplicate by feature ID
  const perBboxResults = await Promise.all(
    perPointBboxes.map(async (bbox) => {
      const client = entry.getClient(bbox);
      return client.getItemsWithCount<GeoJsonFeature>(entry.collection, { bbox, limit });
    }),
  );
  const queryPoints: LonLat[] = sweref99Points.map((point) => {
    const wgs84 = sweref99ToWgs84(point);
    return [wgs84.longitude, wgs84.latitude];
  });

  const seen = new Set<string>();
  const features: Record<string, unknown>[] = [];
  for (const result of perBboxResults) {
    for (const f of result.features) {
      const id = String(f.id ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const transformed = entry.transform(f);
      const at_query_points = queryPointIndexesInside(f.geometry, queryPoints);
      if (at_query_points.length > 0) {
        transformed.at_query_points = at_query_points;
      }
      if (transformed.geometry) {
        transformed.geometry = simplifyGeometry(transformed.geometry as GeoJsonGeometry, geometryDetail);
      }
      features.push(transformed);
    }
  }
  return { features: containingFeaturesFirst(features) };
}

async function queryWms(entry: WmsEntry, sweref99Points: Point[]): Promise<unknown[]> {
  const results = await Promise.all(sweref99Points.map((pt) => entry.query(pt)));
  return results.filter((r) => r !== null);
}

// ============================================================================
// Main export
// ============================================================================

export async function queryAll(
  requestedTypes: DataType[],
  perPointBboxes: BoundingBox[],
  sweref99Points: Point[],
  limit: number,
  geometryDetail: GeometryDetail,
): Promise<{ results: Record<string, unknown>; errors: Record<string, string> }> {
  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  const settled = await Promise.allSettled(
    requestedTypes.map(async (type) => {
      const entry = DATA_REGISTRY[type];
      if (entry.mode === 'ogc') {
        return { type, data: await queryOgcPerPoint(entry, perPointBboxes, sweref99Points, limit, geometryDetail) };
      } else {
        return { type, data: await queryWms(entry, sweref99Points) };
      }
    }),
  );

  settled.forEach((result, i) => {
    const type = requestedTypes[i];
    if (result.status === 'fulfilled') {
      const { data } = result.value;
      if (DATA_REGISTRY[type].mode === 'ogc') {
        results[type] = (data as { features: unknown[] }).features;
      } else {
        results[type] = data;
      }
    } else {
      errors[type] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
  });

  return { results, errors };
}
