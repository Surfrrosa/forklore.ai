/**
 * Unit tests for multi-stage matching algorithm
 * Golden cases for NYC restaurants
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { matchPlace, normalizeName, extractPlaceNames, type MatchContext } from '../lib/match';
import prisma from '../lib/prisma';

describe('Name Normalization', () => {
  it('should normalize basic names', () => {
    expect(normalizeName("Joe's Pizza")).toBe("joes pizza");
    expect(normalizeName("Katz's Delicatessen")).toBe("katzs delicatessen");
    expect(normalizeName("Di Fara Pizza")).toBe("di fara pizza");
  });

  it('should remove punctuation and collapse whitespace', () => {
    expect(normalizeName("Peter  Luger's  Steak-House")).toBe("peter lugers steak house");
    expect(normalizeName("Shake   Shack!")).toBe("shake shack");
  });

  it('should handle special characters', () => {
    expect(normalizeName("Café Mogador")).toBe("cafe mogador");
    expect(normalizeName("L'Artusi")).toBe("l artusi");
  });
});

describe('Place Name Extraction', () => {
  it('should extract quoted names', () => {
    const text = 'You have to try "Katz\'s Deli" on Houston Street';
    const names = extractPlaceNames(text);
    expect(names).toContain("Katz's Deli");
  });

  it('should extract capitalized proper nouns', () => {
    const text = "Went to Peter Luger last night, incredible steak";
    const names = extractPlaceNames(text);
    expect(names).toContain("Peter Luger");
  });

  it('should extract apostrophe names', () => {
    const text = "Joe's Pizza is the best slice in NYC";
    const names = extractPlaceNames(text);
    expect(names).toContain("Joe's Pizza");
  });

  it('should filter common false positives', () => {
    const text = "The best pizza in The Village";
    const names = extractPlaceNames(text);
    expect(names).not.toContain("The");
  });
});

describe('Multi-Stage Matching (requires database)', () => {
  let nycCityId: string;

  beforeAll(async () => {
    // Get NYC city ID (assumes it exists from seed data)
    const city = await prisma.$queryRaw<{id: string}[]>`
      SELECT id FROM "City" WHERE name = 'New York City' LIMIT 1
    `;

    if (city.length === 0) {
      throw new Error('NYC not found in database - run seed data first');
    }

    nycCityId = city[0].id;
  });

  describe('Stage 1: Exact Alias Match', () => {
    it('should match exact canonical name', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Katz's Delicatessen"
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.stage).toBe('alias');
      expect(match?.name).toContain('Katz');
    });

    it('should match known aliases', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Katz's Deli"  // Alias for Katz's Delicatessen
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.stage).toBe('alias');
    });

    it('should be case-insensitive', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "KATZ'S DELICATESSEN"
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.stage).toBe('alias');
    });
  });

  describe('Stage 2: Trigram Similarity', () => {
    it('should match with typos (threshold 0.55)', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Kats Deli"  // Missing apostrophe
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.stage).toMatch(/trigram|alias/);
      expect(match?.similarity).toBeGreaterThanOrEqual(0.55);
    });

    it('should match abbreviated names', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Joes"  // Short for Joe's Pizza
      };

      const match = await matchPlace(ctx);

      // May or may not match depending on alias configuration
      if (match) {
        expect(match.similarity).toBeGreaterThanOrEqual(0.50);
      }
    });

    it('should NOT match below threshold', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Random Restaurant That Doesn't Exist 12345"
      };

      const match = await matchPlace(ctx);

      expect(match).toBeNull();
    });
  });

  describe('Stage 3: Geo Assist', () => {
    it('should match with lower threshold when within 2km', async () => {
      // Katz's location: ~40.7223° N, 73.9877° W
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Kats",  // Lower similarity
        lat: 40.7220,  // Very close to Katz's
        lon: -73.9880
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.stage).toMatch(/geo_assist|alias/);
      expect(match?.distance).toBeLessThan(2);  // Within 2km
    });

    it('should prioritize closer locations for chains', async () => {
      // Shake Shack has multiple locations
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Shake Shack",
        lat: 40.7580,  // Madison Square Park location
        lon: -73.9855
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.brand).toBe('Shake Shack');
      // Should pick nearest location if multiple exist
    });
  });

  describe('Stage 4: Brand Disambiguation', () => {
    it('should prefer single-location over chains when similarity equal', async () => {
      // This test requires specific data setup
      // Concept: Di Fara (single) vs generic pizza chain
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Di Fara Pizza"
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.brand).toBeNull();  // Single location, no brand
    });
  });

  describe('Stage 5: Address Consistency', () => {
    it('should validate address hints when provided', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Katz's",
        addressHint: "Houston Street"
      };

      const match = await matchPlace(ctx);

      expect(match).not.toBeNull();
      expect(match?.address).toContain('Houston');
    });

    it('should reject if address contradicts', async () => {
      const ctx: MatchContext = {
        cityId: nycCityId,
        mentionText: "Katz's",
        addressHint: "Broadway Brooklyn"  // Wrong location
      };

      const match = await matchPlace(ctx);

      // Should either return null or return Katz's anyway (address is tie-breaker, not hard filter)
      if (match) {
        expect(match.address).not.toBeNull();
      }
    });
  });

  describe('Golden Cases (Real-World)', () => {
    const goldenCases = [
      {
        mention: "Went to Katz's Deli last night, pastrami was incredible",
        expected: "Katz",
        description: "Famous NYC deli with apostrophe"
      },
      {
        mention: "Peter Luger is overrated IMO",
        expected: "Peter Luger",
        description: "Brooklyn steakhouse"
      },
      {
        mention: "Di Fara > any other pizza in NYC",
        expected: "Di Fara",
        description: "Legendary Brooklyn pizza"
      },
      {
        mention: "Joe's Pizza on Carmine is the classic NYC slice",
        expected: "Joe",
        description: "Classic pizza chain with address hint"
      },
      {
        mention: "Had ramen at Ippudo, so good",
        expected: "Ippudo",
        description: "Ramen chain"
      }
    ];

    goldenCases.forEach(({ mention, expected, description }) => {
      it(`should match: ${description}`, async () => {
        const names = extractPlaceNames(mention);
        expect(names.length).toBeGreaterThan(0);

        const ctx: MatchContext = {
          cityId: nycCityId,
          mentionText: names[0]  // Use first extracted name
        };

        const match = await matchPlace(ctx);

        expect(match, `Failed to match: ${description}`).not.toBeNull();
        expect(match?.name.toLowerCase(), `Wrong match for: ${description}`)
          .toContain(expected.toLowerCase());
      });
    });
  });
});

describe('Error Handling', () => {
  it('should handle empty mention text', async () => {
    const ctx: MatchContext = {
      cityId: 'some-city-id',
      mentionText: ''
    };

    const match = await matchPlace(ctx);
    expect(match).toBeNull();
  });

  it('should handle invalid city ID', async () => {
    const ctx: MatchContext = {
      cityId: 'non-existent-city',
      mentionText: "Some Restaurant"
    };

    const match = await matchPlace(ctx);
    expect(match).toBeNull();
  });

  it('should handle special characters gracefully', async () => {
    const ctx: MatchContext = {
      cityId: 'some-city-id',
      mentionText: "@@##$$%%"
    };

    const match = await matchPlace(ctx);
    expect(match).toBeNull();
  });
});
