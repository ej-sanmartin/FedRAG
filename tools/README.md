# FedRag Tools

This directory contains tools for building and managing the Federal Register document corpus for the FedRag privacy-first RAG assistant.

## Overview

The tools in this directory help you:
- Download AI-related documents from the Federal Register API
- Extract full text content from PDF documents
- Build a high-quality corpus for the RAG system

## Tools

### federal_register_api.py

A Python script that downloads AI-related documents from the official Federal Register API and extracts full text content from PDFs.

#### Features
- **Official API Access**: Uses the Federal Register's official API (no registration required)
- **PDF Content Extraction**: Downloads and extracts full text from PDF documents
- **AI-Focused Filtering**: Filters documents to ensure they're genuinely AI-related
- **Comprehensive Search**: Supports searching with multiple AI-related terms
- **Rate Limiting**: Respectful API usage with built-in delays

#### Installation

1. Install Python dependencies:
```bash
pip3 install -r requirements.txt
```

#### Usage

**Basic Usage:**
```bash
# Download AI documents (default: "artificial intelligence")
python3 federal_register_api.py

# Search for specific term
python3 federal_register_api.py --term "machine learning"

# Limit number of documents
python3 federal_register_api.py --max-docs 5

# Custom output directory
python3 federal_register_api.py --output ./my-corpus
```

**Comprehensive Search:**
```bash
# Search using multiple AI-related terms for better coverage
python3 federal_register_api.py --comprehensive --max-docs 5
```

This will search for documents using these terms:
- "artificial intelligence"
- "machine learning"
- "AI safety"
- "AI governance"
- "algorithmic accountability"
- "automated decision making"
- "neural networks"
- "deep learning"

#### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--term` | Search term to use | "artificial intelligence" |
| `--output` | Output directory for documents | "corpus/federal-register" |
| `--max-docs` | Maximum documents per search term | 10 |
| `--comprehensive` | Run comprehensive search with multiple AI terms | False |

#### Output Format

Documents are saved as `.txt` files with the following format:
```
Title: [Document Title]
Date: [Publication Date]
Document Number: [Federal Register Number]
Type: [Document Type]
Agencies: [Responsible Agencies]
HTML URL: [Web Link]
PDF URL: [PDF Link]
Downloaded: [Download Timestamp]
================================================================================

ABSTRACT:
[Document Abstract]

================================================================================

FULL DOCUMENT CONTENT:

--- Page 1 ---
[Full PDF text content...]

--- Page 2 ---
[Continued content...]
```

#### AI Relevance Filtering

The tool automatically filters documents to ensure they're genuinely AI-related by checking for these keywords in titles and abstracts:
- artificial intelligence
- machine learning
- neural network
- deep learning
- ai safety
- ai governance
- algorithmic
- automated decision
- ai system
- ai model
- ai technology

#### Examples

**Download recent AI policy documents:**
```bash
python3 federal_register_api.py --term "artificial intelligence" --max-docs 10
```

**Build comprehensive AI corpus:**
```bash
python3 federal_register_api.py --comprehensive --max-docs 8
```

**Search for AI safety documents:**
```bash
python3 federal_register_api.py --term "AI safety" --max-docs 5
```

## Dependencies

See `requirements.txt` for Python dependencies:
- `requests` - HTTP client for API calls
- `pdfplumber` - PDF text extraction
- `python-dateutil` - Date parsing utilities

## Integration with FedRag

After downloading documents:

1. **Upload to S3:**
```bash
make upload-corpus BUCKET_NAME=your-bucket CORPUS_DIR=./corpus
```

2. **Sync Knowledge Base:**
   - Go to AWS Bedrock console
   - Find your Knowledge Base
   - Trigger a sync to ingest new documents

3. **Test the RAG system:**
   - Deploy the API: `make deploy-infra`
   - Test queries through the web interface

## Rate Limiting and Best Practices

- The tool includes 2-second delays between document downloads
- PDF extraction can be resource-intensive for large documents
- The Federal Register API is free but should be used respectfully
- Documents are deduplicated automatically when using comprehensive search

## Troubleshooting

**SSL Certificate Issues (macOS):**
The tool handles SSL certificate issues automatically by using the requests library.

**PDF Extraction Failures:**
If PDF extraction fails, the tool will save the document with abstract content only and continue processing.

**API Rate Limits:**
The Federal Register API is generally permissive, but the tool includes rate limiting to be respectful.

**Large Documents:**
Some Federal Register documents can be very large (hundreds of pages). The tool will extract all content but this may take time.

## Contributing

When adding new tools:
1. Follow the existing code style
2. Include comprehensive error handling
3. Add rate limiting for external API calls
4. Document usage in this README
5. Update requirements.txt if adding dependencies