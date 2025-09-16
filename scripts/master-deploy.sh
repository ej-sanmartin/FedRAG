#!/bin/bash

# FedRag Master Deployment Script
# This script handles the complete deployment process for the FedRag application
# including infrastructure, Lambda function, and web application

set -e

# Configuration
PROJECT_NAME="fedrag"
REGION="us-east-1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_step() {
    echo -e "\n${BLUE}🔄 $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install AWS CLI."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS CLI not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    # Check Terraform
    if ! command -v terraform &> /dev/null; then
        log_error "Terraform not found. Please install Terraform."
        exit 1
    fi
    
    # Check Node.js and pnpm
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Please install Node.js."
        exit 1
    fi
    
    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm not found. Please install pnpm."
        exit 1
    fi
    
    # Check required files
    if [ ! -f "infra/terraform.tfvars" ]; then
        log_error "infra/terraform.tfvars not found. Please create it from terraform.tfvars.example"
        exit 1
    fi
    
    log_success "All prerequisites met"
}

# Install dependencies
install_dependencies() {
    log_step "Installing dependencies..."
    pnpm install
    log_success "Dependencies installed"
}

# Run tests
run_tests() {
    log_step "Running tests..."
    pnpm run test
    log_success "All tests passed"
}

# Package Lambda function
package_lambda() {
    log_step "Packaging Lambda function..."
    make package-lambda
    
    if [ ! -f "apps/api/lambda-deployment.zip" ]; then
        log_error "Lambda package not created"
        exit 1
    fi
    
    log_success "Lambda function packaged"
}

# Generate web environment file
generate_web_env() {
    log_step "Generating web environment configuration..."
    
    cd infra
    
    # Get values from Terraform outputs
    API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "")
    WEB_URL=$(terraform output -raw web_url 2>/dev/null || echo "")
    COGNITO_USER_POOL_ID=$(terraform output -raw cognito_user_pool_id 2>/dev/null || echo "")
    COGNITO_CLIENT_ID=$(terraform output -raw cognito_user_pool_client_id 2>/dev/null || echo "")
    COGNITO_DOMAIN=$(terraform output -raw cognito_hosted_ui_url 2>/dev/null || echo "")
    
    cd ..
    
    if [ -z "$API_URL" ] || [ -z "$WEB_URL" ]; then
        log_warning "Could not get all required values from Terraform. Using existing .env file."
        return
    fi
    
    # Generate .env file
    cat > apps/web/.env << EOF
# Cognito Configuration
VITE_COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN#https://}
VITE_COGNITO_REDIRECT_URI=${WEB_URL}/callback
VITE_COGNITO_LOGOUT_URI=${WEB_URL}

# API Configuration
VITE_API_URL=${API_URL}

# Application Configuration
VITE_APP_NAME=FedRag Assistant
VITE_APP_VERSION=1.0.0

# Development Configuration
VITE_DEV_MODE=true
VITE_LOG_LEVEL=debug

# Feature Flags
VITE_ENABLE_PII_TOGGLE=true
VITE_ENABLE_CITATIONS=true
VITE_ENABLE_GUARDRAIL_BANNER=true

# UI Configuration
VITE_MAX_MESSAGE_LENGTH=2000
VITE_CHAT_HISTORY_LIMIT=50
VITE_CITATION_PANEL_WIDTH=400

# AWS Region (for reference)
VITE_AWS_REGION=us-east-1
EOF
    
    log_success "Web environment configuration generated"
}

# Build web application
build_web() {
    log_step "Building web application..."
    make build-web
    
    if [ ! -d "apps/web/dist" ]; then
        log_error "Web build not created"
        exit 1
    fi
    
    log_success "Web application built"
}

# Deploy infrastructure
deploy_infrastructure() {
    log_step "Deploying infrastructure..."
    
    cd infra
    
    # Initialize Terraform
    terraform init
    
    # Plan deployment
    log_info "Creating Terraform plan..."
    terraform plan -out=tfplan
    
    # Apply deployment
    log_info "Applying Terraform changes..."
    terraform apply tfplan
    
    # Clean up plan file
    rm -f tfplan
    
    cd ..
    
    log_success "Infrastructure deployed"
}

# Deploy Lambda function
deploy_lambda() {
    log_step "Deploying Lambda function..."
    
    # Use the existing deploy script
    ./scripts/deploy-lambda.sh
    
    log_success "Lambda function deployed"
}

