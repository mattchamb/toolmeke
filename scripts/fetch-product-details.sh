#!/bin/bash

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_ROOT/data"
TOOLS_INPUT_FILE="$DATA_DIR/tools.json"
DETAILED_OUTPUT_FILE="$DATA_DIR/tools_detailed.json"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Check if tools.json exists
if [ ! -f "$TOOLS_INPUT_FILE" ]; then
    echo "Error: $TOOLS_INPUT_FILE not found. Please run aggregate-data.sh first."
    exit 1
fi

# Function to parse Bunnings product page
parse_bunnings_product() {
    local html_content="$1"
    local original_data="$2"
    
    # Extract model number from the JSON data
    local model_number=$(echo "$html_content" | pup '#__NEXT_DATA__ text{}' 2>/dev/null | jq -r '.props.pageProps.dehydratedState.queries[] | select(.queryKey[0] == "retail-product") | .state.data.classifications[0].features[] | select(.code == "modelNumber") | .featureValues[0].value' 2>/dev/null || echo "")
    
    # Return original data with parsed fields
    echo "$original_data" | jq -c --arg model_number "$model_number" \
                               '. + { modelNumber: $model_number }'
}

# Function to parse Mitre10 product page
parse_mitre10_product() {
    local html_content="$1"
    local original_data="$2"
    
    # TODO: Implement Mitre10-specific parsing logic
    # Extract model number, description, specifications, availability, etc.
    
    # For now, just return original data with empty parsed fields
    echo "$original_data" | jq -c '. + {
        modelNumber: ""
    }'
}

# Function to fetch and parse a single product
fetch_product_details() {
    local tool_data="$1"
    local store=$(echo "$tool_data" | jq -r '.store')
    local url=$(echo "$tool_data" | jq -r '.url')
    local name=$(echo "$tool_data" | jq -r '.name')
    
    echo "Fetching details for: $name ($store)" >&2
    echo "  URL: $url" >&2
    
    # Fetch the product page HTML
    local html_content
    if ! html_content=$(curl -s -L --max-redirs 3 --connect-timeout 30 --max-time 60 \
                       -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
                       "$url" 2>/dev/null); then
        echo "  Error: Failed to fetch URL" >&2
        echo "$tool_data" | jq -c '. + { modelNumber: "FETCH_FAILED" }'
        return
    fi
    
    # Basic check for HTML content
    if [ -z "$html_content" ]; then
        echo "  Error: No content received" >&2
        echo "$tool_data" | jq -c '. + { modelNumber: "NO_CONTENT" }'
        return
    fi
    
    # Parse based on store type
    local parsed_data
    case "$store" in
        "bunnings")
            parsed_data=$(parse_bunnings_product "$html_content" "$tool_data")
            ;;
        "mitre10")
            parsed_data=$(parse_mitre10_product "$html_content" "$tool_data")
            ;;
        *)
            echo "  Warning: Unknown store type '$store'" >&2
            echo "$tool_data" | jq -c '. + { modelNumber: "UNKNOWN_STORE" }'
            ;;
    esac
    
    # Return the parsed data
    echo "$parsed_data"
}

# Function to process all tools
process_all_tools() {
    echo "Processing all tools from $TOOLS_INPUT_FILE..." >&2
    
    # Initialize output file
    > "$DETAILED_OUTPUT_FILE"
    
    local total_tools=$(wc -l < "$TOOLS_INPUT_FILE")
    local current=0
    local successful=0
    local failed=0
    
    echo "Total tools to process: $total_tools" >&2
    
    # Process each tool line by line
    while IFS= read -r tool_line; do
        ((current++))
        echo "" >&2
        echo "=== Processing tool $current of $total_tools ===" >&2
        
        # Fetch and parse product details
        local result
        if result=$(fetch_product_details "$tool_line"); then
            echo "$result" >> "$DETAILED_OUTPUT_FILE"
            ((successful++))
        else
            echo "  Error: Failed to process tool" >&2
            echo "$tool_line" | jq '. + { modelNumber: "PROCESSING_ERROR" }' >> "$DETAILED_OUTPUT_FILE"
            ((failed++))
        fi
        
        # Show progress
        echo "  Progress: $current/$total_tools (successful: $successful, failed: $failed)" >&2
        
        # Add a small delay to be respectful to the servers
        sleep 2
        
    done < "$TOOLS_INPUT_FILE"
    
    echo "" >&2
    echo "=== Processing Complete ===" >&2
    echo "Total processed: $current" >&2
    echo "Successful: $successful" >&2
    echo "Failed/Skipped: $failed" >&2
    echo "Detailed output saved to: $DETAILED_OUTPUT_FILE" >&2
}

# Function to process a limited number of tools for testing
process_sample_tools() {
    local sample_size=${1:-10}
    echo "Processing first $sample_size tools from $TOOLS_INPUT_FILE (sample mode)..." >&2
    
    # Initialize output file
    > "$DETAILED_OUTPUT_FILE"
    
    local current=0
    local successful=0
    local failed=0
    
    # Process first N tools
    while IFS= read -r tool_line && [ $current -lt $sample_size ]; do
        ((current++))
        echo "" >&2
        echo "=== Processing sample tool $current of $sample_size ===" >&2
        
        # Fetch and parse product details
        local result
        if result=$(fetch_product_details "$tool_line"); then
            echo "$result" >> "$DETAILED_OUTPUT_FILE"
            ((successful++))
        else
            echo "  Error: Failed to process tool" >&2
            echo "$tool_line" | jq '. + { modelNumber: "PROCESSING_ERROR" }' >> "$DETAILED_OUTPUT_FILE"
            ((failed++))
        fi
        
        # Show progress
        echo "  Progress: $current/$sample_size (successful: $successful, failed: $failed)" >&2
        
        # Add a small delay to be respectful to the servers
        sleep 2
        
    done < "$TOOLS_INPUT_FILE"
    
    echo "" >&2
    echo "=== Sample Processing Complete ===" >&2
    echo "Sample processed: $current" >&2
    echo "Successful: $successful" >&2
    echo "Failed/Skipped: $failed" >&2
    echo "Detailed output saved to: $DETAILED_OUTPUT_FILE" >&2
}

echo "Starting product details fetching..." >&2

# Parse command line arguments
case "${1:-sample}" in
    "all")
        process_all_tools
        ;;
    "sample")
        sample_size=${2:-10}
        process_sample_tools "$sample_size"
        ;;
    *)
        echo "Usage: $0 [all|sample] [sample_size]" >&2
        echo "  all                 - Process all tools (this may take a very long time)" >&2
        echo "  sample [N]          - Process first N tools (default: 10) for testing" >&2
        echo "" >&2
        echo "Examples:" >&2
        echo "  $0 sample 5         - Process first 5 tools" >&2
        echo "  $0 sample           - Process first 10 tools" >&2
        echo "  $0 all              - Process all tools" >&2
        exit 1
        ;;
esac

echo "Product details fetching complete!" >&2
