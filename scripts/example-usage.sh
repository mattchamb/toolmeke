#!/bin/bash

# Example usage of the simplified tool data collection system

set -e

echo "=== Tool Data Collection Example ==="
echo ""

# Method 1: Sequential collection
echo "Method 1: Sequential collection"
echo "Run each store scraper individually:"
echo "  ./get-store-data.sh bunnings"
echo "  ./get-store-data.sh mitre10" 
echo "  ./get-store-data.sh placemakers"
echo ""

# Method 2: Parallel collection using GNU parallel
echo "Method 2: Parallel collection (requires GNU parallel)"
echo "  echo 'bunnings mitre10 placemakers' | tr ' ' '\n' | parallel ./get-store-data.sh {}"
echo ""

# Method 3: Parallel collection with custom output files
echo "Method 3: Parallel with custom output files"
echo "  parallel ./get-store-data.sh {} {}_data.json ::: bunnings mitre10 placemakers"
echo ""

# Combining data
echo "Combining store data:"
echo "  ./combine-store-data.sh tools.json bunnings_tools.json mitre10_tools.json placemakers_tools.json"
echo ""

# Processing data
echo "Processing data for Hugo:"
echo "  ./process-tools-simple.sh tools.json"
echo ""

# Full pipeline example
echo "=== Full Pipeline Example ==="
echo ""
echo "# Collect data in parallel"
echo "echo 'bunnings mitre10 placemakers' | tr ' ' '\n' | parallel ./get-store-data.sh {}"
echo ""
echo "# Combine data"
echo "./combine-store-data.sh tools.json bunnings_tools.json mitre10_tools.json placemakers_tools.json"
echo ""
echo "# Process for Hugo"
echo "./process-tools-simple.sh tools.json"
echo ""

echo "=== Files Created ==="
echo "Store data files:"
echo "  - bunnings_tools.json"
echo "  - mitre10_tools.json"
echo "  - placemakers_tools.json"
echo ""
echo "Combined data:"
echo "  - tools.json"
echo ""
echo "Hugo data files (in ../data/):"
echo "  - tools.json (processed)"
echo "  - brands.json"
echo "  - stats.json"
echo "  - brand_*.json"
echo ""

# Uncomment to actually run the pipeline
if [ "$1" = "run" ]; then
    echo "Running the full pipeline..."
    echo ""
    
    echo "Collecting data in parallel..."
    echo 'bunnings mitre10 placemakers' | tr ' ' '\n' | parallel ./get-store-data.sh {}
    
    echo ""
    echo "Combining data..."
    ./combine-store-data.sh tools.json bunnings_tools.json mitre10_tools.json placemakers_tools.json
    
    echo ""
    echo "Processing for Hugo..."
    ./process-tools-simple.sh tools.json
    
    echo ""
    echo "Pipeline complete!"
fi
