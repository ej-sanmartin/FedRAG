#!/bin/bash

# Lambda deployment script for FedRag API
# This script packages and deploys the Lambda function

set -e

# Configuration
FUNCTION_NAME="fedrag-api"
REGION="us-east-1"

echo "🚀 Starting Lambda deployment process..."

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
NEW_VERSION=$(echo "$DEPLOYMENT_RESULT" | jq -r '.Version')
NEW_SIZE=$(echo "$DEPLOYMENT_RESULT" | jq -r '.CodeSize')
LAST_MODIFIED=$(echo "$DEPLOYMENT_RESULT" | jq -r '.LastModified')

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
TEST_RESULT=$(aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --payload '{"httpMethod":"OPTIONS","path":"/chat","headers":{"Origin":"https://d75yomy6kysc3.cloudfront.net"}}' \
    --output json \
    /tmp/lambda-test-output.json)

STATUS_CODE=$(echo "$TEST_RESULT" | jq -r '.StatusCode')

if [ "$STATUS_CODE" = "200" ]; then
    echo "✅ Function test successful!"
    echo "📋 Test response:"
    cat /tmp/lambda-test-output.json | jq .
else
    echo "⚠️  Function test returned status code: $STATUS_CODE"
    echo "📋 Test response:"
    cat /tmp/lambda-test-output.json
fi

# Clean up test file
rm -f /tmp/lambda-test-output.json

echo "🎉 Lambda deployment complete!"
echo ""
echo "Next steps:"
echo "1. Test CORS: curl -X OPTIONS 'https://vgyktcw1a7.execute-api.us-east-1.amazonaws.com/dev/chat' -H 'Origin: https://d75yomy6kysc3.cloudfront.net' -v"
echo "2. Test your web application chat functionality"