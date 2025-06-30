#!/bin/bash

# Simple store data fetcher
# Usage: ./get-store-data.sh <store> [output_file]

set -e

STORE="$1"
OUTPUT_FILE="${2:-${STORE}_tools.json}"

if [ -z "$STORE" ]; then
    echo "Usage: $0 <store> [output_file]"
    echo "Available stores: bunnings, mitre10, placemakers"
    exit 1
fi

# Initialize output file
> "$OUTPUT_FILE"

# Normalize brand names
normalize_brand() {
    local brand="$1"
    case "$(echo "$brand" | tr '[:upper:]' '[:lower:]')" in
        "dewalt") echo "DEWALT" ;;
        "milwaukee") echo "Milwaukee" ;;
        "hikoki") echo "HiKOKI" ;;
        "makita lxt"|"makita xgt") echo "Makita" ;;
        "bosch professional") echo "Bosch" ;;
        "aeg") echo "AEG" ;;
        *) echo "$brand" ;;
    esac
}

# Create standardized tool JSON
create_tool_json() {
    local brand="$1"
    local name="$2"
    local model_number="$3"
    local price_rrp="$4"
    local price_promo="$5"
    local url="$6"
    local store="$7"
    
    jq -nc \
        --arg brand "$(normalize_brand "$brand")" \
        --arg name "$name" \
        --arg model_number "$model_number" \
        --arg url "$url" \
        --arg store "$store" \
        --arg price_rrp "$price_rrp" \
        --arg price_promo "$price_promo" \
        '{
            toolBrand: $brand,
            name: $name,
            modelNumber: $model_number,
            price: {
                rrp: (if $price_rrp != "" and $price_rrp != "null" then ($price_rrp | tonumber) else null end),
                promo: (if $price_promo != "" and $price_promo != "null" then ($price_promo | tonumber) else null end)
            },
            url: $url,
            store: $store
        }'
}

# Fetch Bunnings data
fetch_bunnings() {
    echo "Fetching Bunnings data..." >&2
    
    local base_url="https://www.bunnings.co.nz/search/products?brandname=DEWALT%7CBosch+Professional%7CMakita%7CAEG%7CMakita+LXT%7CMakita+XGT&sort=NameAscending&pageSize=36&supercategories=Power+Tools--power-tools--L2"
    local page=1
    local total_items=0
    
    while true; do
        echo "  Fetching Bunnings page $page..." >&2
        
        local url="${base_url}&page=${page}"
        local html_content=$(curl -s "$url" 2>/dev/null || echo "")
        
        if [ -z "$html_content" ]; then
            echo "  Failed to fetch page $page" >&2
            break
        fi
        
        local json_data=$(echo "$html_content" | pup '#__NEXT_DATA__ text{}' 2>/dev/null || echo "")
        if [ -z "$json_data" ]; then
            echo "  No more results found at page $page" >&2
            break
        fi
        
        local results=$(echo "$json_data" | jq -c '.props.pageProps.initialState.global.searchResults.data.results[]?' 2>/dev/null || echo "")
        if [ -z "$results" ]; then
            echo "  No more results found at page $page" >&2
            break
        fi
        
        local page_count=0
        while IFS= read -r result; do
            if [ -n "$result" ]; then
                local brand=$(echo "$result" | jq -r '.raw.brandname // ""')
                local name=$(echo "$result" | jq -r '.title // .Title // ""')
                local price=$(echo "$result" | jq -r '.raw.price // ""')
                local product_url=$(echo "$result" | jq -r '.raw.productroutingurl // ""')
                local full_url=""
                
                if [ -n "$product_url" ]; then
                    full_url="https://www.bunnings.co.nz$product_url"
                fi
                
                if [ -n "$name" ] && [ -n "$brand" ]; then
                    create_tool_json "$brand" "$name" "" "$price" "" "$full_url" "bunnings" >> "$OUTPUT_FILE"
                    ((page_count++))
                fi
            fi
        done <<< "$results"
        
        if [ "$page_count" -eq 0 ]; then
            echo "  No valid products found on page $page" >&2
            break
        fi
        
        total_items=$((total_items + page_count))
        echo "  Page $page: $page_count items (total: $total_items)" >&2
        ((page++))
        sleep 1
    done
    
    echo "Bunnings complete: $total_items items" >&2
}

