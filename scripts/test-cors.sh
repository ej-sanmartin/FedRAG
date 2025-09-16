#!/bin/bash

# CORS Testing Script
# Tests CORS configuration for the deployed API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Get configuration
API_URL="${1:-}"
WEB_URL="${2:-https://d75yomy6kysc3.cloudfront.net}"

if [ -z "$API_URL" ]; then
    # Try to get from Terraform outputs
    if [ -f "infra/terraform.tfstate" ]; then
        cd infra 2>/dev/null || true
        API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "")
        WEB_URL=$(terraform output -raw web_url 2>/dev/null || echo "$WEB_URL")
        cd .. 2>/dev/null || true
    fi
    
    if [ -z "$API_URL" ]; then
        print_error "API_URL not provided and couldn't get from Terraform"
        echo "Usage: $0 <API_URL> [WEB_URL]"
        echo "Example: $0 https://api123.execute-api.us-east-1.amazonaws.com/dev"
        exit 1
    fi
fi

print_status "Testing CORS for API: $API_URL"
print_status "Using Web Origin: $WEB_URL"

echo ""
print_status "=== Test 1: OPTIONS Preflight Request ==="

# Test OPTIONS request
CORS_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/cors_response.txt \
    -X OPTIONS "${API_URL}/chat" \
    -H "Origin: $WEB_URL" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type,Authorization" \
    --connect-timeout 10 \
    --max-time 30 || echo "000")

if [ "$CORS_RESPONSE" = "200" ]; then
    print_success "OPTIONS request successful (HTTP 200)"
    
    # Check CORS headers
    print_status "Checking CORS headers..."
    
    CORS_HEADERS=$(curl -s -I -X OPTIONS "${API_URL}/chat" \
        -H "Origin: $WEB_URL" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type,Authorization" \
        --connect-timeout 10 \
        --max-time 30 2>/dev/null || echo "")
    
    if echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin"; then
        ORIGIN_HEADER=$(echo "$CORS_HEADERS" | grep -i "access-control-allow-origin" | head -1)
        print_success "CORS Origin header found: $ORIGIN_HEADER"
    else
        print_error "Missing Access-Control-Allow-Origin header"
    fi
    
    if echo "$CORS_HEADERS" | grep -qi "access-control-allow-methods"; then
        METHODS_HEADER=$(echo "$CORS_HEADERS" | grep -i "access-control-allow-methods" | head -1)
        print_success "CORS Methods header found: $METHODS_HEADER"
    else
        print_error "Missing Access-Control-Allow-Methods header"
    fi
    
    if echo "$CORS_HEADERS" | grep -qi "access-control-allow-headers"; then
        HEADERS_HEADER=$(echo "$CORS_HEADERS" | grep -i "access-control-allow-headers" | head -1)
        print_success "CORS Headers header found: $HEADERS_HEADER"
    else
        print_error "Missing Access-Control-Allow-Headers header"
    fi
    
else
    print_error "OPTIONS request failed (HTTP $CORS_RESPONSE)"
    if [ -f /tmp/cors_response.txt ]; then
        echo "Response body:"
        cat /tmp/cors_response.txt
        echo ""
    fi
fi

echo ""
print_status "=== Test 2: Health Check Endpoint ==="

# Test health endpoint (no auth required)
HEALTH_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/health_response.txt \
    -X GET "${API_URL}/health" \
    -H "Origin: $WEB_URL" \
    --connect-timeout 10 \
    --max-time 30 || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
    print_success "Health check successful (HTTP 200)"
    if [ -f /tmp/health_response.txt ]; then
        echo "Response: $(cat /tmp/health_response.txt)"
    fi
else
    print_warning "Health check returned HTTP $HEALTH_RESPONSE (may not be implemented)"
fi

echo ""
print_status "=== Test 3: Chat Endpoint (Expect 401/403) ==="

# Test chat endpoint without auth (should return 401/403)
CHAT_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/chat_response.txt \
    -X POST "${API_URL}/chat" \
    -H "Origin: $WEB_URL" \
    -H "Content-Type: application/json" \
    -d '{"query":"test"}' \
    --connect-timeout 10 \
    --max-time 30 || echo "000")

case $CHAT_RESPONSE in
    "401"|"403")
        print_success "Chat endpoint properly protected (HTTP $CHAT_RESPONSE)"
        ;;
    "200")
        print_warning "Chat endpoint returned 200 without auth (unexpected)"
        ;;
    "000")
        print_error "Failed to connect to chat endpoint"
        ;;
    *)
        print_warning "Chat endpoint returned unexpected status: $CHAT_RESPONSE"
        ;;
esac

echo ""
print_status "=== Test 4: Localhost Origins (Development) ==="

# Test with localhost origin
LOCALHOST_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/localhost_response.txt \
    -X OPTIONS "${API_URL}/chat" \
    -H "Origin: http://localhost:5173" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type,Authorization" \
    --connect-timeout 10 \
    --max-time 30 || echo "000")

if [ "$LOCALHOST_RESPONSE" = "200" ]; then
    print_success "Localhost origin accepted (HTTP 200)"
else
    print_warning "Localhost origin rejected (HTTP $LOCALHOST_RESPONSE)"
fi

# Cleanup
rm -f /tmp/cors_response.txt /tmp/health_response.txt /tmp/chat_response.txt /tmp/localhost_response.txt

echo ""
print_status "=== Summary ==="
echo "API URL: $API_URL"
echo "Web Origin: $WEB_URL"
echo "CORS Test: $([ "$CORS_RESPONSE" = "200" ] && echo "PASS" || echo "FAIL")"
echo "Health Check: $([ "$HEALTH_RESPONSE" = "200" ] && echo "PASS" || echo "N/A")"
echo "Auth Protection: $([ "$CHAT_RESPONSE" = "401" ] || [ "$CHAT_RESPONSE" = "403" ] && echo "PASS" || echo "CHECK")"

if [ "$CORS_RESPONSE" = "200" ]; then
    print_success "🎉 CORS configuration appears to be working correctly!"
else
    print_error "❌ CORS configuration needs attention"
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Check if Lambda function is deployed with latest CORS fixes"
    echo "2. Verify API Gateway CORS configuration includes your web origin"
    echo "3. Check CloudWatch logs for Lambda errors"
    echo "4. Ensure WEB_URL environment variable is set correctly in Lambda"
fi