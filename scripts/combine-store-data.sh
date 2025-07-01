#!/bin/bash

# Combine store data files into a single file
# Usage: ./combine-store-data.sh output_file.json store1_file.json store2_file.json ...

set -e

OUTPUT_FILE="$1"
shift

if [ -z "$OUTPUT_FILE" ] || [ $# -eq 0 ]; then
    echo "Usage: $0 output_file.json store1_file.json store2_file.json ..."
    echo "Example: $0 tools.json bunnings_tools.json mitre10_tools.json placemakers_tools.json"
    exit 1
fi

echo "Combining store data files..." >&2

# Initialize output file
> "$OUTPUT_FILE"

total_items=0

# Process each input file
for store_file in "$@"; do
    if [ -f "$store_file" ]; then
        echo "  Processing $store_file..." >&2
        cat "$store_file" >> "$OUTPUT_FILE"
    else
        echo "  Warning: File not found: $store_file" >&2
    fi
done

echo "Output: $OUTPUT_FILE"
