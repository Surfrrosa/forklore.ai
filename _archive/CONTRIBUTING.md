# Contributing to Forklore.ai

Thank you for your interest in contributing to Forklore.ai. This document provides guidelines for contributing to the project.

## Code of Conduct

- Be respectful and constructive in all interactions
- Focus on technical merit and project improvements
- Welcome newcomers and help them get started
- Report security vulnerabilities privately

## Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ with PostGIS and pg_trgm extensions
- Reddit API credentials
- Upstash Redis account (optional for development)

### Installation

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/forklore.ai.git
cd forklore.ai

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials

# Run database migrations
source .env.local
for file in prisma/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$file"
done

# Start development server
npm run dev
```

## Development Workflow

### Branch Naming

- `feature/your-feature-name` - New features
- `fix/bug-description` - Bug fixes
- `docs/documentation-update` - Documentation changes
- `refactor/component-name` - Code refactoring
- `test/test-description` - Test additions/modifications

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): description

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(api): add nearby search endpoint with ST_DWithin

fix(cache): correct ETag generation for paginated results

docs(readme): update installation instructions for PostgreSQL 16

refactor(scoring): extract Wilson Score calculation to utility function
```

### Pull Request Process

1. **Create a feature branch** from `main`
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Make your changes** with atomic commits

3. **Run tests** before submitting
   ```bash
   ./test-week1.sh
   ```

4. **Update documentation** if needed
   - README.md for user-facing changes
   - Inline JSDoc comments for code changes
   - TESTING_GUIDE.md for new test scenarios

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature
   ```

6. **Open a Pull Request**
   - Provide clear description of changes
   - Reference related issues
   - Include test results
   - Add screenshots for UI changes

### Code Quality Standards

#### TypeScript

- Use strict mode (already enabled)
- No `any` types without justification
- Prefer interfaces over types for object shapes
- Use type guards for runtime type checking

```typescript
// Good
interface Place {
  id: string;
  name: string;
  cuisine: string[];
}

function isPlace(obj: unknown): obj is Place {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'name' in obj
  );
}

// Avoid
const data: any = fetchData();
```

#### Error Handling

- Always handle errors explicitly
- Provide meaningful error messages
- Use structured logging

```typescript
// Good
try {
  const result = await prisma.place.findMany();
  return NextResponse.json({ results: result });
} catch (err: any) {
  console.error('Place search failed:', err);
  return NextResponse.json(
    { error: err?.message ?? 'Unknown error' },
    { status: 500 }
  );
}

// Avoid
const result = await prisma.place.findMany();
return NextResponse.json({ results: result });
```

#### API Design

- Follow RESTful conventions
- Use descriptive query parameter names
- Include pagination for list endpoints
- Add rate limiting headers
- Implement caching where appropriate

```typescript
// Good
GET /api/v2/search?city=nyc&type=iconic&limit=20&offset=0

Response Headers:
Cache-Control: public, max-age=3600
ETag: "abc123"
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
```

#### Database Queries

- Use Prisma's type-safe queries when possible
- For complex queries, use `$queryRaw` with proper SQL injection prevention
- Add indexes for frequently queried columns
- Use materialized views for expensive aggregations

```typescript
// Good - Type-safe
const places = await prisma.place.findMany({
  where: { cityId: city.id, status: 'active' },
  take: limit,
  skip: offset,
});

// Good - Raw SQL with parameterization
const results = await prisma.$queryRaw<Place[]>(
  Prisma.sql`
    SELECT * FROM "Place"
    WHERE "cityId" = ${cityId}
    AND similarity("nameNorm", ${query}) > 0.5
    LIMIT ${limit}
  `
);

// Avoid - SQL injection risk
const results = await prisma.$queryRawUnsafe(
  `SELECT * FROM "Place" WHERE name = '${userInput}'`
);
```

## Testing

### Manual Testing

Run the comprehensive test suite:

```bash
./test-week1.sh
```

Expected output:
- Fuzzy search threshold > 0.5
- Pagination metadata present
- Cache headers present
- Rate limiting headers present (if Upstash configured)
- Multiple cuisine filtering works
- Cuisines endpoint returns data

### Adding Tests

When adding new features, update `test-week1.sh` with relevant test cases:

```bash
# Test 7: Your new feature
echo "7. Testing your new feature..."
RESULT=$(curl -s "http://localhost:3000/api/v2/your-endpoint")
# Add assertions here
```

## Documentation

### Code Documentation

Use JSDoc comments for exported functions:

```typescript
/**
 * Computes Wilson Score lower bound for ranking confidence
 *
 * @param upvotes - Number of positive votes
 * @param total - Total number of votes
 * @param confidence - Confidence level (default: 0.95 for 95%)
 * @returns Lower bound of Wilson Score interval (0-1)
 *
 * @example
 * ```typescript
 * const score = wilsonScore(80, 100); // Returns ~0.71
 * ```
 */
export function wilsonScore(
  upvotes: number,
  total: number,
  confidence: number = 0.95
): number {
  // Implementation
}
```

### README Updates

Update README.md when adding:
- New API endpoints
- New environment variables
- New dependencies
- New setup steps

### Architecture Documentation

For significant architectural changes, add documentation to `docs/`:
- `docs/SCORING_MATH.md` - Scoring algorithm details
- `docs/REDDIT_TOS_COMPLIANCE.md` - Legal compliance documentation
- `docs/architecture/` - System design documents

## Database Migrations

### Creating Migrations

1. Create a new migration file in `prisma/migrations/`
   ```bash
   prisma/migrations/010_your_migration_name.sql
   ```

2. Use sequential numbering (001, 002, 003...)

3. Include both forward and rollback logic when possible

4. Test migration on development database before committing

Example migration:

```sql
-- Migration: 010_add_borough_aliases
-- Description: Add city alias table for normalization
-- Date: 2025-10-18

-- Forward migration
CREATE TABLE IF NOT EXISTS "CityAlias" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cityId" TEXT NOT NULL REFERENCES "City"(id),
  alias TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_city_alias_lookup ON "CityAlias"(alias);

-- Rollback (commented, for reference)
-- DROP TABLE IF EXISTS "CityAlias";
```

### Migration Guidelines

- Test on local database first
- Document breaking changes
- Update schema.prisma if needed
- Include sample data for testing
- Note any required application code changes

## Security

### Reporting Vulnerabilities

**DO NOT** open public issues for security vulnerabilities.

Instead, email the maintainer privately:
- Include detailed description
- Provide steps to reproduce
- Suggest a fix if possible

### Security Best Practices

- Never commit secrets (.env files excluded by .gitignore)
- Use parameterized queries to prevent SQL injection
- Validate all user input
- Implement rate limiting on all public endpoints
- Use HTTPS in production
- Keep dependencies updated

## Performance

### Guidelines

- Target < 100ms for API responses
- Use materialized views for expensive aggregations
- Implement caching with appropriate TTLs
- Add database indexes for frequently queried columns
- Use BRIN indexes for time-series data
- Paginate large result sets

### Profiling

Before optimizing:
1. Measure current performance
2. Identify bottlenecks
3. Optimize the slowest parts first
4. Measure improvement

```bash
# Measure API latency
time curl -s "http://localhost:3000/api/v2/search?city=nyc&type=iconic" > /dev/null
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

- Open a [discussion](https://github.com/Surfrrosa/forklore.ai/discussions) for questions
- Join the community chat (if available)
- Review existing issues and pull requests
- Check the documentation in `docs/`

---

Thank you for contributing to Forklore.ai!
