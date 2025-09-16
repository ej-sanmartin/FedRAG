#!/bin/bash

# Lambda deployment script for FedRag API
# This script packages and deploys the Lambda function

set -e

# Function to extract JSON value without jq (fallback)
extract_json_value() {
    local json="$1"
    local key="$2"
    # Simple regex-based extraction (not as robust as jq but works for basic cases)
    echo "$json" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

# Function to check if jq is installed and provide installation instructions
check_jq() {
    if ! command -v jq &> /dev/null; then
        echo "⚠️  Warning: jq is not installed. Using fallback JSON parsing."
        echo ""
        echo "For better JSON parsing, install jq using one of the following methods:"
        echo ""
        echo "📦 macOS (using Homebrew):"
        echo "   brew install jq"
        echo ""
        echo "📦 Ubuntu/Debian:"
        echo "   sudo apt-get update && sudo apt-get install jq"
        echo ""
        echo "📦 CentOS/RHEL/Fedora:"
        echo "   sudo yum install jq"
        echo "   # or for newer versions:"
        echo "   sudo dnf install jq"
        echo ""
        echo "📦 Windows (using Chocolatey):"
        echo "   choco install jq"
        echo ""
        echo "📦 Or download from: https://stedolan.github.io/jq/download/"
        echo ""
        return 1
    fi
    return 0
}

# Configuration
FUNCTION_NAME="fedrag-api"
REGION="us-east-1"

echo "🚀 Starting Lambda deployment process..."

# Check dependencies (warn but don't exit if jq is missing)
check_jq || echo "Continuing with fallback JSON parsing..."

# Check if AWS CLI is configured
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "❌ AWS CLI not configured. Please run 'aws configure' first."
    exit 1
fi

# Check if function exists
if ! aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "❌ Lambda function '$FUNCTION_NAME' not found in region '$REGION'"
    echo "Please deploy infrastructure first with: make deploy-infra"
    exit 1
fi

# Package the Lambda function
echo "📦 Packaging Lambda function..."
./scripts/package-lambda.sh

# Verify package exists
if [ ! -f "apps/api/lambda-deployment.zip" ]; then
    echo "❌ Lambda package not found. Packaging failed."
    exit 1
fi

# Get current function info
echo "📋 Current function info:"
aws lambda get-function \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'Configuration.{LastModified:LastModified,CodeSize:CodeSize,Runtime:Runtime}' \
    --output table

# Deploy the function
echo "🚀 Deploying Lambda function..."
DEPLOYMENT_RESULT=$(aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://apps/api/lambda-deployment.zip \
    --region "$REGION" \
    --output json)

# Extract deployment info
if check_jq; then
    NEW_VERSION=$(echo "$DEPLOYMENT_RESULT" | jq -r '.Version')
    NEW_SIZE=$(echo "$DEPLOYMENT_RESULT" | jq -r '.CodeSize')
    LAST_MODIFIED=$(echo "$DEPLOYMENT_RESULT" | jq -r '.LastModified')
else
    NEW_VERSION=$(extract_json_value "$DEPLOYMENT_RESULT" "Version")
    NEW_SIZE=$(extract_json_value "$DEPLOYMENT_RESULT" "CodeSize")
    LAST_MODIFIED=$(extract_json_value "$DEPLOYMENT_RESULT" "LastModified")
fi

echo "✅ Deployment successful!"
echo "📊 New version: $NEW_VERSION"
echo "📊 Code size: $NEW_SIZE bytes"
echo "📊 Last modified: $LAST_MODIFIED"

# Wait for function to be ready
echo "⏳ Waiting for function to be ready..."
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

# Test the function
echo "🧪 Testing function..."

# Create test payload file
cat > /tmp/lambda-test-payload.json << 'EOF'
{
  "httpMethod": "OPTIONS",
  "path": "/chat",
  "headers": {
    "Origin": "https://d75yomy6kysc3.cloudfront.net",
    "Content-Type": "application/json"
  }
}
EOF

TEST_RESULT=$(aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --cli-binary-format raw-in-base64-out \
    --payload file:///tmp/lambda-test-payload.json \
    --output json \
    /tmp/lambda-test-output.json)

if check_jq; then
    STATUS_CODE=$(echo "$TEST_RESULT" | jq -r '.StatusCode')
else
    STATUS_CODE=$(extract_json_value "$TEST_RESULT" "StatusCode")
fi

if [ "$STATUS_CODE" = "200" ]; then
    echo "✅ Function test successful!"
    echo "📋 Test response:"
    if check_jq; then
        cat /tmp/lambda-test-output.json | jq .
    else
        cat /tmp/lambda-test-output.json
    fi
else
    echo "⚠️  Function test returned status code: $STATUS_CODE"
    echo "📋 Test response:"
    cat /tmp/lambda-test-output.json
fi

# Clean up test files
rm -f /tmp/lambda-test-output.json /tmp/lambda-test-payload.json

echo "🎉 Lambda deployment complete!"
echo ""
echo "Next steps:"

# Get API Gateway URL dynamically
if [ -f "infra/terraform.tfstate" ] || [ -f "infra/.terraform/terraform.tfstate" ]; then
    cd infra 2>/dev/null || true
    API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "")
    cd .. 2>/dev/null || true
    
    if [ -n "$API_URL" ]; then
        echo "1. Test CORS: curl -X OPTIONS '${API_URL}/chat' -H 'Origin: https://d75yomy6kysc3.cloudfront.net' -v"
    else
        echo "1. Test CORS: curl -X OPTIONS 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com/dev/chat' -H 'Origin: <your-web-url>' -v"
    fi
else
    echo "1. Test CORS: curl -X OPTIONS 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com/dev/chat' -H 'Origin: <your-web-url>' -v"
fi

echo "2. Test your web application chat functionality"