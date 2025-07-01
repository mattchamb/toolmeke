# Tool Data Collection Scripts

Simple tool data collection system for the Astro-based ToolMeke website.

## Overview

This system collects product data from New Zealand hardware stores and processes it for Astro. It's designed to be simple and work well with GNU `parallel` for concurrent execution.

The system now uses a single `tools.json` file as the primary data source, with brands data derived at runtime for better consistency.

## Scripts

- `get-store-data.sh` - Fetches data from a single store
- `combine-store-data.sh` - Combines multiple store data files
- `process-tools-simple.sh` - Processes data for Astro (creates tools.json only)
- `example-usage.sh` - Shows usage examples

## Basic Usage

### Collect data from a single store:
```bash
./get-store-data.sh bunnings
./get-store-data.sh mitre10  
./get-store-data.sh placemakers
```

### Collect data in parallel (requires GNU parallel):
```bash
echo 'bunnings mitre10 placemakers' | tr ' ' '\n' | parallel ./get-store-data.sh {}
```

### Combine store data:
```bash
./combine-store-data.sh tools.json bunnings_tools.json mitre10_tools.json placemakers_tools.json
```

### Process for Astro:
```bash
./process-tools-simple.sh tools.json
```

This creates:
- `src/content/tools/tools.json` - Main tools database
- `src/content/brands/brands.json` - Empty file (brands derived at runtime)

## Complete Pipeline

```bash
# Collect data in parallel
echo 'bunnings mitre10 placemakers' | tr ' ' '\n' | parallel ./get-store-data.sh {}

# Combine data
./combine-store-data.sh tools.json bunnings_tools.json mitre10_tools.json placemakers_tools.json

# Process for Astro
./process-tools-simple.sh tools.json
```

## Data Structure Changes

The system has been simplified to use a single input file (`tools.json`) with brands data derived at runtime from the tools data. This ensures consistency and reduces file management complexity.

## Dependencies

Required tools:
- `curl` - HTTP requests
- `jq` - JSON processing  
- `pup` - HTML parsing
- `parallel` - GNU parallel (optional, for concurrent execution)

Install on macOS:
```bash
brew install curl jq parallel
go install github.com/ericchiang/pup@latest
```

## Output Files

The system creates these files:

**Store data files:**
- `bunnings_tools.json`
- `mitre10_tools.json` 
- `placemakers_tools.json`

**Combined data:**
- `tools.json` (JSONL format)

**Astro content files (in `../src/content/`):**
- `tools/tools.json` (processed for Astro)
- `brands/brands.json`
- `stats.json` (summary statistics)

**Note:** Individual brand files (`brand_*.json`) are no longer generated since Astro filters tools from the main `tools.json` file dynamically.

## Store Support

- **Bunnings NZ** - Main hardware chain
- **Mitre10 NZ** - Hardware and trade supplies
- **Placemakers NZ** - Trade and construction supplies

## Custom Output Files

You can specify custom output files:
```bash
./get-store-data.sh bunnings my_bunnings_data.json
./get-store-data.sh mitre10 data/mitre10.json
```

## Example Script

Run `./example-usage.sh` to see usage examples, or `./example-usage.sh run` to execute the full pipeline.

## Design Principles

- **Simple**: Single-purpose scripts that do one thing well
- **Composable**: Scripts can be combined using standard Unix tools
- **Parallel-friendly**: Designed to work with GNU `parallel`
- **No magic**: No automatic discovery or permission handling

## Legacy Scripts

The following scripts are preserved for reference but the new simple system is recommended:
- `aggregate-data.sh` - Old monolithic data collection script
- `fetch-product-details.sh` - Old product detail fetcher  

These can be removed once you're confident the new system works for your needs.

## Adding New Stores

To add a new store to `get-store-data.sh`:
1. Add a new `fetch_<storename>()` function following the pattern
2. Add the store name to the case statement in the main execution
3. Update the usage message
4. Test with `./get-store-data.sh <storename>`
