#!/bin/bash

# Usage: ./process-tools.sh input_file.json

set -e

INPUT_FILE="${1:-tools.json}"

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file not found: $INPUT_FILE"
    echo "Usage: $0 input_file.json"
    exit 1
fi

echo "Processing tools data from $INPUT_FILE..." >&2

jq -s '
# Convert JSONL to array and filter out tools without model numbers
map(select(.modelNumber != "" and .modelNumber != null)) |
# Group by model number
group_by(.modelNumber) | 
map({
    id: .[0].modelNumber | ascii_downcase,
    modelNumber: .[0].modelNumber,
    toolBrand: (.[0].toolBrand | 
        if (. | ascii_downcase) == "dewalt" then "DeWALT"
        elif . == "makita" then "Makita"
        elif . == "bosch" then "Bosch"
        elif . == "milwaukee" then "Milwaukee"
        elif . == "ryobi" then "Ryobi"
        else . end),
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
sort_by(.name)' "$INPUT_FILE"


