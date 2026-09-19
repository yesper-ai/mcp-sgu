import { withErrorHandling } from '@/lib/response';
import { wgs84ToSweref99, sweref99BboxToWgs84, validateWgs84Bbox, isValidWgs84Coordinate } from '@/lib/coordinates';
import { ValidationError } from '@/lib/errors';
import { queryAll } from '@/lib/data-registry';
import {
  dataTypes,
  dataTypesSchema,
  pointsSchema,
  radiusKmSchema,
  geometryDetailSchema,
  limitSchema,
} from '@/types/common-schemas';
import type { DataType, GeometryDetail } from '@/types/common-schemas';
import type { BoundingBox, Point } from '@/lib/geometry-utils';

export const sguQueryInputSchema = {
  dataTypes: dataTypesSchema,
  points: pointsSchema,
  radiusKm: radiusKmSchema,
  geometryDetail: geometryDetailSchema,
  limit: limitSchema,
};

export const sguQueryTool = {
  name: 'sgu_query',
  description:
    'Query geological data at one or more points in Sweden. ' +
    'Returns area features (bedrock, soil, wells, aquifers, soil layers) and point measurements ' +
    '(radon, soil depth, groundwater vulnerability, landslide). ' +
    'An area feature that contains a query point carries at_query_points (indexes into points) and is listed first; ' +
    'the other area features are neighbours within radiusKm, not the unit at the point. ' +
    'One point = site assessment. Multiple points = corridor sampling (e.g. along a railway track). ' +
    'Use "all" for dataTypes to get everything, or specify which types you need.',
  inputSchema: sguQueryInputSchema,
};

type SguQueryInput = {
  dataTypes: DataType[] | 'all';
  points: { latitude: number; longitude: number }[];
  radiusKm?: number;
  geometryDetail?: GeometryDetail;
  limit?: number;
};

export const sguQueryHandler = withErrorHandling(async (args: SguQueryInput) => {
  if (!args.points || args.points.length === 0) {
    throw new ValidationError('At least one point is required', 'points');
  }
  for (const p of args.points) {
    if (!isValidWgs84Coordinate(p.latitude, p.longitude)) {
      throw new ValidationError(`Point (${p.latitude}, ${p.longitude}) is outside Sweden (55-69°N, 11-24°E)`, 'points');
    }
  }

  const requestedTypes: DataType[] = args.dataTypes === 'all' ? [...dataTypes] : args.dataTypes;
  const radiusKm = args.radiusKm ?? 0.2;
  const geometryDetail = args.geometryDetail ?? 'simplified';
  const limit = args.limit ?? 50;

  // Convert points to SWEREF99TM (for WMS queries and bbox computation)
  const sweref99Points: Point[] = args.points.map((p) => {
    const s = wgs84ToSweref99(p);
    return { x: s.x, y: s.y };
  });

  // Compute per-point bboxes: each point gets its own radius-sized bbox
  // This prevents bbox explosion when points are far apart (e.g. corridor sampling)
  const radiusM = radiusKm * 1000;
  const perPointBboxes: BoundingBox[] = sweref99Points.map((p) => {
    const sweref99Bbox = {
      minX: p.x - radiusM,
      minY: p.y - radiusM,
      maxX: p.x + radiusM,
      maxY: p.y + radiusM,
    };
    const wgs84 = sweref99BboxToWgs84(sweref99Bbox);
    try {
      validateWgs84Bbox(wgs84);
    } catch {
      throw new ValidationError(
        `The ${radiusKm}km radius extends outside Sweden's bounds. Reduce radiusKm or pick a point further from the border.`,
        'radiusKm',
      );
    }
    return { minX: wgs84.minLon, minY: wgs84.minLat, maxX: wgs84.maxLon, maxY: wgs84.maxLat };
  });

  const { results, errors } = await queryAll(requestedTypes, perPointBboxes, sweref99Points, limit, geometryDetail);

  // Compute envelope bbox for response metadata
  const envelopeBbox = sweref99BboxToWgs84({
    minX: Math.min(...sweref99Points.map((p) => p.x)) - radiusM,
    minY: Math.min(...sweref99Points.map((p) => p.y)) - radiusM,
    maxX: Math.max(...sweref99Points.map((p) => p.x)) + radiusM,
    maxY: Math.max(...sweref99Points.map((p) => p.y)) + radiusM,
  });

  const response: Record<string, unknown> = {
    query: {
      points: args.points,
      radiusKm,
      bbox: envelopeBbox,
    },
    ...results,
  };
  if (Object.keys(errors).length > 0) {
    response.errors = errors;
  }
  return response;
});