# Test CORS
test_cors() {
    log_step "Testing CORS configuration..."
    
    # Get API Gateway URL from Terraform output
    cd infra
    API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "")
    cd ..
    
    if [ -z "$API_URL" ]; then
        log_warning "Could not get API Gateway URL from Terraform outputs. Skipping CORS test."
        return
    fi
    
    # Wait a moment for deployment to propagate
    sleep 5
    
    # Test OPTIONS request
    CORS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X OPTIONS "${API_URL}/chat" \
        -H "Content-Type: application/json" \
        -H "Origin: https://d75yomy6kysc3.cloudfront.net")
    
    if [ "$CORS_RESPONSE" = "200" ]; then
        log_success "CORS test passed (HTTP $CORS_RESPONSE)"
    else
        log_warning "CORS test failed (HTTP $CORS_RESPONSE)"
        log_info "This might resolve after a few minutes due to AWS propagation delays"
        log_info "Test manually: curl -X OPTIONS '${API_URL}/chat' -H 'Origin: https://d75yomy6kysc3.cloudfront.net' -v"
    fi
}

# Deploy web application (if S3 bucket exists)
deploy_web() {
    log_step "Deploying web application..."
    
    # Get S3 bucket name from Terraform output
    cd infra
    WEB_BUCKET=$(terraform output -raw web_bucket_name 2>/dev/null || echo "")
    cd ..
    
    if [ -z "$WEB_BUCKET" ]; then
        log_warning "Web bucket not found in Terraform outputs. Skipping web deployment."
        return
    fi
    
    # Sync web files to S3
    aws s3 sync apps/web/dist/ "s3://$WEB_BUCKET" --delete
    
    # Invalidate CloudFront cache
    CLOUDFRONT_ID=$(cd infra && terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
    if [ -n "$CLOUDFRONT_ID" ]; then
        log_info "Invalidating CloudFront cache..."
        aws cloudfront create-invalidation \
            --distribution-id "$CLOUDFRONT_ID" \
            --paths "/*" >/dev/null
    fi
    
    log_success "Web application deployed"
}

# Show deployment summary
show_summary() {
    log_step "Deployment Summary"
    
    cd infra
    
    echo ""
    echo "🌐 Application URLs:"
    
    # API Gateway URL
    API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "Not available")
    echo "   API: $API_URL"
    
    # Web URL
    WEB_URL=$(terraform output -raw web_url 2>/dev/null || echo "Not available")
    echo "   Web: $WEB_URL"
    
    # Cognito URLs
    COGNITO_URL=$(terraform output -raw cognito_hosted_ui_url 2>/dev/null || echo "Not available")
    echo "   Auth: $COGNITO_URL"
    
    echo ""
    echo "🔧 Test Commands:"
    echo "   CORS Test: curl -X OPTIONS '$API_URL/chat' -H 'Origin: $WEB_URL' -v"
    echo "   Health Check: curl '$API_URL/health'"
    
    echo ""
    echo "📊 Next Steps:"
    echo "   1. Upload corpus documents: make upload-corpus BUCKET_NAME=<bucket> CORPUS_DIR=<dir>"
    echo "   2. Test the web application at: $WEB_URL"
    echo "   3. Monitor logs: make logs FUNCTION_NAME=fedrag-api"
    
    cd ..
}

# Main deployment function
main() {
    echo "🚀 FedRag Master Deployment Starting..."
    echo "========================================"
    
    # Parse command line arguments
    SKIP_TESTS=false
    SKIP_INFRA=false
    SKIP_WEB=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --skip-infra)
                SKIP_INFRA=true
                shift
                ;;
            --skip-web)
                SKIP_WEB=true
                shift
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --skip-tests    Skip running tests"
                echo "  --skip-infra    Skip infrastructure deployment"
                echo "  --skip-web      Skip web application deployment"
                echo "  --help          Show this help message"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Execute deployment steps
    check_prerequisites
    install_dependencies
    
    if [ "$SKIP_TESTS" = false ]; then
        run_tests
    else
        log_warning "Skipping tests (--skip-tests flag used)"
    fi
    
    package_lambda

    if [ "$SKIP_WEB" = false ]; then
        generate_web_env
        build_web
    fi
    
    if [ "$SKIP_INFRA" = false ]; then
        deploy_infrastructure
        
        # Generate web environment after infrastructure is deployed
        if [ "$SKIP_WEB" = false ]; then
            generate_web_env
        fi
    else
        log_warning "Skipping infrastructure deployment (--skip-infra flag used)"
    fi
    
    deploy_lambda
    test_cors
    
    if [ "$SKIP_WEB" = false ]; then
        deploy_web
    else
        log_warning "Skipping web deployment (--skip-web flag used)"
    fi
    
    show_summary
    
    echo ""
    log_success "🎉 FedRag deployment completed successfully!"
}

# Run main function with all arguments
main "$@"