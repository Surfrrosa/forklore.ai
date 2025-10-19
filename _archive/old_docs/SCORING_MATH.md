# Scoring Mathematics

## Overview

Forklore.ai uses two complementary scoring systems to rank restaurants:

1. **Iconic Score**: Long-term consensus quality (all-time)
2. **Trending Score**: Recent momentum and buzz (last 90 days)

Both use Bayesian statistical methods to prevent low-sample flukes and ensure rankings reflect genuine community consensus.

---

## Iconic Score: Wilson Score Interval

### The Problem
Simple averaging fails when sample sizes vary:
- Restaurant A: 1 mention, 50 upvotes → 100% "approval"
- Restaurant B: 100 mentions, 4,500 upvotes → 90% "approval"

Naive ranking would put A above B, which is clearly wrong.

### The Solution: Wilson Score (Lower Bound)

We use the **Wilson Score Interval** lower bound at 95% confidence:

```sql
wilson_score = (p + z²/2n - z√(p(1-p)/n + z²/4n²)) / (1 + z²/n)
```

Where:
- `p` = success rate (upvotes / total_engagement_proxy)
- `n` = trials (mentions × 100, assuming ~100 views per mention)
- `z` = 1.96 (95% confidence interval)

**Key Properties:**
- Low-sample results get penalized (wide confidence interval)
- High-sample results stabilize around true mean
- Prevents viral outliers from dominating consensus

### Our Implementation

```sql
iconic_score =
  -- Wilson lower bound (scaled 1M for readability)
  wilson_lower_bound * 1,000,000

  -- Thread diversity bonus: +50 per unique thread
  + (unique_threads * 50)

  -- Mention volume bonus: +5 per mention
  + (total_mentions * 5)

  -- Mild age normalization: favor recent over ancient
  / LOG(days_since_2020 + 2)
```

**Minimum Threshold:** 3 mentions required

---

## Trending Score: Exponential Decay

### The Problem
Hard cutoffs (e.g., "last 90 days") create ranking cliffs:
- Mention on day 89: Full weight
- Mention on day 91: Zero weight

This creates artificial volatility.

### The Solution: Exponential Decay with Half-Life

Each mention's contribution decays smoothly over time:

```sql
contribution = upvotes * e^(-ln(2) * days_ago / half_life)
```

**Half-life = 14 days**: A mention loses 50% of its weight every 2 weeks.

| Days Ago | Weight Remaining |
|----------|------------------|
| 0        | 100%            |
| 14       | 50%             |
| 28       | 25%             |
| 42       | 12.5%           |
| 90       | ~1%             |

### Our Implementation

```sql
trending_score =
  -- Decay-weighted engagement sum
  Σ(upvotes_i * e^(-ln(2) * days_ago_i / 14)) * 100

  -- Recency multiplier for very fresh activity
  * CASE
      WHEN last_seen < 24h  THEN 2.0x
      WHEN last_seen < 7d   THEN 1.5x
      ELSE 1.0x
    END

  -- Thread diversity bonus
  + (unique_threads * 20)
```

**Minimum Threshold:** 2 mentions in last 90 days

---

## Comparison to Old Scoring

### Old Iconic Formula (Naive)
```sql
iconic_old = (mentions * 10 + threads * 50 + upvotes * 2) / LOG(age)
```

**Problems:**
- 1 viral mention could beat 100 consistent mentions
- No statistical confidence adjustment
- Linear weight on raw counts

### New Iconic Formula (Wilson)
```sql
iconic_new = wilson_lower_bound(upvotes, mentions * 100) * 1M
             + threads * 50
             + mentions * 5
             / LOG(age)
```

**Improvements:**
- Bayesian smoothing prevents flukes
- Lower bound ensures 95% confidence
- Sample size automatically penalizes outliers

---

### Old Trending Formula (Hard Cutoff)
```sql
trending_old = (mentions_90d * 20 + upvotes_90d * 3)
               / days_since_last_mention
```

**Problems:**
- Hard 90-day cliff creates volatility
- Equal weight for day-1 and day-89 mentions
- Division by recency creates instability

### New Trending Formula (Exponential Decay)
```sql
trending_new = Σ(score_i * e^(-0.693 * days_i / 14)) * 100
               * recency_multiplier
               + threads * 20
```

**Improvements:**
- Smooth decay (no cliffs)
- Recent mentions naturally weighted higher
- Stable rankings as time progresses

---

## Mathematical Properties

### Wilson Score Properties

1. **Conservative Estimates**: Always underestimates true approval rate
2. **Sample Size Penalty**: Wider intervals for fewer samples
3. **Asymptotic Correctness**: Approaches true rate as n → ∞
4. **Monotonic in Quality**: Higher approval → higher score (given same n)

### Exponential Decay Properties

1. **Memoryless**: Decay rate independent of start time
2. **Smooth**: No discontinuities or cliffs
3. **Tunable**: Adjust half-life to control recency bias
4. **Stable**: Rankings change gradually, not suddenly

---

## Tuning Parameters

### Current Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Wilson confidence | 95% (z=1.96) | Industry standard |
| Assumed views/mention | 100 | Conservative proxy |
| Trending half-life | 14 days | ~2 weeks feels "fresh" |
| Iconic min mentions | 3 | Prevent 1-off flukes |
| Trending min mentions | 2 | Lower bar for recency |
| 24h recency boost | 2.0x | Amplify "happening now" |
| 7d recency boost | 1.5x | Moderate recent boost |

### Adjusting for Different Cities

Smaller cities might need:
- Lower minimum thresholds (e.g., 2 iconic, 1 trending)
- Longer half-life (e.g., 21 days) for less frequent updates

Larger cities might need:
- Higher minimum thresholds (e.g., 5 iconic, 3 trending)
- Shorter half-life (e.g., 10 days) for faster trend cycles

---

## References

- **Wilson Score Interval**: [Evan Miller - How Not To Sort By Average Rating](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)
- **Exponential Decay**: [Hacker News Ranking Algorithm](https://medium.com/hacking-and-gonzo/how-hacker-news-ranking-algorithm-works-1d9b0cf2c08d)
- **Bayesian Smoothing**: [David Robinson - Understanding Empirical Bayes](http://varianceexplained.org/r/empirical_bayes_baseball/)

---

## Example Calculation

### Iconic Score Example

**Restaurant: Katz's Delicatessen**
- Total mentions: 50
- Unique threads: 20
- Total upvotes: 1,200
- Assumed views: 50 × 100 = 5,000

Wilson calculation:
```
p = 1200 / 5000 = 0.24
n = 5000
z = 1.96

wilson_lower = 0.226  (via formula)
scaled = 226,000

iconic_score = 226,000 + (20 * 50) + (50 * 5) / LOG(days)
             ≈ 227,250 / 1.8
             ≈ 126,250
```

### Trending Score Example

**Restaurant: New Pizza Spot**
- Mentions with decay weights:
  - 2 days ago, 30 upvotes: 30 × 0.91 = 27.3
  - 7 days ago, 20 upvotes: 20 × 0.74 = 14.8
  - 14 days ago, 15 upvotes: 15 × 0.50 = 7.5
  - Total: 49.6

```
base = 49.6 * 100 = 4,960
recency_boost = 1.5x (last seen 7d ago)
diversity = 3 threads * 20 = 60

trending_score = 4,960 * 1.5 + 60 = 7,500
```

---

**Last Updated**: 2025-10-18
**Version**: 2.0 (Wilson + Exponential Decay)
