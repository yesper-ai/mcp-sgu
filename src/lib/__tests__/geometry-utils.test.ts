import { describe, it, expect } from 'vitest';
import {
  isValidSwedishCoordinate,
  validateBbox,
  bboxToString,
  corridorToBoundingBox,
  simplifyGeometry,
  type BoundingBox,
  type Corridor,
  geometryContainsPoint,
} from '../geometry-utils';
import { ValidationError } from '../errors';
import type { GeoJsonGeometry } from '@/types/geojson';

describe('geometry-utils', () => {
  describe('isValidSwedishCoordinate', () => {
    it('should return true for valid Stockholm coordinates', () => {
      // Stockholm area: approximately 674000, 6580000
      expect(isValidSwedishCoordinate(674000, 6580000)).toBe(true);
    });

    it('should return true for valid Malmö coordinates', () => {
      // Malmö area: approximately 370000, 6160000
      expect(isValidSwedishCoordinate(370000, 6160000)).toBe(true);
    });

    it('should return true for valid Kiruna coordinates', () => {
      // Kiruna area: approximately 680000, 7530000
      expect(isValidSwedishCoordinate(680000, 7530000)).toBe(true);
    });

    it('should return false for coordinates west of Sweden', () => {
      expect(isValidSwedishCoordinate(100000, 6580000)).toBe(false);
    });

    it('should return false for coordinates east of Sweden', () => {
      expect(isValidSwedishCoordinate(1100000, 6580000)).toBe(false);
    });

    it('should return false for coordinates south of Sweden', () => {
      expect(isValidSwedishCoordinate(674000, 6000000)).toBe(false);
    });

    it('should return false for coordinates north of Sweden', () => {
      expect(isValidSwedishCoordinate(674000, 8000000)).toBe(false);
    });

    it('should return true for boundary coordinates', () => {
      expect(isValidSwedishCoordinate(200000, 6100000)).toBe(true);
      expect(isValidSwedishCoordinate(1000000, 7700000)).toBe(true);
    });
  });

  describe('validateBbox', () => {
    it('should not throw for valid bbox', () => {
      const bbox: BoundingBox = {
        minX: 670000,
        minY: 6570000,
        maxX: 680000,
        maxY: 6590000,
      };
      expect(() => validateBbox(bbox)).not.toThrow();
    });

    it('should throw when minX >= maxX', () => {
      const bbox: BoundingBox = {
        minX: 680000,
        minY: 6570000,
        maxX: 670000,
        maxY: 6590000,
      };
      expect(() => validateBbox(bbox)).toThrow(ValidationError);
      expect(() => validateBbox(bbox)).toThrow('minX must be less than maxX');
    });

    it('should throw when minY >= maxY', () => {
      const bbox: BoundingBox = {
        minX: 670000,
        minY: 6590000,
        maxX: 680000,
        maxY: 6570000,
      };
      expect(() => validateBbox(bbox)).toThrow(ValidationError);
      expect(() => validateBbox(bbox)).toThrow('minY must be less than maxY');
    });

    it('should throw for coordinates outside Sweden', () => {
      const bbox: BoundingBox = {
        minX: 100000,
        minY: 6570000,
        maxX: 110000,
        maxY: 6590000,
      };
      expect(() => validateBbox(bbox)).toThrow(ValidationError);
      expect(() => validateBbox(bbox)).toThrow('outside valid SWEREF99TM range');
    });
  });

  describe('bboxToString', () => {
    it('should convert bbox to comma-separated string', () => {
      const bbox: BoundingBox = {
        minX: 670000,
        minY: 6570000,
        maxX: 680000,
        maxY: 6590000,
      };
      expect(bboxToString(bbox)).toBe('670000,6570000,680000,6590000');
    });
  });

  describe('corridorToBoundingBox', () => {
    it('should convert corridor to bbox with buffer', () => {
      const corridor: Corridor = {
        coordinates: [
          { x: 670000, y: 6570000 },
          { x: 680000, y: 6580000 },
        ],
        bufferMeters: 100,
      };
      const bbox = corridorToBoundingBox(corridor);
      expect(bbox.minX).toBe(669900);
      expect(bbox.minY).toBe(6569900);
      expect(bbox.maxX).toBe(680100);
      expect(bbox.maxY).toBe(6580100);
    });

    it('should throw for corridor with less than 2 points', () => {
      const corridor: Corridor = {
        coordinates: [{ x: 670000, y: 6570000 }],
        bufferMeters: 100,
      };
      expect(() => corridorToBoundingBox(corridor)).toThrow(ValidationError);
      expect(() => corridorToBoundingBox(corridor)).toThrow('at least 2 coordinate pairs');
    });

    it('should handle multi-point corridors', () => {
      const corridor: Corridor = {
        coordinates: [
          { x: 670000, y: 6570000 },
          { x: 675000, y: 6575000 },
          { x: 680000, y: 6580000 },
        ],
        bufferMeters: 50,
      };
      const bbox = corridorToBoundingBox(corridor);
      expect(bbox.minX).toBe(669950);
      expect(bbox.minY).toBe(6569950);
      expect(bbox.maxX).toBe(680050);
      expect(bbox.maxY).toBe(6580050);
    });
  });
});

