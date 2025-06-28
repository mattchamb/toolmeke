#!/bin/bash

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_ROOT/data"
COMBINED_OUTPUT_FILE="$DATA_DIR/tools.json"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Function to fetch Bunnings data
fetch_bunnings_data() {
    local output_file="$DATA_DIR/bunnings_tools.json"
    echo "Fetching Bunnings data..."
    
    # Initialize empty file for results
    > "$output_file"
    
    local base_url="https://www.bunnings.co.nz/search/products?brandname=DEWALT%7CBosch+Professional%7CMakita%7CAEG%7CMakita+LXT%7CMakita+XGT&sort=NameAscending&pageSize=36&supercategories=Power+Tools--power-tools--L2"
    local page=1
    local total_items=0
    
    while true; do
        echo "  Fetching Bunnings page $page..."
        
        # Construct URL with current page number
        local url="${base_url}&page=${page}"
        
        # Fetch data and extract results
        local results=$(curl -s "$url" | pup '#__NEXT_DATA__ text{}' | jq -c '.props.pageProps.initialState.global.searchResults.data.results.[] | . + {"store": "bunnings"}' 2>/dev/null || echo "null")
        
        # Check if we got null (no more results)
        if [ "$results" = "null" ] || [ -z "$results" ]; then
            echo "  No more Bunnings results found. Finished at page $((page-1))."
            break
        fi
        
        # Count items on this page and append to file
        local page_count=$(echo "$results" | wc -l)
        echo "$results" >> "$output_file"
        
        # Update total count
        ((total_items += page_count))
        echo "  Bunnings page $page complete. Items on this page: $page_count. Total items so far: $total_items"
        
        # Increment page counter
        ((page++))
        
        # Small delay to be respectful to the server
        sleep 1
    done
    
    echo "Bunnings data collection complete! Total items: $total_items"
    echo "Bunnings output saved to: $output_file"
}

# Function to fetch Mitre10 data
fetch_mitre10_data() {
    local output_file="$DATA_DIR/mitre10_tools.json"
    echo "Fetching Mitre10 data..."
    
    # Initialize empty file for results
    > "$output_file"
    
    local page=0
    local total_items=0
    local hits_per_page=1000
    
    while true; do
        echo "  Fetching Mitre10 page $page..."
        
        # Mitre10 API request with current page
        local api_response=$(curl -s 'https://cq00o09oxx-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=edc61cb5be5216c9cc02459f13e33729&x-algolia-application-id=CQ00O09OXX' \
            -H 'Accept: */*' \
            -H 'Content-Type: application/x-www-form-urlencoded' \
            --data-raw "{\"requests\":[{\"indexName\":\"retail_products_relevance\",\"params\":\"facetFilters=%5B%5B%22brandName%3ABosch%22%2C%22brandName%3ABosch%20Professional%22%2C%22brandName%3ADeWALT%22%2C%22brandName%3AHiKOKI%22%2C%22brandName%3AMakita%22%5D%2C%5B%22categoryPath.lvl0%3APower%20Tools%22%5D%5D&attributesToRetrieve=%5B%22*%22,%22-clickAndCollect%22,%22-homeDelivery%22,%22-clickAndCollectMessage%22,%22-storesWithStock%22,%22-homeDeliveryMessage%22%5D%0A&hitsPerPage=${hits_per_page}&page=${page}\"}]}")
        
        # Check if the response is valid
        if [ -z "$api_response" ] || [ "$api_response" = "null" ]; then
            echo "  Failed to fetch Mitre10 data for page $page"
            break
        fi
        
        # Extract pagination info
        local nb_hits=$(echo "$api_response" | jq -r '.results[0].nbHits // 0' 2>/dev/null || echo "0")
        local nb_pages=$(echo "$api_response" | jq -r '.results[0].nbPages // 0' 2>/dev/null || echo "0")
        local current_page=$(echo "$api_response" | jq -r '.results[0].page // 0' 2>/dev/null || echo "0")
        local hits_on_page=$(echo "$api_response" | jq -r '.results[0].hits | length' 2>/dev/null || echo "0")
        
        echo "  Mitre10 pagination info: page $current_page of $((nb_pages-1)), $hits_on_page items on this page, $nb_hits total items"
        
        # Extract hits and add store identifier
        local results=$(echo "$api_response" | jq -c '.results[0].hits[] | . + {"store": "mitre10"}' 2>/dev/null || echo "null")
        
        if [ "$results" = "null" ] || [ -z "$results" ] || [ "$hits_on_page" = "0" ]; then
            echo "  No more Mitre10 results found. Finished at page $page."
            break
        fi
        
        # Count items on this page and append to file
        local page_count=$(echo "$results" | wc -l)
        echo "$results" >> "$output_file"
        
        # Update total count
        ((total_items += page_count))
        echo "  Mitre10 page $page complete. Items on this page: $page_count. Total items so far: $total_items"
        
        # Check if we've reached the last page
        if [ "$page" -ge "$((nb_pages-1))" ]; then
            echo "  Reached last page ($page) of Mitre10 results."
            break
        fi
        
        # Increment page counter
        ((page++))
        
        # Small delay to be respectful to the server
        sleep 1
    done
    
    echo "Mitre10 data collection complete! Total items: $total_items"
    echo "Mitre10 output saved to: $output_file"
}

