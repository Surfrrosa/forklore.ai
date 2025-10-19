"use client";

import { useState } from "react";

type Result = {
  name: string;
  mentions: number;
  uniqueThreads: number;
  totalUpvotes: number;
  last30dMentions: number;
  score: number;
  cuisine: string | null;
};

export default function Home() {
  const [city, setCity] = useState("nyc");
  const [query, setQuery] = useState("best");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<any>(null);
  const [showAbout, setShowAbout] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/search?city=${encodeURIComponent(city)}&q=${encodeURIComponent(query)}&limit=50`
      );
      const data = await res.json();
      setResults(data.results || []);
      setMetadata(data);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-lg bg-bg/80 border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <h1 className="text-2xl font-display font-bold bg-gradient-to-r from-brand1 to-brand2 bg-clip-text text-transparent">
            Forklore.ai
          </h1>
          <nav className="flex gap-4 text-sm text-muted">
            <button onClick={() => setShowAbout(!showAbout)} className="hover:text-fg transition-colors">
              About
            </button>
          </nav>
        </div>
      </header>

      {/* About Modal */}
      {showAbout && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowAbout(false)}>
          <div className="bg-panel border border-line rounded-2xl max-w-2xl w-full p-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-3xl font-display font-bold bg-gradient-to-r from-brand1 to-brand2 bg-clip-text text-transparent">
                About Forklore.ai
              </h2>
              <button onClick={() => setShowAbout(false)} className="text-muted hover:text-fg text-2xl leading-none">
                ×
              </button>
            </div>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>
                <strong className="text-fg">Forklore.ai</strong> helps you discover the best restaurants in any city by analyzing real conversations from Reddit.
              </p>
              <p>
                Instead of relying on paid reviews or influencer recommendations, we surface authentic opinions from local food communities. Every result is backed by actual Reddit threads, upvotes, and community consensus.
              </p>
              <p className="text-sm">
                <strong className="text-fg">How it works:</strong> We search relevant city subreddits, extract restaurant mentions, validate them with Google Places, and rank by a combination of mentions, upvotes, and recency.
              </p>
              <p className="text-sm text-muted">
                Powered by Reddit API • Built with Next.js • Cross-referenced with Google Places
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h2 className="text-5xl md:text-6xl font-display font-extrabold tracking-tight leading-none mb-4 bg-gradient-to-r from-brand1 to-brand2 bg-clip-text text-transparent">
            Where Reddit Actually Eats
          </h2>
          <p className="text-lg text-muted max-w-4xl mx-auto">
            Discover top-rated restaurants in any city, powered by Reddit's collective wisdom.
          </p>
        </div>

        {/* Search Controls */}
        <div className="max-w-3xl mx-auto mb-12">
          <div className="bg-panel border border-line rounded-2xl p-4 shadow-soft">
            <div className="flex gap-3 mb-3">
              <div className="flex-1 relative">
                <label htmlFor="city-input" className="absolute -top-2 left-3 px-1 bg-panel text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                  Enter any city
                </label>
                <input
                  id="city-input"
                  type="text"
                  placeholder="e.g., Austin, Tokyo, London, Portland"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full h-12 bg-zinc-900 border border-white/10 rounded-lg px-4 text-base outline-none focus:border-white/20 focus:ring-2 focus:ring-action/60 shadow-inner transition-colors"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={loading}
                className="h-12 px-6 rounded-lg bg-white text-black text-base font-medium hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {loading ? "Loading..." : "Search"}
              </button>
            </div>

            {/* Quick Select Chips */}
            <div className="flex flex-wrap gap-2 mb-3 items-center">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">Popular:</span>
              {["NYC", "SF", "LA", "Chicago", "Austin", "Seattle"].map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setCity(c.toLowerCase());
                    setTimeout(handleSearch, 50);
                  }}
                  className="text-xs px-2.5 py-1 rounded-md bg-zinc-900/60 border border-white/10 text-gray-300 hover:border-white/20 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>

            {metadata && (
              <div className="text-xs text-muted">
                {metadata.totalThreads} threads • {metadata.totalSources} sources • {results.length} results
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-panel border border-line rounded-2xl p-4 animate-pulse">
                <div className="h-6 bg-zinc-800 rounded w-3/4 mb-3"></div>
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-16 bg-zinc-900 rounded"></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : results.length > 0 ? (
          <>
            {/* Result Header */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex gap-2 text-xs flex-wrap">
                <span className="px-2 py-1 border border-white/10 rounded-md text-gray-400">
                  {metadata.totalThreads} threads
                </span>
                {metadata.totalSources && (
                  <span className="px-2 py-1 border border-white/10 rounded-md text-gray-400">
                    {metadata.totalSources} sources
                  </span>
                )}
                {metadata.totalCandidates && (
                  <span className="px-2 py-1 border border-white/10 rounded-md text-gray-400">
                    {metadata.totalCandidates} candidates
                  </span>
                )}
                {metadata.resolvedCandidates !== undefined && (
                  <span className="px-2 py-1 border border-white/10 rounded-md text-gray-400">
                    {metadata.resolvedCandidates} resolved
                  </span>
                )}
                {metadata.qualifiedVenues && (
                  <span className="px-2 py-1 border border-white/10 rounded-md text-gray-400">
                    {metadata.qualifiedVenues} qualified
                  </span>
                )}
                <span className="px-2 py-1 border border-white/10 rounded-md text-gray-400 font-medium">
                  {results.length} displayed
                </span>
              </div>
              <div className="text-xs text-gray-400">
                Sorted by <span className="text-white">Score</span>
                <span
                  className="ml-1 cursor-help"
                  title="Score = mentions + upvotes + recency (45-day half-life)"
                >
                  ⓘ
                </span>
              </div>
            </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((r, idx) => (
              <div
                key={idx}
                className="bg-panel border border-white/10 rounded-2xl p-4 hover:border-white/20 shadow-soft transition-colors"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-xl font-semibold leading-tight">{r.name}</h3>
                    {r.cuisine && (
                      <span className="inline-block text-[11px] px-2 py-0.5 rounded-md bg-action/10 text-action border border-action/20 font-medium mt-1">
                        {r.cuisine}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] px-2 py-1 rounded-md border border-white/10 text-gray-300 font-medium whitespace-nowrap">
                    {Number.isFinite(r.score) ? `Score ${r.score.toFixed(2)}` : "N/A"}
                  </span>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-zinc-900/60 border border-white/10 p-2">
                    <div className="text-xs text-muted">Mentions</div>
                    <div className="font-medium">{r.mentions}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-900/60 border border-white/10 p-2">
                    <div className="text-xs text-muted">Threads</div>
                    <div className="font-medium">{r.uniqueThreads}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-900/60 border border-white/10 p-2">
                    <div className="text-xs text-muted">Total upvotes</div>
                    <div className="font-medium">{r.totalUpvotes.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-900/60 border border-white/10 p-2">
                    <div className="text-xs text-muted">Last 30d</div>
                    <div className="font-medium">{r.last30dMentions}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          </>
        ) : metadata ? (
          <div className="text-center text-muted py-12">
            No results matched the current filters. Try widening your search.
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <footer className="border-t border-line mt-24 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-muted">
          <p>Powered by Reddit data • Built with Next.js</p>
        </div>
      </footer>
    </div>
  );
}
