#!/bin/bash

# Upload corpus documents to S3 bucket for Bedrock Knowledge Base
# Usage: ./scripts/upload-corpus.sh <bucket-name> <local-corpus-directory>

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if required arguments are provided
if [ $# -ne 2 ]; then
    print_error "Usage: $0 <bucket-name> <local-corpus-directory>"
    print_error "Example: $0 my-fedrag-corpus-bucket ./corpus"
    exit 1
fi

BUCKET_NAME="$1"
CORPUS_DIR="$2"

# Validate inputs
if [ ! -d "$CORPUS_DIR" ]; then
    print_error "Corpus directory '$CORPUS_DIR' does not exist"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

# Check if bucket exists
if ! aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    print_error "Bucket '$BUCKET_NAME' does not exist or you don't have access to it"
    exit 1
fi

print_status "Starting corpus upload to S3 bucket: $BUCKET_NAME"
print_status "Source directory: $CORPUS_DIR"

# Count files to upload
TOTAL_FILES=$(find "$CORPUS_DIR" -type f \( -name "*.txt" -o -name "*.md" -o -name "*.pdf" -o -name "*.docx" \) | wc -l)
print_status "Found $TOTAL_FILES files to upload"

if [ "$TOTAL_FILES" -eq 0 ]; then
    print_warning "No supported files found in $CORPUS_DIR"
    print_warning "Supported formats: .txt, .md, .pdf, .docx"
    exit 0
fi

# Upload files with progress
UPLOADED=0
find "$CORPUS_DIR" -type f \( -name "*.txt" -o -name "*.md" -o -name "*.pdf" -o -name "*.docx" \) | while read -r file; do
    # Get relative path from corpus directory
    RELATIVE_PATH=$(realpath --relative-to="$CORPUS_DIR" "$file")
    
    # Upload file
    if aws s3 cp "$file" "s3://$BUCKET_NAME/$RELATIVE_PATH" --quiet; then
        UPLOADED=$((UPLOADED + 1))
        print_status "Uploaded: $RELATIVE_PATH ($UPLOADED/$TOTAL_FILES)"
    else
        print_error "Failed to upload: $RELATIVE_PATH"
    fi
done

print_status "Upload completed successfully!"
print_status "Next steps:"
print_status "1. Wait for Bedrock Knowledge Base to sync (this may take several minutes)"
print_status "2. Check the Knowledge Base status in AWS Console"
print_status "3. Test queries once sync is complete"

# Optional: Trigger knowledge base sync if KB_ID is provided
if [ -n "$KB_ID" ]; then
    print_status "Triggering knowledge base sync for KB_ID: $KB_ID"
    aws bedrock-agent start-ingestion-job \
        --knowledge-base-id "$KB_ID" \
        --data-source-id "$(aws bedrock-agent list-data-sources --knowledge-base-id "$KB_ID" --query 'dataSourceSummaries[0].dataSourceId' --output text)" \
        --region us-east-1
    print_status "Sync job started. Monitor progress in AWS Console."
fi