# Federal Register AI Documents Corpus

This directory contains AI-related documents from the Federal Register, the official journal of the federal government of the United States.

## Corpus Overview

The `ai-documents/` folder contains a curated collection of Federal Register documents specifically related to artificial intelligence policy, governance, and regulation.

### Document Collection

| Document | Date | Type | Agency | Description |
|----------|------|------|--------|-------------|
| Executive Order on AI Safety | 2023-10-30 | Executive Order | Executive Office of the President | Foundational Biden administration AI policy establishing safety standards |
| AI Safety Board Establishment | 2024-04-29 | Notice | Department of Homeland Security | Establishment of DHS AI Safety and Security Board |
| VoiceBrain CRADA | 2025-09-10 | Notice | Coast Guard, DHS | Research agreement for AI multicast overlays in maritime communications |
| Illinois Advisory Committee | 2025-09-11 | Notice | Civil Rights Commission | Public meetings on AI and civil rights |
| Digital Health Advisory Committee | 2025-09-12 | Notice | FDA | Advisory committee meeting on AI in healthcare |
| NIST AI Institute Nominations | 2025-04-18 | Notice | NIST | Request for nominations to AI research institute |

### Content Quality

- **Full PDF Content**: All documents include complete text extracted from official PDF sources
- **Metadata Rich**: Each document includes title, date, agencies, document numbers, and URLs
- **AI-Focused**: Documents are filtered to ensure genuine AI relevance
- **Policy Coverage**: Spans executive orders, regulatory notices, advisory committees, and research agreements

### Usage

This corpus is designed for use with the FedRag privacy-first RAG assistant to answer questions about:
- Federal AI policy and regulation
- AI safety and security frameworks
- Government AI research initiatives
- AI governance and oversight mechanisms
- Civil rights and AI
- Healthcare AI regulation

### Data Sources

All documents are sourced from:
- **Federal Register API**: https://www.federalregister.gov/reader-aids/developer-resources
- **Official PDF Sources**: https://www.govinfo.gov/

### Updating the Corpus

To add new AI-related documents:

```bash
# Download latest AI documents
cd tools/
python3 federal_register_api.py --comprehensive --max-docs 5

# Upload to S3 for Knowledge Base
make upload-corpus BUCKET_NAME=your-bucket CORPUS_DIR=./corpus
```

### Document Format

Each document follows this structure:
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
[Complete PDF text content...]
```

## Integration

This corpus integrates with:
- **AWS Bedrock Knowledge Base**: For vector search and retrieval
- **FedRag API**: For question answering about federal AI policy
- **S3 Storage**: For scalable document storage and access

## Compliance

All documents are:
- Publicly available through official government sources
- Free to access and redistribute
- Sourced from authoritative federal agencies
- Properly attributed with source URLs and metadata