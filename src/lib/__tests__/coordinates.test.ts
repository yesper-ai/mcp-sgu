import { describe, it, expect } from 'vitest';
import {
  isValidWgs84Coordinate,
  wgs84ToSweref99,
  wgs84BboxToSweref99,
  wgs84CoordinatesToSweref99,
  CRS_SWEREF99TM,
  CRS_WGS84,
  sweref99ToWgs84,
} from '../coordinates';
import { ValidationError } from '../errors';

describe('coordinates', () => {
  describe('constants', () => {
    it('should have correct CRS constants', () => {
      expect(CRS_SWEREF99TM).toBe('EPSG:3006');
      expect(CRS_WGS84).toBe('EPSG:4326');
    });
  });

  describe('isValidWgs84Coordinate', () => {
    it('should return true for valid Stockholm coordinates', () => {
      expect(isValidWgs84Coordinate(59.33, 18.07)).toBe(true);
    });

    it('should return true for valid Gothenburg coordinates', () => {
      expect(isValidWgs84Coordinate(57.71, 11.97)).toBe(true);
    });

    it('should return true for valid Malmo coordinates', () => {
      expect(isValidWgs84Coordinate(55.61, 13.0)).toBe(true);
    });

    it('should return true for valid Kiruna coordinates', () => {
      expect(isValidWgs84Coordinate(67.86, 20.23)).toBe(true);
    });

    it('should return false for coordinates south of Sweden', () => {
      expect(isValidWgs84Coordinate(54.0, 18.0)).toBe(false);
    });

    it('should return false for coordinates north of Sweden', () => {
      expect(isValidWgs84Coordinate(70.0, 18.0)).toBe(false);
    });

    it('should return false for coordinates west of Sweden', () => {
      expect(isValidWgs84Coordinate(59.0, 10.0)).toBe(false);
    });

    it('should return false for coordinates east of Sweden', () => {
      expect(isValidWgs84Coordinate(59.0, 25.0)).toBe(false);
    });

    it('should return true for boundary coordinates', () => {
      expect(isValidWgs84Coordinate(55.0, 11.0)).toBe(true);
      expect(isValidWgs84Coordinate(69.0, 24.0)).toBe(true);
    });
  });

  describe('wgs84ToSweref99', () => {
    it('should convert Stockholm coordinates correctly', () => {
      const result = wgs84ToSweref99({ latitude: 59.33, longitude: 18.07 });
      // Stockholm in SWEREF99TM is approximately x=674000, y=6580000
      expect(result.x).toBeGreaterThan(670000);
      expect(result.x).toBeLessThan(680000);
      expect(result.y).toBeGreaterThan(6575000);
      expect(result.y).toBeLessThan(6585000);
    });

    it('should convert Gothenburg coordinates correctly', () => {
      const result = wgs84ToSweref99({ latitude: 57.71, longitude: 11.97 });
      // Gothenburg in SWEREF99TM is approximately x=320000, y=6400000
      expect(result.x).toBeGreaterThan(315000);
      expect(result.x).toBeLessThan(325000);
      expect(result.y).toBeGreaterThan(6395000);
      expect(result.y).toBeLessThan(6405000);
    });

    it('should throw for coordinates outside Sweden', () => {
      // Paris coordinates
      expect(() => wgs84ToSweref99({ latitude: 48.86, longitude: 2.35 })).toThrow(ValidationError);
      expect(() => wgs84ToSweref99({ latitude: 48.86, longitude: 2.35 })).toThrow('outside valid range for Sweden');
    });
  });

  describe('wgs84BboxToSweref99', () => {
    it('should convert bbox correctly', () => {
      const bbox = wgs84BboxToSweref99({
        minLat: 59.25,
        minLon: 17.95,
        maxLat: 59.35,
        maxLon: 18.15,
      });

      // Should be a valid SWEREF99TM bbox around Stockholm
      expect(bbox.minX).toBeLessThan(bbox.maxX);
      expect(bbox.minY).toBeLessThan(bbox.maxY);
      expect(bbox.minX).toBeGreaterThan(600000);
      expect(bbox.maxX).toBeLessThan(700000);
    });

    it('should throw when minLat > maxLat', () => {
      expect(() =>
        wgs84BboxToSweref99({
          minLat: 59.35,
          minLon: 17.95,
          maxLat: 59.25,
          maxLon: 18.15,
        }),
      ).toThrow(ValidationError);
    });

    it('should throw when minLon > maxLon', () => {
      expect(() =>
        wgs84BboxToSweref99({
          minLat: 59.25,
          minLon: 18.15,
          maxLat: 59.35,
          maxLon: 17.95,
        }),
      ).toThrow(ValidationError);
    });

    it('should accept equal coordinates (point query) and produce valid bbox via buffer', () => {
      const bbox = wgs84BboxToSweref99({
        minLat: 59.33,
        minLon: 18.07,
        maxLat: 59.33,
        maxLon: 18.07,
      });

      // Buffer should create a valid bbox even from a single point
      expect(bbox.minX).toBeLessThan(bbox.maxX);
      expect(bbox.minY).toBeLessThan(bbox.maxY);
    });

    it('should apply custom buffer', () => {
      const defaultBbox = wgs84BboxToSweref99({
        minLat: 59.33,
        minLon: 18.07,
        maxLat: 59.33,
        maxLon: 18.07,
      });
      const largeBbox = wgs84BboxToSweref99({ minLat: 59.33, minLon: 18.07, maxLat: 59.33, maxLon: 18.07 }, 1000);

      // Larger buffer should produce a larger bbox
      expect(largeBbox.maxX - largeBbox.minX).toBeGreaterThan(defaultBbox.maxX - defaultBbox.minX);
    });

    it('should throw for coordinates outside Sweden', () => {
      expect(() =>
        wgs84BboxToSweref99({
          minLat: 48.8,
          minLon: 2.3,
          maxLat: 48.9,
          maxLon: 2.4,
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('wgs84CoordinatesToSweref99', () => {
    it('should convert array of coordinates', () => {
      const coords = wgs84CoordinatesToSweref99([
        { latitude: 59.3, longitude: 18.0 },
        { latitude: 59.35, longitude: 18.1 },
      ]);

      expect(coords).toHaveLength(2);
      expect(coords[0].x).toBeGreaterThan(600000);
      expect(coords[1].x).toBeGreaterThan(600000);
    });

    it('should throw for less than 2 coordinates', () => {
      expect(() => wgs84CoordinatesToSweref99([{ latitude: 59.3, longitude: 18.0 }])).toThrow(ValidationError);
      expect(() => wgs84CoordinatesToSweref99([{ latitude: 59.3, longitude: 18.0 }])).toThrow('at least 2');
    });

    it('should throw if any coordinate is outside Sweden', () => {
      expect(() =>
        wgs84CoordinatesToSweref99([
          { latitude: 59.3, longitude: 18.0 },
          { latitude: 48.86, longitude: 2.35 }, // Paris
        ]),
      ).toThrow(ValidationError);
    });
  });

  describe('sweref99ToWgs84', () => {
    it('should invert wgs84ToSweref99 within a millimetre', () => {
      const stockholm = { latitude: 59.33, longitude: 18.07 };
      const back = sweref99ToWgs84(wgs84ToSweref99(stockholm));
      expect(back.latitude).toBeCloseTo(stockholm.latitude, 8);
      expect(back.longitude).toBeCloseTo(stockholm.longitude, 8);
    });
  });
});
