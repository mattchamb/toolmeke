#!/bin/bash

# Process combined store data into Hugo-compatible format
# Usage: ./process-tools.sh input_file.json

set -e

INPUT_FILE="${1:-tools.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HUGO_DATA_DIR="$PROJECT_ROOT/data"

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file not found: $INPUT_FILE"
    echo "Usage: $0 input_file.json"
    exit 1
fi

echo "Processing tools data from $INPUT_FILE..." >&2

# Ensure Hugo data directory exists
mkdir -p "$HUGO_DATA_DIR"

# Convert JSONL to JSON array and process tools
echo "Converting and processing data..." >&2

jq -s '
# Convert JSONL to array and filter out tools without model numbers
map(select(.modelNumber != "" and .modelNumber != null)) |
# Group by model number
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
        effectivePrice: (if .price.promo and .price.promo > 0 then .price.promo else .price.rrp end)
    }),
    storeCount: length,
    priceRange: {
        min: (map(if .price.promo and .price.promo > 0 then .price.promo else .price.rrp end) | map(select(. != null)) | min),
        max: (map(if .price.promo and .price.promo > 0 then .price.promo else .price.rrp end) | map(select(. != null)) | max)
    },
    categories: [(.[0].name | ascii_downcase | 
        if test("drill") then "drill"
        elif test("saw") then "saw" 
        elif test("grinder") then "grinder"
        elif test("sander") then "sander"
        elif test("battery|charger") then "battery"
        elif test("impact|wrench") then "impact"
        elif test("hammer") then "hammer"
        elif test("light|torch") then "light"
        elif test("planer") then "planer"
        elif test("router") then "router"
        elif test("jigsaw") then "jigsaw"
        elif test("nailer|brad") then "nailer"
        elif test("compressor") then "compressor"
        elif test("combo|kit|piece") then "combo"
        else "other" end)]
}) | 
sort_by(.name)' "$INPUT_FILE" > "$HUGO_DATA_DIR/tools.json"

# Create brand data
echo "Creating brand data..." >&2

jq -s '
# Get all tools with their normalized brands
map(.toolBrand) |
# Group and count by brand
group_by(.) |
map({
    name: .[0],
    slug: (.[0] | ascii_downcase | gsub(" "; "-") | gsub("&"; "and")),
    toolCount: length
}) |
sort_by(-.toolCount)' "$INPUT_FILE" > "$HUGO_DATA_DIR/brands.json"

# Create individual brand files
echo "Creating individual brand files..." >&2

# Get unique brands
brands=($(jq -r '.toolBrand' "$INPUT_FILE" | sort -u))

for brand in "${brands[@]}"; do
    slug=$(echo "$brand" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g' | sed 's/&/and/g')
    jq -s --arg brand "$brand" '
    map(select(.toolBrand == $brand)) |
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
            effectivePrice: (if .price.promo and .price.promo > 0 then .price.promo else .price.rrp end)
        }),
        storeCount: length,
        priceRange: {
            min: (map(if .price.promo and .price.promo > 0 then .price.promo else .price.rrp end) | map(select(. != null)) | min),
            max: (map(if .price.promo and .price.promo > 0 then .price.promo else .price.rrp end) | map(select(. != null)) | max)
        }
    }) |
    sort_by(.name)' "$INPUT_FILE" > "$HUGO_DATA_DIR/brand_$slug.json"
    
    tool_count=$(jq 'length' "$HUGO_DATA_DIR/brand_$slug.json")
    echo "  Created brand_$slug.json with $tool_count tools" >&2
done

# Create statistics
echo "Creating statistics..." >&2

total_tools=$(jq 'length' "$HUGO_DATA_DIR/tools.json")
total_brands=$(jq 'length' "$HUGO_DATA_DIR/brands.json")
stores=($(jq -r '.store' "$INPUT_FILE" | sort -u))
total_stores=${#stores[@]}

jq -n \
    --argjson totalTools "$total_tools" \
    --argjson totalBrands "$total_brands" \
    --argjson totalStores "$total_stores" \
    --argjson brands "$(jq '[.[].name]' "$HUGO_DATA_DIR/brands.json")" \
    --argjson stores "$(printf '%s\n' "${stores[@]}" | jq -R . | jq -s .)" \
    --arg lastUpdated "$(date '+%Y-%m-%d')" \
    '{
        totalTools: $totalTools,
        totalBrands: $totalBrands, 
        totalStores: $totalStores,
        brands: $brands,
        stores: $stores,
        lastUpdated: $lastUpdated
    }' > "$HUGO_DATA_DIR/stats.json"

echo "Processing complete!" >&2
echo "" >&2
echo "Hugo data files created:" >&2
echo "- tools.json ($total_tools tools)" >&2
echo "- brands.json ($total_brands brands)" >&2
echo "- stats.json (summary)" >&2
echo "- brand_*.json (individual brand files)" >&2
echo "" >&2
echo "Output directory: $HUGO_DATA_DIR" >&2
