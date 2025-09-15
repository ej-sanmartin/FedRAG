#!/bin/bash

# Update Lambda function with CORS fixes
echo "Building API..."
cd apps/api
npm run build

echo "Creating deployment package..."
cd dist
zip -r ../lambda-deployment.zip .
cd ..

echo "Updating Lambda function..."
aws lambda update-function-code \
  --function-name fedrag-api \
  --zip-file fileb://lambda-deployment.zip \
  --region us-east-1

echo "Lambda function updated successfully!"
echo "Testing CORS..."
curl -X OPTIONS "https://vgyktcw1a7.execute-api.us-east-1.amazonaws.com/dev/chat" \
  -H "Origin: https://d75yomy6kysc3.cloudfront.net" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization" \
  -v