describe('simplifyGeometry', () => {
  // WGS84 polygon around Stockholm with nearly-collinear intermediate points on
  // the bottom edge. Those points deviate <0.001° from the straight line and will
  // be collapsed by Douglas-Peucker with the default WGS84 tolerance.
  const polygonGeometry: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [18.0, 59.3],
        [18.05, 59.3001],
        [18.1, 59.3],
        [18.15, 59.3001],
        [18.2, 59.3],
        [18.2, 59.4],
        [18.0, 59.4],
        [18.0, 59.3],
      ],
    ],
  };

  const pointGeometry: GeoJsonGeometry = {
    type: 'Point',
    coordinates: [18.123456789, 59.987654321],
  };

  it("returns undefined for detail === 'none' with polygon", () => {
    expect(simplifyGeometry(polygonGeometry, 'none')).toBeUndefined();
  });

  it("returns undefined for detail === 'none' with point", () => {
    expect(simplifyGeometry(pointGeometry, 'none')).toBeUndefined();
  });

  it("simplifies polygon with detail === 'simplified' (fewer coords than original)", () => {
    const result = simplifyGeometry(polygonGeometry, 'simplified');
    expect(result).toBeDefined();
    expect(result!.type).toBe('Polygon');
    const originalCoords = (polygonGeometry.coordinates as number[][][])[0];
    const resultCoords = (result!.coordinates as number[][][])[0];
    expect(resultCoords.length).toBeLessThan(originalCoords.length);
  });

  it("truncates point coords to 6 decimals with detail === 'simplified'", () => {
    const result = simplifyGeometry(pointGeometry, 'simplified');
    expect(result).toBeDefined();
    expect(result!.type).toBe('Point');
    const coords = result!.coordinates as number[];
    expect(coords[0]).toBe(18.123457);
    expect(coords[1]).toBe(59.987654);
  });

  it("returns all coords with truncation for detail === 'full'", () => {
    const result = simplifyGeometry(polygonGeometry, 'full');
    expect(result).toBeDefined();
    expect(result!.type).toBe('Polygon');
    const originalCoords = (polygonGeometry.coordinates as number[][][])[0];
    const resultCoords = (result!.coordinates as number[][][])[0];
    // 'full' preserves all coordinates (no simplification), just truncates
    expect(resultCoords.length).toBe(originalCoords.length);
  });

  it('accepts optional tolerance parameter and uses it for simplification', () => {
    // With a large tolerance (0.1°) even the jagged corners collapse
    const resultLoose = simplifyGeometry(polygonGeometry, 'simplified', 0.1);
    const resultTight = simplifyGeometry(polygonGeometry, 'simplified', 0.0001);
    expect(resultLoose).toBeDefined();
    expect(resultTight).toBeDefined();
    const looseCoordsLen = (resultLoose!.coordinates as number[][][])[0].length;
    const tightCoordsLen = (resultTight!.coordinates as number[][][])[0].length;
    // Looser tolerance = fewer coords than tighter tolerance
    expect(looseCoordsLen).toBeLessThanOrEqual(tightCoordsLen);
  });

  it('handles MultiPolygon correctly', () => {
    const multiPolygon: GeoJsonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [18.0, 59.3],
            [18.05, 59.3001],
            [18.1, 59.3],
            [18.2, 59.4],
            [18.0, 59.4],
            [18.0, 59.3],
          ],
        ],
        [
          [
            [19.0, 59.3],
            [19.05, 59.3001],
            [19.1, 59.3],
            [19.2, 59.4],
            [19.0, 59.4],
            [19.0, 59.3],
          ],
        ],
      ],
    };

    const resultNone = simplifyGeometry(multiPolygon, 'none');
    expect(resultNone).toBeUndefined();

    const resultFull = simplifyGeometry(multiPolygon, 'full');
    expect(resultFull).toBeDefined();
    expect(resultFull!.type).toBe('MultiPolygon');

    const resultSimplified = simplifyGeometry(multiPolygon, 'simplified');
    expect(resultSimplified).toBeDefined();
    expect(resultSimplified!.type).toBe('MultiPolygon');
  });

  describe('geometryContainsPoint', () => {
    const square: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [18.0, 59.3],
          [18.1, 59.3],
          [18.1, 59.4],
          [18.0, 59.4],
          [18.0, 59.3],
        ],
      ],
    };
    const squareWithHole: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        square.coordinates[0] as number[][],
        [
          [18.04, 59.34],
          [18.06, 59.34],
          [18.06, 59.36],
          [18.04, 59.36],
          [18.04, 59.34],
        ],
      ],
    };

    it('should be true for a point inside the outer ring', () => {
      expect(geometryContainsPoint(square, [18.05, 59.35])).toBe(true);
    });

    it('should be false for a point outside the outer ring', () => {
      expect(geometryContainsPoint(square, [18.2, 59.35])).toBe(false);
    });

    it('should be false for a point inside a hole', () => {
      expect(geometryContainsPoint(squareWithHole, [18.05, 59.35])).toBe(false);
      expect(geometryContainsPoint(squareWithHole, [18.02, 59.32])).toBe(true);
    });

    it('should check every polygon of a MultiPolygon', () => {
      const far: number[][][] = [
        [
          [19.0, 60.0],
          [19.1, 60.0],
          [19.1, 60.1],
          [19.0, 60.1],
          [19.0, 60.0],
        ],
      ];
      const multi: GeoJsonGeometry = { type: 'MultiPolygon', coordinates: [far, square.coordinates as number[][][]] };
      expect(geometryContainsPoint(multi, [18.05, 59.35])).toBe(true);
      expect(geometryContainsPoint(multi, [18.5, 59.5])).toBe(false);
    });

    it('should be false for geometries without an interior', () => {
      expect(geometryContainsPoint({ type: 'Point', coordinates: [18.05, 59.35] }, [18.05, 59.35])).toBe(false);
      expect(
        geometryContainsPoint(
          {
            type: 'LineString',
            coordinates: [
              [18.0, 59.3],
              [18.1, 59.4],
            ],
          },
          [18.05, 59.35],
        ),
      ).toBe(false);
    });
  });
});