# Function to combine all store data
combine_store_data() {
    echo "Combining data from all stores..."
    
    # Initialize combined file
    > "$COMBINED_OUTPUT_FILE"
    
    # Process each store file and extract only required fields
    for store_file in "$DATA_DIR"/*_tools.json; do
        if [ -f "$store_file" ]; then
            echo "  Processing and filtering data from $(basename "$store_file")..."
            
            # Determine store type from filename
            if [[ "$store_file" == *"bunnings"* ]]; then
                # Process Bunnings data: extract name, price, URL, and store
                jq -c '
                    {
                        toolBrand: .raw.brandname,
                        name: (.title // .Title),
                        price: { rrp: .raw.price, promo: null },
                        url: ("https://www.bunnings.co.nz" + .raw.productroutingurl),
                        store: .store
                    }
                ' "$store_file" >> "$COMBINED_OUTPUT_FILE"
            elif [[ "$store_file" == *"mitre10"* ]]; then
                # Process Mitre10 data: extract name, price (prefer promo over RRP), URL, and store
                jq -c '
                    {
                        toolBrand: .brandName,
                        name: .name,
                        price: { rrp: .prices.nationalRRP, promo: .prices.nationalPromo },
                        url: ("https://www.mitre10.co.nz" + .url),
                        store: .store
                    }
                ' "$store_file" >> "$COMBINED_OUTPUT_FILE"
            else
                echo "    Warning: Unknown store type in file $(basename "$store_file"), skipping..."
            fi
        fi
    done
    
    local total_combined=$(wc -l < "$COMBINED_OUTPUT_FILE" 2>/dev/null || echo 0)
    echo "Combined data complete! Total items across all stores: $total_combined"
    echo "Combined output saved to: $COMBINED_OUTPUT_FILE"
}

echo "Starting multi-store data aggregation..."

# Parse command line arguments for store selection
STORES_TO_FETCH=()
if [ $# -eq 0 ]; then
    # Default to all stores if no arguments provided
    STORES_TO_FETCH=("bunnings" "mitre10")
else
    # Use provided store arguments
    STORES_TO_FETCH=("$@")
fi

echo "Will fetch data from stores: ${STORES_TO_FETCH[*]}"

# Fetch data from selected stores - commented out for now to not keep refetching
# for store in "${STORES_TO_FETCH[@]}"; do
#     case "$store" in
#         "bunnings")
#             fetch_bunnings_data
#             ;;
#         "mitre10")
#             fetch_mitre10_data
#             ;;
#         *)
#             echo "Warning: Unknown store '$store'. Supported stores: bunnings, mitre10"
#             ;;
#     esac
# done

# Combine all the data
combine_store_data

echo "Multi-store data aggregation complete!"




