import { ValidationError } from './errors';
import type { GeoJsonGeometry } from '@/types/geojson';
import type { GeometryDetail } from '@/types/common-schemas';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Point {
  x: number; // Easting
  y: number; // Northing
}

export interface Corridor {
  coordinates: { x: number; y: number }[]; // Array of coordinate objects
  bufferMeters: number;
}

// Approximate SWEREF99TM bounds for Sweden
const SWEREF99TM_BOUNDS = {
  minX: 200000, // Western boundary
  maxX: 1000000, // Eastern boundary
  minY: 6100000, // Southern boundary
  maxY: 7700000, // Northern boundary
};

export function isValidSwedishCoordinate(x: number, y: number): boolean {
  return (
    x >= SWEREF99TM_BOUNDS.minX && x <= SWEREF99TM_BOUNDS.maxX && y >= SWEREF99TM_BOUNDS.minY && y <= SWEREF99TM_BOUNDS.maxY
  );
}

export function validateBbox(bbox: BoundingBox): void {
  if (bbox.minX >= bbox.maxX) {
    throw new ValidationError('minX must be less than maxX', 'bbox');
  }
  if (bbox.minY >= bbox.maxY) {
    throw new ValidationError('minY must be less than maxY', 'bbox');
  }
  if (!isValidSwedishCoordinate(bbox.minX, bbox.minY)) {
    throw new ValidationError(`Coordinates (${bbox.minX}, ${bbox.minY}) are outside valid SWEREF99TM range for Sweden`, 'bbox');
  }
  if (!isValidSwedishCoordinate(bbox.maxX, bbox.maxY)) {
    throw new ValidationError(`Coordinates (${bbox.maxX}, ${bbox.maxY}) are outside valid SWEREF99TM range for Sweden`, 'bbox');
  }
}

// OGC bbox string format: minX,minY,maxX,maxY
export function bboxToString(bbox: BoundingBox): string {
  return `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`;
}

// Simple approximation: adds buffer to the line's bbox
export function corridorToBoundingBox(corridor: Corridor): BoundingBox {
  if (corridor.coordinates.length < 2) {
    throw new ValidationError('Corridor must have at least 2 coordinate pairs', 'corridor');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const { x, y } of corridor.coordinates) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Add buffer to all sides
  const buffer = corridor.bufferMeters;
  return {
    minX: minX - buffer,
    minY: minY - buffer,
    maxX: maxX + buffer,
    maxY: maxY + buffer,
  };
}

// Point-in-polygon (even-odd ray casting) on GeoJSON coordinates in [x, y] order

export type LonLat = [number, number];

function ringContains(ring: number[][], [x, y]: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crossesRay = yi > y !== yj > y;
    if (crossesRay && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonContains(rings: number[][][], point: LonLat): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !ringContains(outer, point)) return false;
  return !holes.some((hole) => ringContains(hole, point));
}

export function geometryContainsPoint(geometry: GeoJsonGeometry, point: LonLat): boolean {
  if (geometry.type === 'Polygon') {
    return polygonContains(geometry.coordinates as number[][][], point);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as number[][][][]).some((rings) => polygonContains(rings, point));
  }
  return false;
}

// Douglas-Peucker simplification helpers

// ~100m at Swedish latitudes in WGS84 degrees (1 degree lat ≈ 111km, 0.001° ≈ 111m)
const WGS84_SIMPLIFICATION_TOLERANCE = 0.001;

function perpendicularDist(point: number[], lineStart: number[], lineEnd: number[]): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const lenSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (lenSq === 0) return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  return Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / Math.sqrt(lenSq);
}

function simplifyRing(coords: number[][], tolerance: number): number[][] {
  if (coords.length <= 2) return coords;
  let maxDist = 0;
  let maxIndex = 0;
  const first = coords[0];
  const last = coords[coords.length - 1];
  for (let i = 1; i < coords.length - 1; i++) {
    const dist = perpendicularDist(coords[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyRing(coords.slice(0, maxIndex + 1), tolerance);
    const right = simplifyRing(coords.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function truncateCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function truncateCoords(coords: number[][]): number[][] {
  return coords.map((c) => c.map(truncateCoord));
}

export function simplifyGeometry(
  geometry: GeoJsonGeometry,
  detail: GeometryDetail,
  tolerance: number = WGS84_SIMPLIFICATION_TOLERANCE,
): GeoJsonGeometry | undefined {
  if (detail === 'none') return undefined;

  if (geometry.type === 'Point') {
    const coords = geometry.coordinates as number[];
    return { type: 'Point', coordinates: coords.map(truncateCoord) };
  }

  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates as number[][];
    const simplified = detail === 'simplified' ? simplifyRing(coords, tolerance) : coords;
    return { type: 'LineString', coordinates: truncateCoords(simplified) };
  }

  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as number[][][];
    const processed = rings.map((ring) => {
      const simplified = detail === 'simplified' ? simplifyRing(ring, tolerance) : ring;
      return truncateCoords(simplified);
    });
    return { type: 'Polygon', coordinates: processed };
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates as number[][][][];
    const processed = polygons.map((rings) =>
      rings.map((ring) => {
        const simplified = detail === 'simplified' ? simplifyRing(ring, tolerance) : ring;
        return truncateCoords(simplified);
      }),
    );
    return { type: 'MultiPolygon', coordinates: processed };
  }

  // Fallback: return geometry unchanged for unhandled types
  return geometry;
}
