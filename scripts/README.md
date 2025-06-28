# Scripts Directory

This directory contains data processing scripts for the ToolMeke Hugo site.

## Directory Structure

- `scripts/data/` - Working directory for intermediate data files (not committed to git)
- `../data/` - Hugo data directory containing final processed files for the site

## Scripts

1. **aggregate-data.sh** - Fetches raw tool data from Bunnings and Mitre10
   - Output: `scripts/data/tools.json`
   - Copies final file to: `data/tools.json`

2. **fetch-product-details.sh** - Scrapes individual product pages for model numbers
   - Input: `scripts/data/tools.json`
   - Output: `scripts/data/tools_detailed.json`

3. **process_tools.sh** - Processes detailed data into Hugo-friendly format
   - Input: `scripts/data/tools_detailed.json`
   - Output: Multiple files in `data/` directory for Hugo

## Usage

Run scripts in order:
```bash
./aggregate-data.sh
./fetch-product-details.sh sample 10  # or 'all' for full processing
./process_tools.sh
```

The Hugo `data/` directory will contain only the final processed files needed by Hugo templates.
