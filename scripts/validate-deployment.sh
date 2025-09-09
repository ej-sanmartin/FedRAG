#!/bin/bash

# Deployment validation script
# Validates Lambda package and optionally tests deployed API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[VALIDATE]${NC} $1"
}

# Check if API URL is provided for live validation
API_URL="$1"
PACKAGE_PATH="apps/api/lambda-deployment.zip"

print_header "Starting deployment validation..."

# Validate Lambda package if it exists
if [ -f "$PACKAGE_PATH" ]; then
    print_header "Validating Lambda deployment package..."

    # Check package size (Lambda has a 50MB limit for direct upload)
    PACKAGE_SIZE_BYTES=$(stat -f%z "$PACKAGE_PATH" 2>/dev/null || stat -c%s "$PACKAGE_PATH")
    PACKAGE_SIZE_MB=$((PACKAGE_SIZE_BYTES / 1024 / 1024))

    print_status "Package size: ${PACKAGE_SIZE_MB}MB"

    if [ $PACKAGE_SIZE_MB -gt 50 ]; then
        print_warning "Package size exceeds 50MB limit for direct upload"
        print_warning "Consider using S3 for deployment or creating a Lambda layer"
    fi

    # Validate package contents
    print_status "Validating package structure..."

    # Check for required files
    REQUIRED_FILES=("index.js" "package.json")
    MISSING_FILES=()

    for file in "${REQUIRED_FILES[@]}"; do
        if ! unzip -l "$PACKAGE_PATH" | grep -q "$file"; then
            MISSING_FILES+=("$file")
        fi
    done

    if [ ${#MISSING_FILES[@]} -gt 0 ]; then
        print_error "Missing required files:"
        printf '   - %s\n' "${MISSING_FILES[@]}"
        exit 1
    fi

    # Check for common issues
    print_status "Checking for common issues..."

    # Check if source maps are excluded (they shouldn't be in production)
    if unzip -l "$PACKAGE_PATH" | grep -q "\.map$"; then
        print_warning "Source maps found in package (consider excluding for production)"
    fi

    # Check if node_modules are included (they shouldn't be with external AWS SDK)
    if unzip -l "$PACKAGE_PATH" | grep -q "node_modules/"; then
        print_warning "node_modules found in package (AWS SDK should be external)"
    fi

    print_status "Package validation complete!"
else
    print_warning "Lambda package not found at $PACKAGE_PATH"
    print_warning "Run 'make package-lambda' to create the package"
fi

# If API URL is provided, test the deployed API
if [ -n "$API_URL" ]; then
    print_header "Testing deployed API at: $API_URL"

    # Check if curl is available
    if ! command -v curl &> /dev/null; then
        print_error "curl is required for API testing but not installed"
        exit 1
    fi

    # Test API health/connectivity
    print_status "Testing API connectivity..."
    
    # Try to reach the API (expect 401 since we don't have auth)
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/chat" -X POST \
        -H "Content-Type: application/json" \
        -d '{"query":"test"}' \
        --connect-timeout 10 \
        --max-time 30 || echo "000")

    case $HTTP_STATUS in
        "401")
            print_status "API is responding (401 Unauthorized - expected without JWT)"
            ;;
        "403")
            print_status "API is responding (403 Forbidden - expected without JWT)"
            ;;
        "200")
            print_warning "API returned 200 without authentication (unexpected)"
            ;;
        "000")
            print_error "Failed to connect to API"
            exit 1
            ;;
        *)
            print_warning "API returned unexpected status: $HTTP_STATUS"
            ;;
    esac

    # Test CORS headers
    print_status "Testing CORS configuration..."
    CORS_HEADERS=$(curl -s -I -X OPTIONS "$API_URL/chat" \
        -H "Origin: https://example.com" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type,Authorization" \
        --connect-timeout 10 \
        --max-time 30 | grep -i "access-control" || echo "")

    if [ -n "$CORS_HEADERS" ]; then
        print_status "CORS headers found"
    else
        print_warning "No CORS headers detected"
    fi

    print_status "API validation complete!"
fi

# Final summary
print_header "Validation Summary"
if [ -f "$PACKAGE_PATH" ]; then
    print_status "✅ Lambda package validated"
fi
if [ -n "$API_URL" ]; then
    print_status "✅ API connectivity tested"
fi

print_status "🎉 Deployment validation completed successfully!"

# Provide next steps
if [ -z "$API_URL" ]; then
    print_status "Next steps:"
    print_status "1. Deploy infrastructure: make deploy-infra"
    print_status "2. Upload corpus: make upload-corpus BUCKET_NAME=<bucket> CORPUS_DIR=<dir>"
    print_status "3. Test deployment: make validate-deployment API_URL=<api-url>"
fi