# Leaderboard featured property scorer

## Location

`services/api/src/routes/leaderboard.ts:325`

```tsx
featuredProperty: null, // Scorer not implemented in this workstream
```

## Problem

The leaderboard response schema includes a `featuredProperty` field but it always returns `null`. The frontend leaderboard page (`apps/app/app/leaderboard.tsx`) already has UI space for this but skips rendering when null.

## Approach

Implement a basic engagement scorer: the featured property is the one with the most combined comments + likes in the current period. This is a placeholder scoring algorithm — a more sophisticated scorer (factoring in guess spread, view velocity, recency decay) can replace it later.

### Backend (`services/api/src/routes/leaderboard.ts`)

Add a query after the rankings query:

```sql
-- For period='all': most engaged property ever
-- For period='week'/'month': most engaged in that window
SELECT
  p.id,
  p.address,
  p.city,
  p.postal_code,
  p.country_code,
  p.official_valuation,
  (COALESCE(c.cnt, 0) + COALESCE(r.cnt, 0)) AS engagement_score
FROM properties p
LEFT JOIN (
  SELECT property_id, COUNT(*)::int AS cnt
  FROM comments sub
  WHERE 1=1 {timeCondition}
  GROUP BY property_id
) c ON c.property_id = p.id
LEFT JOIN (
  SELECT property_id, COUNT(*)::int AS cnt
  FROM reactions sub
  WHERE reaction_type = 'like' {timeCondition}
  GROUP BY property_id
) r ON r.property_id = p.id
WHERE COALESCE(c.cnt, 0) + COALESCE(r.cnt, 0) > 0
ORDER BY engagement_score DESC
LIMIT 1
```

Return the property data (id, address, city, postalCode, countryCode, officialValuation, commentCount, likeCount) as `featuredProperty`. Keep returning `null` if no properties have engagement.

Add a TODO comment on the scorer:
```tsx
// TODO: Replace basic engagement scorer (comments + likes) with weighted
// algorithm factoring guess spread, view velocity, and recency decay
```

### Schema update

Replace the loose `z.record(z.string(), z.any()).nullable()` with a proper typed schema:

```tsx
const featuredPropertySchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  countryCode: z.string(),
  officialValuation: z.number().nullable(),
  commentCount: z.number(),
  likeCount: z.number(),
  engagementScore: z.number(),
}).nullable();
```

## Files to change

| File | Change |
|------|--------|
| `services/api/src/routes/leaderboard.ts` | Add featured property query, type the schema, replace null |
| `services/api/src/routes/__tests__/leaderboard.test.ts` | Update test expectations if exists, or add test |
| `packages/api-client/generated/api.ts` | Regenerate after schema change |

## Scope

- Small (~60 lines backend, schema update)
- No frontend changes needed — the leaderboard page already handles non-null `featuredProperty`
- Add integration test: seed a property with comments/likes, verify it appears as featured
