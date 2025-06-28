#!/bin/bash

# Script to process tools_detailed.json and create Hugo-friendly data files
# This script converts JSONL to proper JSON arrays and creates aggregated data

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCRIPT_DATA_DIR="$SCRIPT_DIR/data"
HUGO_DATA_DIR="$PROJECT_ROOT/data"
INPUT_FILE="$SCRIPT_DATA_DIR/tools_detailed.json"
OUTPUT_DIR="$SCRIPT_DATA_DIR/processed"

echo "Processing tools data..."

# Check if input file exists
if [[ ! -f "$INPUT_FILE" ]]; then
    echo "Error: $INPUT_FILE not found"
    echo "Please run fetch-product-details.sh first to generate the detailed tools data."
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Step 1: Convert JSONL to JSON array
echo "Converting JSONL to JSON array..."
echo "[" > "$OUTPUT_DIR/tools_raw.json"
sed 's/$/,/' "$INPUT_FILE" | sed '$ s/,$//' >> "$OUTPUT_DIR/tools_raw.json"
echo "]" >> "$OUTPUT_DIR/tools_raw.json"

# Step 2: Extract unique brands
echo "Extracting brands..."
jq -r '.[].toolBrand' "$OUTPUT_DIR/tools_raw.json" | sort -u > "$OUTPUT_DIR/brands_list.txt"

# Step 3: Extract unique stores
echo "Extracting stores..."
jq -r '.[].store' "$OUTPUT_DIR/tools_raw.json" | sort -u > "$OUTPUT_DIR/stores_list.txt"

# Step 4: Create brands JSON
echo "Creating brands data..."
jq -r '.[].toolBrand' "$OUTPUT_DIR/tools_raw.json" | sort | uniq -c | sort -nr | \
while read count brand; do
    slug=$(echo "$brand" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g' | sed 's/&/and/g')
    echo "{\"name\":\"$brand\",\"slug\":\"$slug\",\"toolCount\":$count}"
done | jq -s '.' > "$OUTPUT_DIR/brands.json"

# Step 5: Group tools by model number and create aggregated data
echo "Grouping tools by model number..."
jq '
group_by(.modelNumber) | 
map({
  modelNumber: .[0].modelNumber,
  toolBrand: .[0].toolBrand,
  name: .[0].name,
  stores: map({
    store: .store,
    name: .name,
    price: .price,
    url: .url,
    effectivePrice: (if .price.promo then .price.promo else .price.rrp end)
  }),
  storeCount: length,
  priceRange: {
    min: (map(if .price.promo then .price.promo else .price.rrp end) | min),
    max: (map(if .price.promo then .price.promo else .price.rrp end) | max)
  },
  categories: (.[0].name | ascii_downcase | 
    if test("drill") then ["drill"]
    elif test("saw") then ["saw"] 
    elif test("grinder") then ["grinder"]
    elif test("sander") then ["sander"]
    elif test("battery|charger") then ["battery"]
    elif test("impact|wrench") then ["impact"]
    elif test("hammer") then ["hammer"]
    elif test("light|torch") then ["light"]
    elif test("planer") then ["planer"]
    elif test("router") then ["router"]
    elif test("jigsaw") then ["jigsaw"]
    elif test("nailer|brad") then ["nailer"]
    elif test("compressor") then ["compressor"]
    elif test("combo|kit|piece") then ["combo"]
    else ["other"] end)
}) | 
sort_by(.name)
' "$OUTPUT_DIR/tools_raw.json" > "$OUTPUT_DIR/tools_processed.json"

# Step 6: Create individual brand files
echo "Creating individual brand files..."
while read brand; do
    slug=$(echo "$brand" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g' | sed 's/&/and/g')
    jq --arg brand "$brand" '[.[] | select(.toolBrand == $brand)]' "$OUTPUT_DIR/tools_processed.json" > "$OUTPUT_DIR/brand_$slug.json"
done < "$OUTPUT_DIR/brands_list.txt"

# Step 7: Create summary statistics
echo "Creating summary statistics..."
total_tools=$(jq 'length' "$OUTPUT_DIR/tools_processed.json")
total_brands=$(wc -l < "$OUTPUT_DIR/brands_list.txt")
total_stores=$(wc -l < "$OUTPUT_DIR/stores_list.txt")

# Convert text files to JSON arrays
jq -R . "$OUTPUT_DIR/brands_list.txt" | jq -s . > "$OUTPUT_DIR/brands_array.json"
jq -R . "$OUTPUT_DIR/stores_list.txt" | jq -s . > "$OUTPUT_DIR/stores_array.json"

jq -n \
  --argjson totalTools "$total_tools" \
  --argjson totalBrands "$total_brands" \
  --argjson totalStores "$total_stores" \
  --slurpfile brands "$OUTPUT_DIR/brands_array.json" \
  --slurpfile stores "$OUTPUT_DIR/stores_array.json" \
  '{
    totalTools: $totalTools,
    totalBrands: $totalBrands, 
    totalStores: $totalStores,
    brands: $brands[0],
    stores: $stores[0],
    lastUpdated: "2025-06-28"
  }' > "$OUTPUT_DIR/stats.json"

# Step 8: Create Hugo-ready data files (copy to Hugo data directory)
echo "Creating Hugo data files..."

# Ensure Hugo data directory exists
mkdir -p "$HUGO_DATA_DIR"

# Copy main files to Hugo data directory
cp "$OUTPUT_DIR/tools_processed.json" "$HUGO_DATA_DIR/tools.json"
cp "$OUTPUT_DIR/brands.json" "$HUGO_DATA_DIR/brands.json" 
cp "$OUTPUT_DIR/stats.json" "$HUGO_DATA_DIR/stats.json"

# Copy brand files to Hugo data directory
cp "$OUTPUT_DIR"/brand_*.json "$HUGO_DATA_DIR/"

echo "Processing complete!"
echo ""
echo "Hugo data files created in $HUGO_DATA_DIR:"
echo "- tools.json ($total_tools tools)"
echo "- brands.json ($total_brands brands)" 
echo "- stats.json (summary)"
echo "- brand_*.json (individual brand files)"
echo ""
echo "Working files preserved in $SCRIPT_DATA_DIR/processed/"
echo ""
echo "Summary:"
echo "- Total tools: $total_tools"
echo "- Total brands: $total_brands"
echo "- Total stores: $total_stores"
