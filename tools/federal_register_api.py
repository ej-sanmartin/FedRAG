#!/usr/bin/env python3
"""
Federal Register API Client with PDF Content Extraction
Downloads AI-related documents and extracts full text from PDFs.
"""

import os
import re
import sys
import time
import json
from pathlib import Path
from datetime import datetime

try:
    import requests
    import pdfplumber
except ImportError as e:
    print(f"❌ Missing required library: {e}")
    print("Installing required dependencies...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "pdfplumber"])
    import requests
    import pdfplumber


class FederalRegisterAPI:
    """Federal Register API client with PDF content extraction."""
    
    def __init__(self, output_dir="corpus/federal-register/ai-documents", max_docs=20):
        self.api_base = "https://www.federalregister.gov/api/v1"
        self.web_base = "https://www.federalregister.gov"
        self.output_dir = Path(output_dir)
        self.max_docs = max_docs
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Session for connection reuse
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'FedRag-Research/1.0 (Educational Purpose)'
        })
    
    def api_request(self, endpoint, params=None):
        """Make API request with proper headers."""
        url = f"{self.api_base}/{endpoint}"
        
        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"❌ API request failed: {e}")
            return None
    
    def download_pdf(self, pdf_url, max_retries=3):
        """Download PDF and extract text content."""
        if not pdf_url:
            return None
            
        for attempt in range(max_retries):
            try:
                print(f"   📄 Downloading PDF (attempt {attempt + 1}/{max_retries})...")
                response = self.session.get(pdf_url, timeout=60)
                response.raise_for_status()
                
                # Save PDF content to a temporary file-like object
                from io import BytesIO
                pdf_bytes = BytesIO(response.content)
                
                # Extract text from PDF
                with pdfplumber.open(pdf_bytes) as pdf:
                    text_content = []
                    for page_num, page in enumerate(pdf.pages, 1):
                        page_text = page.extract_text()
                        if page_text:
                            text_content.append(f"--- Page {page_num} ---")
                            text_content.append(page_text.strip())
                            text_content.append("")
                    
                    if text_content:
                        full_text = "\n".join(text_content)
                        print(f"   ✅ Extracted {len(full_text)} characters from {len(pdf.pages)} pages")
                        return full_text
                    else:
                        print("   ⚠️  No text extracted from PDF")
                        return None
                        
            except Exception as e:
                print(f"   ❌ PDF download attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2)
                    
        return None
    
    def search_documents(self, term="artificial intelligence"):
        """Search for documents using the official API."""
        print(f"🔍 Searching Federal Register API for: '{term}'")
        
        # API parameters for AI-related documents
        params = {
            'conditions[term]': term,
            'conditions[type][]': ['RULE', 'PRORULE', 'NOTICE'],
            'per_page': min(self.max_docs, 100),  # API limit is 100
            'order': 'newest',
            'fields[]': [
                'title', 'abstract', 'html_url', 'pdf_url', 
                'publication_date', 'agencies', 'document_number',
                'type', 'significant'
            ]
        }
        
        data = self.api_request('documents.json', params)
        
        if not data:
            print("❌ API request failed")
            return []
        
        results = data.get('results', [])
        print(f"✅ Found {len(results)} documents via API")
        
        # Filter for documents that have PDF URLs and are truly AI-related
        pdf_results = []
        ai_keywords = [
            'artificial intelligence', 'machine learning', 'neural network',
            'deep learning', 'ai safety', 'ai governance', 'algorithmic',
            'automated decision', 'ai system', 'ai model', 'ai technology'
        ]
        
        for doc in results:
            if not doc.get('pdf_url'):
                continue
                
            # Check if document is truly AI-related
            title = (doc.get('title') or '').lower()
            abstract = (doc.get('abstract') or '').lower()
            content = f"{title} {abstract}"
            
            # Must contain AI keywords in title or abstract
            if any(keyword in content for keyword in ai_keywords):
                pdf_results.append(doc)
                print(f"   ✅ AI-relevant: {doc.get('title', 'Untitled')[:60]}...")
            else:
                print(f"   ❌ Not AI-focused: {doc.get('title', 'Untitled')[:60]}...")
        
        print(f"📄 {len(pdf_results)} truly AI-related documents found")
        
        return pdf_results[:self.max_docs]
    
    def save_document(self, document, pdf_content=None):
        """Save document with full content."""
        title = document.get('title', 'Untitled Document')
        date = document.get('publication_date', 'unknown')
        agencies = document.get('agencies', [])
        agency_names = ', '.join([agency.get('name', 'Unknown') for agency in agencies])
        html_url = document.get('html_url', '')
        pdf_url = document.get('pdf_url', '')
        doc_number = document.get('document_number', '')
        doc_type = document.get('type', 'Unknown')
        
        # Create safe filename
        safe_title = re.sub(r'[^\w\s-]', '', title)
        safe_title = re.sub(r'[-\s]+', '-', safe_title)
        safe_title = safe_title[:50]
        
        filename = f"{date}-{safe_title}.txt"
        filepath = self.output_dir / filename
        
        # Prepare document content
        document_text = f"""Title: {title}
Date: {date}
Document Number: {doc_number}
Type: {doc_type}
Agencies: {agency_names}
HTML URL: {self.web_base}{html_url}
PDF URL: {pdf_url}
Downloaded: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
{'=' * 80}

"""
        
        # Add abstract
        if document.get('abstract'):
            document_text += f"ABSTRACT:\n{document['abstract']}\n\n"
            document_text += "=" * 80 + "\n\n"
        
        # Add full PDF content
        if pdf_content:
            document_text += "FULL DOCUMENT CONTENT:\n\n"
            document_text += pdf_content
        else:
            document_text += "Note: Full content available via PDF URL above.\n"
        
        # Save to file
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(document_text)
            print(f"   💾 Saved: {filename}")
            return True
        except Exception as e:
            print(f"   ❌ Error saving: {e}")
            return False
    
    def run_comprehensive_search(self):
        """Search for AI documents using multiple terms."""
        print("🚀 Federal Register Comprehensive AI Search")
        print("=" * 50)
        print(f"📁 Output directory: {self.output_dir}")
        print(f"📊 Max documents per term: {self.max_docs}")
        print()
        
        # AI-related search terms
        search_terms = [
            "artificial intelligence",
            "machine learning", 
            "AI safety",
            "AI governance",
            "algorithmic accountability",
            "automated decision making",
            "neural networks",
            "deep learning"
        ]
        
        all_documents = {}  # Use dict to avoid duplicates
        
        for term in search_terms:
            print(f"🔍 Searching for: '{term}'")
            documents = self.search_documents(term)
            
            for doc in documents:
                doc_id = doc.get('document_number')
                if doc_id and doc_id not in all_documents:
                    all_documents[doc_id] = doc
            
            print(f"   Found {len(documents)} new documents")
            time.sleep(1)  # Rate limiting between searches
            print()
        
        unique_documents = list(all_documents.values())
        print(f"📊 Total unique AI documents found: {len(unique_documents)}")
        
        if not unique_documents:
            print("❌ No AI documents found")
            return False
        
        print(f"📋 Processing {len(unique_documents)} documents with PDF extraction...")
        print()
        
        success_count = 0
        
        for i, doc in enumerate(unique_documents, 1):
            title = doc.get('title', 'Untitled')[:60]
            print(f"[{i}/{len(unique_documents)}] {title}...")
            
            # Download and extract PDF content
            pdf_url = doc.get('pdf_url')
            pdf_content = None
            
            if pdf_url:
                pdf_content = self.download_pdf(pdf_url)
                if pdf_content:
                    print(f"   ✅ Extracted {len(pdf_content)} characters from PDF")
                else:
                    print("   ⚠️  PDF extraction failed, using abstract only")
            else:
                print("   ⚠️  No PDF URL available")
            
            if self.save_document(doc, pdf_content):
                success_count += 1
            
            # Rate limiting - be respectful
            if i < len(unique_documents):
                time.sleep(2)
            
            print()
        
        print("✅ Comprehensive AI search completed!")
        print(f"📊 Successfully saved: {success_count}/{len(unique_documents)} documents")
        print(f"📁 Files saved to: {self.output_dir}")
        
        return success_count > 0

    def run(self, search_term="artificial intelligence"):
        """Main process with PDF content extraction."""
        print("🚀 Federal Register API Client with PDF Extraction")
        print("=" * 55)
        print(f"📁 Output directory: {self.output_dir}")
        print(f"📊 Max documents: {self.max_docs}")
        print(f"🔍 Search term: {search_term}")
        print()
        
        # Search for documents
        documents = self.search_documents(search_term)
        
        if not documents:
            print("❌ No documents found")
            return False
        
        print(f"📋 Processing {len(documents)} documents with PDF extraction...")
        print()
        
        success_count = 0
        
        for i, doc in enumerate(documents, 1):
            title = doc.get('title', 'Untitled')[:60]
            print(f"[{i}/{len(documents)}] {title}...")
            
            # Download and extract PDF content
            pdf_url = doc.get('pdf_url')
            pdf_content = None
            
            if pdf_url:
                pdf_content = self.download_pdf(pdf_url)
                if pdf_content:
                    print(f"   ✅ Extracted {len(pdf_content)} characters from PDF")
                else:
                    print("   ⚠️  PDF extraction failed, using abstract only")
            else:
                print("   ⚠️  No PDF URL available")
            
            if self.save_document(doc, pdf_content):
                success_count += 1
            
            # Rate limiting - be respectful
            if i < len(documents):
                time.sleep(2)  # Longer delay for PDF downloads
            
            print()
        
        print("✅ Download completed!")
        print(f"📊 Successfully saved: {success_count}/{len(documents)} documents")
        print(f"📁 Files saved to: {self.output_dir}")
        print()
        print("📋 Next steps:")
        print("1. Review downloaded documents")
        print("2. Upload to S3: make upload-corpus BUCKET_NAME=fedrag-corpus-762b6ef0 CORPUS_DIR=./corpus")
        print("3. Sync Knowledge Base in AWS Console")
        
        return success_count > 0


def main():
    """Command line interface."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Download AI documents with full PDF content")
    parser.add_argument("--term", default="artificial intelligence", help="Search term")
    parser.add_argument("--output", default="corpus/federal-register/ai-documents", help="Output directory")
    parser.add_argument("--max-docs", type=int, default=10, help="Maximum documents per search term")
    parser.add_argument("--comprehensive", action="store_true", help="Run comprehensive search with multiple AI terms")
    
    args = parser.parse_args()
    
    client = FederalRegisterAPI(output_dir=args.output, max_docs=args.max_docs)
    
    if args.comprehensive:
        success = client.run_comprehensive_search()
    else:
        success = client.run(search_term=args.term)
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()