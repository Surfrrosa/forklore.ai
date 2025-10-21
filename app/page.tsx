/**
 * Homepage - API Documentation
 */

export default function Home() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '10px' }}>🍴 Forklore.ai API</h1>
      <p style={{ color: '#666', marginBottom: '40px' }}>
        Reddit-powered restaurant discovery platform
      </p>

      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px' }}>📡 Available Endpoints</h2>

        <div style={{ background: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>
            <code>GET /api/v2/search</code>
          </h3>
          <p style={{ color: '#666', marginBottom: '12px' }}>Search restaurants by city and ranking type</p>
          <p style={{ fontSize: '14px', marginBottom: '8px' }}><strong>Parameters:</strong></p>
          <ul style={{ fontSize: '14px', color: '#666', marginLeft: '20px' }}>
            <li><code>city</code> (required): City name or alias</li>
            <li><code>type</code> (required): iconic | trending | cuisine</li>
            <li><code>limit</code> (optional): Results per page (default: 50, max: 100)</li>
            <li><code>offset</code> (optional): Pagination offset (default: 0)</li>
          </ul>
          <p style={{ fontSize: '14px', marginTop: '12px' }}>
            <strong>Example:</strong>{' '}
            <a href="/api/v2/search?city=Portland&type=iconic&limit=5" style={{ color: '#0070f3' }}>
              /api/v2/search?city=Portland&type=iconic&limit=5
            </a>
          </p>
          <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            Rate limit: 100 requests/minute
          </p>
        </div>

        <div style={{ background: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>
            <code>GET /api/v2/fuzzy</code>
          </h3>
          <p style={{ color: '#666', marginBottom: '12px' }}>Fuzzy search / autocomplete for restaurant names</p>
          <p style={{ fontSize: '14px', marginBottom: '8px' }}><strong>Parameters:</strong></p>
          <ul style={{ fontSize: '14px', color: '#666', marginLeft: '20px' }}>
            <li><code>q</code> (required): Search query (min 2 characters)</li>
            <li><code>city</code> (optional): Filter by city</li>
            <li><code>limit</code> (optional): Results (default: 10, max: 50)</li>
          </ul>
          <p style={{ fontSize: '14px', marginTop: '12px' }}>
            <strong>Example:</strong>{' '}
            <a href="/api/v2/fuzzy?q=coffee&limit=5" style={{ color: '#0070f3' }}>
              /api/v2/fuzzy?q=coffee&limit=5
            </a>
          </p>
          <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            Rate limit: 30 requests/minute
          </p>
        </div>
      </section>

      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px' }}>📊 Live Data</h2>
        <div style={{ background: '#e8f5e9', padding: '20px', borderRadius: '8px', border: '1px solid #4caf50', marginBottom: '12px' }}>
          <p style={{ fontSize: '16px', color: '#2e7d32', marginBottom: '8px', fontWeight: 'bold' }}>
            Portland - RANKED
          </p>
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
            5,210 Reddit mentions across 270 restaurants
          </p>
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
            Top place: Portland Cà Phê (2,038 mentions)
          </p>
          <div style={{ paddingTop: '12px', borderTop: '1px solid #c8e6c9' }}>
            <p style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
              <strong>Try it:</strong>
            </p>
            <p style={{ fontSize: '12px' }}>
              <a href="/api/v2/search?city=Portland&type=iconic&limit=5" style={{ color: '#2e7d32', textDecoration: 'underline' }}>
                Top 5 Iconic
              </a>
              {' | '}
              <a href="/api/v2/search?city=Portland&type=trending&limit=5" style={{ color: '#2e7d32', textDecoration: 'underline' }}>
                Top 5 Trending
              </a>
              {' | '}
              <a href="/api/v2/fuzzy?q=coffee&city=Portland&limit=5" style={{ color: '#2e7d32', textDecoration: 'underline' }}>
                Search "coffee"
              </a>
            </p>
          </div>
        </div>
        <div style={{ background: '#fff3cd', padding: '16px', borderRadius: '8px', border: '1px solid #ffc107' }}>
          <p style={{ fontSize: '13px', color: '#856404' }}>
            More cities coming soon! NYC bootstrap in progress...
          </p>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: '24px', marginBottom: '16px' }}>📝 Features</h2>
        <ul style={{ fontSize: '14px', color: '#666', marginLeft: '20px', lineHeight: '1.8' }}>
          <li>✅ Type-safe database queries</li>
          <li>✅ SQL injection protection</li>
          <li>✅ Rate limiting on all public APIs</li>
          <li>✅ Environment validation</li>
          <li>✅ Connection pooling</li>
          <li>✅ Background job processing</li>
          <li>✅ Graceful error handling</li>
          <li>✅ Materialized view caching</li>
        </ul>
      </section>

      <footer style={{ marginTop: '60px', paddingTop: '20px', borderTop: '1px solid #eee', fontSize: '12px', color: '#999', textAlign: 'center' }}>
        <p>Forklore.ai - Reddit-powered restaurant discovery</p>
        <p style={{ marginTop: '8px' }}>Production-ready v2 API</p>
      </footer>
    </div>
  );
}
