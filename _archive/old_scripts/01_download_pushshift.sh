#!/bin/bash
#
# Download Pushshift Reddit dumps for target subreddits
# Source: Academic Torrents (https://academictorrents.com/details/30dee5f0406da7a353aff6a8caa2d54fd01f2ca1)
#
# Usage: ./01_download_pushshift.sh [YYYY-MM]
#
# Downloads:
# - RC_YYYY-MM.zst (comments)
# - RS_YYYY-MM.zst (submissions/posts)
#

set -e

YEAR_MONTH=${1:-"2024-12"}  # Default to Dec 2024
BASE_URL="https://files.pushshift.io/reddit"
DATA_DIR="./data/pushshift"

mkdir -p "$DATA_DIR"

echo "📥 Downloading Pushshift data for $YEAR_MONTH..."

# Download comments
COMMENTS_FILE="RC_${YEAR_MONTH}.zst"
if [ ! -f "$DATA_DIR/$COMMENTS_FILE" ]; then
  echo "⬇️  Downloading comments: $COMMENTS_FILE"
  curl -L "$BASE_URL/comments/$COMMENTS_FILE" -o "$DATA_DIR/$COMMENTS_FILE"
else
  echo "✅ Comments already downloaded: $COMMENTS_FILE"
fi

# Download submissions
SUBMISSIONS_FILE="RS_${YEAR_MONTH}.zst"
if [ ! -f "$DATA_DIR/$SUBMISSIONS_FILE" ]; then
  echo "⬇️  Downloading submissions: $SUBMISSIONS_FILE"
  curl -L "$BASE_URL/submissions/$SUBMISSIONS_FILE" -o "$DATA_DIR/$SUBMISSIONS_FILE"
else
  echo "✅ Submissions already downloaded: $SUBMISSIONS_FILE"
fi

echo "✅ Download complete!"
echo ""
echo "Next steps:"
echo "  1. Run: ./scripts/02_download_overture.sh"
echo "  2. Run: ./scripts/03_etl_pipeline.sh $YEAR_MONTH"
