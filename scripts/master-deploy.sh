#!/bin/bash

# FedRAG Master Deployment Script
# This script handles the complete deployment workflow for FedRAG

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "Makefile" ] || [ ! -d "infra" ] || [ ! -d "apps" ]; then
    log_error "Please run this script from the FedRAG root directory"
    exit 1
fi

# Parse command line arguments
SKIP_TESTS=false
SKIP_INFRA=false
SKIP_LAMBDA=false
SKIP_WEB=false
AUTO_APPROVE=false

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
        --skip-lambda)
            SKIP_LAMBDA=true
            shift
            ;;
        --skip-web)
            SKIP_WEB=true
            shift
            ;;
        --auto-approve)
            AUTO_APPROVE=true
            shift
            ;;
        -h|--help)
            echo "FedRAG Master Deployment Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-tests      Skip running tests"
            echo "  --skip-infra      Skip infrastructure deployment"
            echo "  --skip-lambda     Skip Lambda function deployment"
            echo "  --skip-web        Skip web application build"
            echo "  --auto-approve    Auto-approve Terraform changes"
            echo "  -h, --help        Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                          # Full deployment with prompts"
            echo "  $0 --auto-approve          # Full deployment without prompts"
            echo "  $0 --skip-tests --skip-web # Deploy only infrastructure and Lambda"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

log_info "Starting FedRAG Master Deployment"
log_info "=================================="

# Step 1: Pre-deployment checks
log_info "Step 1: Pre-deployment checks"

# Check required files
if [ ! -f "infra/terraform.tfvars" ]; then
    log_error "infra/terraform.tfvars not found. Copy from terraform.tfvars.example and configure."
    exit 1
fi

if [ ! -f "apps/web/.env" ]; then
    log_warning "apps/web/.env not found. Copy from .env.example and configure if needed."
fi

# Check required tools
command -v terraform >/dev/null 2>&1 || { log_error "terraform is required but not installed."; exit 1; }
command -v aws >/dev/null 2>&1 || { log_error "aws CLI is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { log_error "pnpm is required but not installed."; exit 1; }

log_success "Pre-deployment checks passed"

# Step 2: Install dependencies
log_info "Step 2: Installing dependencies"
pnpm install
log_success "Dependencies installed"

# Step 3: Run tests (optional)
if [ "$SKIP_TESTS" = false ]; then
    log_info "Step 3: Running tests"
    pnpm run test
    log_success "Tests passed"
else
    log_warning "Step 3: Skipping tests"
fi

# Step 4: Build Lambda package
if [ "$SKIP_LAMBDA" = false ]; then
    log_info "Step 4: Building Lambda package"
    make package-lambda
    log_success "Lambda package built"
else
    log_warning "Step 4: Skipping Lambda build"
fi

# Step 5: Build web application
if [ "$SKIP_WEB" = false ]; then
    log_info "Step 5: Building web application"
    make build-web
    log_success "Web application built"
else
    log_warning "Step 5: Skipping web build"
fi

# Step 6: Deploy infrastructure
if [ "$SKIP_INFRA" = false ]; then
    log_info "Step 6: Deploying infrastructure"
    
    cd infra
    terraform init
    
    # Generate plan
    terraform plan -out=tfplan
    
    if [ "$AUTO_APPROVE" = false ]; then
        echo ""
        log_info "Review the Terraform plan above."
        read -p "Continue with infrastructure deployment? [y/N]: " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_warning "Infrastructure deployment cancelled"
            rm -f tfplan
            cd ..
            exit 0
        fi
    fi
    
    # Apply changes
    terraform apply tfplan
    rm -f tfplan
    cd ..
    
    log_success "Infrastructure deployed"
else
    log_warning "Step 6: Skipping infrastructure deployment"
fi

# Step 7: Update Lambda function (if infrastructure was deployed)
if [ "$SKIP_INFRA" = false ] && [ "$SKIP_LAMBDA" = false ]; then
    log_info "Step 7: Updating Lambda function"
    
    # Get the Lambda function name from Terraform output
    LAMBDA_FUNCTION_NAME=$(cd infra && terraform output -raw lambda_function_name 2>/dev/null || echo "fedrag-api")
    
    if [ -f "apps/api/lambda-deployment.zip" ]; then
        aws lambda update-function-code \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --zip-file fileb://apps/api/lambda-deployment.zip
        
        # Wait for update to complete
        log_info "Waiting for Lambda update to complete..."
        aws lambda wait function-updated --function-name "$LAMBDA_FUNCTION_NAME"
        
        log_success "Lambda function updated"
    else
        log_error "Lambda deployment package not found. Run 'make package-lambda' first."
        exit 1
    fi
else
    log_warning "Step 7: Skipping Lambda update"
fi

# Step 8: Get deployment outputs
log_info "Step 8: Deployment Summary"
log_info "========================="

if [ "$SKIP_INFRA" = false ]; then
    cd infra
    
    # Get key outputs
    API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "Not available")
    WEB_URL=$(terraform output -raw web_url 2>/dev/null || echo "Not available")
    COGNITO_DOMAIN=$(terraform output -raw cognito_user_pool_domain 2>/dev/null || echo "Not available")
    
    cd ..
    
    log_success "Deployment completed successfully!"
    echo ""
    echo "📋 Deployment Information:"
    echo "  🌐 Web Application: $WEB_URL"
    echo "  🔗 API Gateway: $API_URL"
    echo "  🔐 Cognito Domain: $COGNITO_DOMAIN"
    echo ""
    echo "🔄 Next Steps:"
    echo "  1. Upload corpus documents (if needed):"
    echo "     make upload-corpus BUCKET_NAME=<bucket> CORPUS_DIR=<dir>"
    echo ""
    echo "  2. Test the deployment:"
    echo "     curl -X OPTIONS $API_URL/chat -H 'Origin: $WEB_URL' -v"
    echo ""
    echo "  3. Access the web application:"
    echo "     open $WEB_URL"
    
else
    log_success "Deployment completed (infrastructure skipped)"
fi

log_info "🎉 FedRAG deployment finished!"