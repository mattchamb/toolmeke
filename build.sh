#!/bin/bash

# Build script for ToolMeke
# This script processes data and builds the Hugo site

set -e

echo "🔧 ToolMeke Build Script"
echo "======================="

# Step 1: Process tool data if source files exist
if [[ -f "data/tools_detailed.json" ]]; then
    echo "📊 Processing tool data..."
    cd data && ./process_tools.sh && cd ..
    echo "✅ Data processing complete"
else
    echo "ℹ️  No source data found, using existing processed data"
fi

# Step 2: Build Hugo site
echo "🏗️  Building Hugo site..."
hugo --minify

echo "✅ Build complete!"
echo ""
echo "🌐 To serve locally: hugo server"
echo "📁 Built site is in: public/"
