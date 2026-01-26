/**
 * Unit tests for PDOK aerial imagery utility
 */

import { getDutchAerialSnapshotUrl, convertToRDNew } from '../imagery';

describe('PDOK Imagery Utility', () => {
  describe('convertToRDNew', () => {
    it('should convert Dom Tower Utrecht coordinates correctly', () => {
      // Dom Tower in Utrecht: 52.0907, 5.1214 (WGS84)
      // Expected RD New coordinates approximately: 136000, 455800 (within ~200m)
      const [x, y] = convertToRDNew(52.0907, 5.1214);

      // Check that coordinates are in the expected range for Utrecht
      expect(x).toBeGreaterThan(135000);
      expect(x).toBeLessThan(137000);
      expect(y).toBeGreaterThan(455000);
      expect(y).toBeLessThan(457000);
    });

    it('should convert Amsterdam coordinates correctly', () => {
      // Amsterdam Central: 52.3791, 4.9003 (WGS84)
      // Expected RD New coordinates approximately: 121000, 487000
      const [x, y] = convertToRDNew(52.3791, 4.9003);

      expect(x).toBeGreaterThan(120000);
      expect(x).toBeLessThan(123000);
      expect(y).toBeGreaterThan(486000);
      expect(y).toBeLessThan(489000);
    });

    it('should convert Eindhoven coordinates correctly', () => {
      // Eindhoven (Tegenbosch area): 51.4375, 5.4875 (WGS84)
      const [x, y] = convertToRDNew(51.4375, 5.4875);

      // Should be in Eindhoven region (RD ~165000, ~387000)
      expect(x).toBeGreaterThan(160000);
      expect(x).toBeLessThan(170000);
      expect(y).toBeGreaterThan(380000);
      expect(y).toBeLessThan(395000);
    });
  });

  describe('getDutchAerialSnapshotUrl', () => {
    it('should generate valid PDOK WMS URL', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);

      expect(url).toContain('https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0');
      expect(url).toContain('service=WMS');
      expect(url).toContain('request=GetMap');
      expect(url).toContain('layers=Actueel_orthoHR');
    });

    it('should use correct SRS parameter', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);
      expect(url).toContain('srs=EPSG%3A28992');
    });

    it('should include default dimensions', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);
      expect(url).toContain('width=800');
      expect(url).toContain('height=600');
    });

    it('should use custom dimensions when provided', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214, 720, 480);
      expect(url).toContain('width=720');
      expect(url).toContain('height=480');
    });

    it('should include BBOX parameter', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);
      expect(url).toContain('BBOX=');

      // Parse BBOX values
      const urlObj = new URL(url);
      const bbox = urlObj.searchParams.get('BBOX');
      expect(bbox).toBeTruthy();

      const parts = bbox!.split(',');
      expect(parts.length).toBe(4);

      // All parts should be valid numbers in RD range
      parts.forEach((part) => {
        const num = parseFloat(part);
        expect(isNaN(num)).toBe(false);
        expect(num).toBeGreaterThan(0);
        expect(num).toBeLessThan(500000);
      });
    });

    it('should use PNG format', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);
      expect(url).toContain('format=image%2Fpng');
    });

    it('should set transparent=true', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);
      expect(url).toContain('transparent=true');
    });

    it('should use WMS version 1.1.1', () => {
      const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);
      expect(url).toContain('version=1.1.1');
    });

    it('should generate different BBOX for different coordinates', () => {
      const urlUtrecht = getDutchAerialSnapshotUrl(52.0907, 5.1214);
      const urlEindhoven = getDutchAerialSnapshotUrl(51.4375, 5.4875);

      const bboxUtrecht = new URL(urlUtrecht).searchParams.get('BBOX');
      const bboxEindhoven = new URL(urlEindhoven).searchParams.get('BBOX');

      expect(bboxUtrecht).not.toBe(bboxEindhoven);
    });

    it('should adjust BBOX for different box sizes', () => {
      const urlSmall = getDutchAerialSnapshotUrl(52.0907, 5.1214, 800, 600, 30);
      const urlLarge = getDutchAerialSnapshotUrl(52.0907, 5.1214, 800, 600, 60);

      const bboxSmall = new URL(urlSmall).searchParams.get('BBOX')!.split(',');
      const bboxLarge = new URL(urlLarge).searchParams.get('BBOX')!.split(',');

      // Larger box size should have greater span
      const spanSmall = parseFloat(bboxSmall[2]) - parseFloat(bboxSmall[0]);
      const spanLarge = parseFloat(bboxLarge[2]) - parseFloat(bboxLarge[0]);

      expect(spanLarge).toBeGreaterThan(spanSmall);
    });
  });
});
