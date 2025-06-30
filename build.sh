#!/bin/bash

# Build script for ToolMeke Astro site

set -e

echo "🔄 Updating data files..."
cp -r ../../data/* src/data/

echo "📦 Installing dependencies..."
npm install

echo "🏗️  Building site..."
npm run build

echo "✅ Build complete! Files are in the dist/ directory."
echo "📁 To deploy, upload the contents of the dist/ directory to your web server."
