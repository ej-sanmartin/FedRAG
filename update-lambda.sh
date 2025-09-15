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

# Get API Gateway URL dynamically
if [ -f "infra/terraform.tfstate" ] || [ -f "infra/.terraform/terraform.tfstate" ]; then
    cd infra 2>/dev/null || true
    API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "")
    cd .. 2>/dev/null || true
    
    if [ -n "$API_URL" ]; then
        echo "Testing CORS..."
        curl -X OPTIONS "${API_URL}/chat" \
          -H "Origin: https://d75yomy6kysc3.cloudfront.net" \
          -H "Access-Control-Request-Method: POST" \
          -H "Access-Control-Request-Headers: content-type,authorization" \
          -v
    else
        echo "Could not get API Gateway URL. Test manually with:"
        echo "curl -X OPTIONS 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com/dev/chat' -H 'Origin: <your-web-url>' -v"
    fi
else
    echo "Terraform state not found. Test manually with:"
    echo "curl -X OPTIONS 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com/dev/chat' -H 'Origin: <your-web-url>' -v"
fi