# Fetch Mitre10 data
fetch_mitre10() {
    echo "Fetching Mitre10 data..." >&2
    
    local page=0
    local total_items=0
    local hits_per_page=1000
    
    while true; do
        echo "  Fetching Mitre10 page $page..." >&2
        
        local api_data="{\"requests\":[{\"indexName\":\"retail_products_relevance\",\"params\":\"facetFilters=%5B%5B%22brandName%3ABosch%22%2C%22brandName%3ABosch%20Professional%22%2C%22brandName%3ADeWALT%22%2C%22brandName%3AHiKOKI%22%2C%22brandName%3AMakita%22%5D%2C%5B%22categoryPath.lvl0%3APower%20Tools%22%5D%5D&attributesToRetrieve=%5B%22*%22,%22-clickAndCollect%22,%22-homeDelivery%22,%22-clickAndCollectMessage%22,%22-storesWithStock%22,%22-homeDeliveryMessage%22%5D%0A&hitsPerPage=${hits_per_page}&page=${page}\"}]}"
        
        local api_response=$(curl -s 'https://cq00o09oxx-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=edc61cb5be5216c9cc02459f13e33729&x-algolia-application-id=CQ00O09OXX' \
                                   -H 'Accept: */*' \
                                   -H 'Content-Type: application/x-www-form-urlencoded' \
                                   --data-raw "$api_data" 2>/dev/null || echo "")
        
        if [ -z "$api_response" ]; then
            echo "  Failed to fetch page $page" >&2
            break
        fi
        
        local hits_on_page=$(echo "$api_response" | jq -r '.results[0].hits | length' 2>/dev/null || echo "0")
        local nb_pages=$(echo "$api_response" | jq -r '.results[0].nbPages // 0' 2>/dev/null || echo "0")
        
        if [ "$hits_on_page" = "0" ]; then
            echo "  No more results found at page $page" >&2
            break
        fi
        
        local results=$(echo "$api_response" | jq -c '.results[0].hits[]?' 2>/dev/null || echo "")
        local page_count=0
        
        while IFS= read -r result; do
            if [ -n "$result" ]; then
                local brand=$(echo "$result" | jq -r '.brandName // ""')
                local name=$(echo "$result" | jq -r '.name // ""')
                local price_rrp=$(echo "$result" | jq -r '.prices.nationalRRP // ""')
                local price_promo=$(echo "$result" | jq -r '.prices.nationalPromo // ""')
                local product_url=$(echo "$result" | jq -r '.url // ""')
                local full_url=""
                
                if [ -n "$product_url" ]; then
                    full_url="https://www.mitre10.co.nz$product_url"
                fi
                
                if [ -n "$name" ] && [ -n "$brand" ]; then
                    create_tool_json "$brand" "$name" "" "$price_rrp" "$price_promo" "$full_url" "mitre10" >> "$OUTPUT_FILE"
                    ((page_count++))
                fi
            fi
        done <<< "$results"
        
        total_items=$((total_items + page_count))
        echo "  Page $page: $page_count items (total: $total_items)" >&2
        
        if [ "$page" -ge "$((nb_pages-1))" ]; then
            echo "  Reached last page ($page)" >&2
            break
        fi
        
        ((page++))
        sleep 1
    done
    
    echo "Mitre10 complete: $total_items items" >&2
}

# Fetch Placemakers data
fetch_placemakers() {
    echo "Fetching Placemakers data..." >&2
    
    local base_url="https://www.placemakers.co.nz/online/tools/c/RCC3?q=%3Atitle%2Basc%3Acategory%3ARWCO1%3Abrand%3AHiKOKI%3Abrand%3AMakita%3Abrand%3AMilwaukee%3Abrand%3ADEWALT%3Abrand%3ADeWalt%3Abrand%3APaslode%3Abrand%3ANilfisk%3Abrand%3ABosch%3Abrand%3AHIKOKI"
    local page=0
    local total_items=0
    
    while true; do
        echo "  Fetching Placemakers page $page..." >&2
        
        local url="${base_url}&page=${page}"
        local html_content=$(curl -s "$url" 2>/dev/null || echo "")
        
        if [ -z "$html_content" ]; then
            echo "  Failed to fetch page $page" >&2
            break
        fi
        
        local temp_file=$(mktemp)
        echo "$html_content" > "$temp_file"
        
        local product_count=$(pup 'div.product-item' < "$temp_file" | grep -c 'class="product-item"' || echo 0)
        
        if [ "$product_count" -eq 0 ]; then
            echo "  No products found on page $page" >&2
            rm -f "$temp_file"
            break
        fi
        
        local page_count=0
        for i in $(seq 1 $product_count); do
            local product_html=$(pup "div.product-item:nth-child($i)" < "$temp_file")
            if [ -n "$product_html" ]; then
                local product_file=$(mktemp)
                echo "$product_html" > "$product_file"
                
                local brand=$(pup 'div.manufacturer text{}' < "$product_file" | tr -d '\n\r' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
                local name=$(pup 'a.name text{}' < "$product_file" | tr -d '\n\r' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
                local url=$(pup 'a.name attr{href}' < "$product_file" | tr -d '\n\r')
                local part_code=$(pup 'div.partCode text{}' < "$product_file" | sed 's/Part Code: //' | tr -d '\n\r' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
                
                local price=$(pup 'div.price.bottomSpace text{}' < "$product_file" | grep -o '\$[0-9,]*\.[0-9]*' | sed 's/\$//;s/,//' | head -1)
                if [ -z "$price" ]; then
                    price=$(pup 'button[data-product-price] attr{data-product-price}' < "$product_file" | head -1)
                fi
                if [ -z "$price" ]; then
                    price=$(pup 'input.productPostPrice attr{value}' < "$product_file" | head -1)
                fi
                
                rm -f "$product_file"
                
                if [ -n "$brand" ] && [ -n "$name" ]; then
                    local full_url=""
                    if [ -n "$url" ] && [[ ! "$url" =~ ^https?:// ]]; then
                        full_url="https://www.placemakers.co.nz$url"
                    fi
                    
                    create_tool_json "$brand" "$name" "$part_code" "$price" "" "$full_url" "placemakers" >> "$OUTPUT_FILE"
                    ((page_count++))
                fi
            fi
        done
        
        rm -f "$temp_file"
        
        if [ "$page_count" -eq 0 ]; then
            echo "  No valid products found on page $page" >&2
            break
        fi
        
        total_items=$((total_items + page_count))
        echo "  Page $page: $page_count items (total: $total_items)" >&2
        ((page++))
        sleep 1
    done
    
    echo "Placemakers complete: $total_items items" >&2
}

# Main execution
case "$STORE" in
    "bunnings")
        fetch_bunnings
        ;;
    "mitre10")
        fetch_mitre10
        ;;
    "placemakers")
        fetch_placemakers
        ;;
    *)
        echo "Error: Unknown store '$STORE'"
        echo "Available stores: bunnings, mitre10, placemakers"
        exit 1
        ;;
esac

echo "Data saved to: $OUTPUT_FILE"
