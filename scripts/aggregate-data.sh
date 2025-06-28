#!/bin/bash

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_ROOT/data"
OUTPUT_FILE="$DATA_DIR/tools.json"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Initialize empty file for all results
> "$OUTPUT_FILE"

# Base URL for the API
BASE_URL="https://www.bunnings.co.nz/search/products?brandname=DEWALT%7CBosch+Professional%7CMakita%7CAEG%7CMakita+LXT%7CMakita+XGT&sort=NameAscending&pageSize=36&supercategories=Power+Tools--power-tools--L2"

page=1
total_items=0
echo "Starting data aggregation..."

while true; do
    echo "Fetching page $page..."
    
    # Construct URL with current page number
    url="${BASE_URL}&page=${page}"
    
    # Fetch data and extract results
    results=$(curl -s "$url" | pup '#__NEXT_DATA__ text{}' | jq -c '.props.pageProps.initialState.global.searchResults.data.results.[]' 2>/dev/null || echo "null")
    
    # Check if we got null (no more results)
    if [ "$results" = "null" ] || [ -z "$results" ]; then
        echo "No more results found. Finished at page $((page-1))."
        break
    fi
    
    # Count items on this page and append to file
    page_count=$(echo "$results" | wc -l)
    echo "$results" >> "$OUTPUT_FILE"
    
    # Update total count
    ((total_items += page_count))
    echo "Page $page complete. Items on this page: $page_count. Total items so far: $total_items"
    
    # Increment page counter
    ((page++))
    
    # Small delay to be respectful to the server
    sleep 1
done

echo "Data aggregation complete! Total items collected: $total_items"
echo "Output saved to: $OUTPUT_FILE"




