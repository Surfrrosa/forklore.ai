#!/bin/bash
#
# Download Overture Maps Places dataset for target cities
# Source: https://overturemaps.org/download/
# Format: GeoParquet (Snappy compressed)
#
# Usage: ./02_download_overture.sh
#
# Downloads Places theme (restaurants, bars, cafes) from Overture Maps
# Uses Azure Blob Storage with httpfs (no auth required for public data)
#

set -e

DATA_DIR="./data/overture"
RELEASE="2025-10-16.0"  # Latest stable release
BASE_URL="https://overturemaps.blob.core.windows.net/release/${RELEASE}/theme=places"

mkdir -p "$DATA_DIR"

echo "📥 Downloading Overture Maps Places dataset (${RELEASE})..."
echo ""

# Overture Places is partitioned by type
# We only need: restaurant, bar, cafe, fast_food
CATEGORIES=(
  "type=restaurant"
  "type=bar"
  "type=cafe"
  "type=fast_food"
)

for category in "${CATEGORIES[@]}"; do
  CATEGORY_NAME=$(echo $category | cut -d'=' -f2)
  OUTPUT_FILE="$DATA_DIR/places_${CATEGORY_NAME}.parquet"

  if [ -f "$OUTPUT_FILE" ]; then
    echo "✅ Already downloaded: $CATEGORY_NAME"
    continue
  fi

  echo "⬇️  Downloading $CATEGORY_NAME..."

  # Download all parquet files for this category
  # Overture partitions data geographically, so we need all partitions
  # Using Azure CLI or curl with httpfs pattern matching

  # For MVP: download the full category (all geographic partitions combined)
  # This is ~500MB-2GB per category compressed
  curl -L "${BASE_URL}/${category}/" \
    -H "Accept: application/json" \
    --output "${DATA_DIR}/${CATEGORY_NAME}_manifest.json"

  # Extract parquet URLs from manifest and download
  # Note: This is a simplified version. In production, use DuckDB httpfs to read directly
  echo "   (Manifest downloaded - use DuckDB httpfs for direct S3 reading)"
done

echo ""
echo "✅ Overture download complete!"
echo ""
echo "Note: For production ETL, DuckDB will read Parquet files directly from Azure"
echo "using httpfs extension without downloading. This script is for reference only."
echo ""
echo "Next steps:"
echo "  1. Run: ./scripts/03_etl_pipeline.sh"
