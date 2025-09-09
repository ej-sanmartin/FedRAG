#!/bin/bash

# Comprehensive Test Runner for FedRag API
# This script runs all unit tests including edge cases, performance tests, and coverage reporting

set -e

echo "🧪 Running Comprehensive Unit Tests for FedRag API"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    print_error "This script must be run from the apps/api directory"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    print_warning "Dependencies not found. Installing..."
    pnpm install
fi

print_status "Running type checking..."
if pnpm run type-check; then
    print_success "Type checking passed"
else
    print_error "Type checking failed"
    exit 1
fi

print_status "Running linting..."
if pnpm run lint; then
    print_success "Linting passed"
else
    print_error "Linting failed"
    exit 1
fi

print_status "Running existing unit tests..."
if pnpm run test; then
    print_success "Existing unit tests passed"
else
    print_error "Existing unit tests failed"
    exit 1
fi

print_status "Running comprehensive unit tests..."
if pnpm run test:unit; then
    print_success "Comprehensive unit tests passed"
else
    print_error "Comprehensive unit tests failed"
    exit 1
fi

print_status "Running all tests with coverage..."
if pnpm run test:comprehensive; then
    print_success "All tests passed with coverage report generated"
else
    print_error "Coverage test run failed"
    exit 1
fi

print_status "Generating detailed coverage report..."
echo ""
echo "📊 Coverage Summary:"
echo "==================="

# Display coverage thresholds
echo "Coverage Thresholds:"
echo "- Branches: 80%"
echo "- Functions: 80%"
echo "- Lines: 80%"
echo "- Statements: 80%"
echo ""

print_success "All comprehensive tests completed successfully! 🎉"
print_status "Coverage report available in coverage/ directory"
print_status "Open coverage/index.html in your browser to view detailed coverage"

echo ""
echo "Test Categories Covered:"
echo "======================="
echo "✅ PII Detection and Masking Edge Cases"
echo "✅ Knowledge Base Integration Scenarios"
echo "✅ Guardrail Intervention Testing"
echo "✅ Insufficient Basis Template Testing"
echo "✅ Performance and Stress Testing"
echo "✅ Unicode and Special Character Handling"
echo "✅ Error Recovery and Resilience"
echo "✅ Memory and Resource Management"
echo "✅ Complex Citation Processing"
echo "✅ Session Management Edge Cases"
echo ""