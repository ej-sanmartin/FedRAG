#!/bin/bash

# Deployment validation script
# Validates that the Lambda package is ready for deployment

set -e

PACKAGE_PATH="apps/api/lambda-deployment.zip"

echo "🔍 Validating Lambda deployment package..."

# Check if package exists
if [ ! -f "$PACKAGE_PATH" ]; then
    echo "❌ Package not found: $PACKAGE_PATH"
    echo "Run 'make package-lambda' first"
    exit 1
fi

# Check package size (Lambda has a 50MB limit for direct upload)
PACKAGE_SIZE_BYTES=$(stat -f%z "$PACKAGE_PATH" 2>/dev/null || stat -c%s "$PACKAGE_PATH")
PACKAGE_SIZE_MB=$((PACKAGE_SIZE_BYTES / 1024 / 1024))

echo "📊 Package size: ${PACKAGE_SIZE_MB}MB"

if [ $PACKAGE_SIZE_MB -gt 50 ]; then
    echo "⚠️  Warning: Package size exceeds 50MB limit for direct upload"
    echo "   Consider using S3 for deployment or creating a Lambda layer"
fi

# Validate package contents
echo "🔍 Validating package structure..."

# Check for required files
REQUIRED_FILES=("index.js" "package.json")
MISSING_FILES=()

for file in "${REQUIRED_FILES[@]}"; do
    if ! unzip -l "$PACKAGE_PATH" | grep -q "$file"; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo "❌ Missing required files:"
    printf '   - %s\n' "${MISSING_FILES[@]}"
    exit 1
fi

# Check for common issues
echo "🔍 Checking for common issues..."

# Check if source maps are excluded (they shouldn't be in production)
if unzip -l "$PACKAGE_PATH" | grep -q "\.map$"; then
    echo "⚠️  Warning: Source maps found in package (consider excluding for production)"
fi

# Check if node_modules are included (they shouldn't be with external AWS SDK)
if unzip -l "$PACKAGE_PATH" | grep -q "node_modules/"; then
    echo "⚠️  Warning: node_modules found in package (AWS SDK should be external)"
fi

echo "✅ Package validation complete!"
echo "📦 Ready for deployment: $PACKAGE_PATH"