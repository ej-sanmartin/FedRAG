#!/bin/bash

# Lambda packaging script for FedRag API
# This script builds and packages the Lambda function for deployment

set -e

echo "🚀 Starting Lambda packaging process..."

# Change to API directory
cd apps/api

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/
rm -f lambda-deployment.zip
rm -f layer.zip

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
fi

# Run validation (type check, lint, test)
echo "✅ Running validation..."
pnpm run validate

# Build for production
echo "🔨 Building Lambda function..."
pnpm run build

# Verify build output
if [ ! -f "dist/index.js" ]; then
    echo "❌ Build failed: dist/index.js not found"
    exit 1
fi

# Create deployment package
echo "📦 Creating deployment package..."
cd dist

# Create a clean zip with just the built code
zip -r ../lambda-deployment.zip . -x "*.map"

cd ..

# Get package size
PACKAGE_SIZE=$(du -h lambda-deployment.zip | cut -f1)
echo "📊 Package size: $PACKAGE_SIZE"

# Verify package contents
echo "📋 Package contents:"
unzip -l lambda-deployment.zip | head -20

echo "✅ Lambda package created successfully: apps/api/lambda-deployment.zip"

# Optional: Create Lambda layer for dependencies (future use)
if [ "$1" = "--with-layer" ]; then
    echo "🔧 Creating Lambda layer..."
    mkdir -p layer/nodejs
    cp package.json layer/nodejs/
    cp package-lock.json layer/nodejs/ 2>/dev/null || true
    
    cd layer/nodejs
    npm install --production --no-optional
    cd ../..
    
    cd layer
    zip -r ../layer.zip .
    cd ..
    
    LAYER_SIZE=$(du -h layer.zip | cut -f1)
    echo "📊 Layer size: $LAYER_SIZE"
    echo "✅ Lambda layer created: apps/api/layer.zip"
fi

echo "🎉 Packaging complete!"