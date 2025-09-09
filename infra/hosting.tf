# Frontend Hosting Infrastructure
# This file creates the S3 static website hosting and CloudFront distribution
# for the FedRag React frontend application

# Random suffix for S3 bucket to ensure global uniqueness
resource "random_id" "web_bucket_suffix" {
  byte_length = 4
}

# S3 Bucket for Static Website Hosting
resource "aws_s3_bucket" "web" {
  bucket = "${var.project_name}-web-${var.environment}-${random_id.web_bucket_suffix.hex}"

  tags = {
    Name        = "${var.project_name}-web-bucket"
    Environment = var.environment
    Purpose     = "Static Website Hosting"
  }
}

# S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Server-Side Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# S3 Bucket Public Access Block
resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront Origin Access Control
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project_name}-web-oac"
  description                       = "Origin Access Control for FedRag web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Cache Policy for SPA
resource "aws_cloudfront_cache_policy" "spa_cache_policy" {
  name        = "${var.project_name}-spa-cache-policy"
  comment     = "Cache policy optimized for Single Page Applications"
  default_ttl = 86400    # 1 day
  max_ttl     = 31536000 # 1 year
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    query_strings_config {
      query_string_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    cookies_config {
      cookie_behavior = "none"
    }
  }
}

# CloudFront Response Headers Policy
resource "aws_cloudfront_response_headers_policy" "spa_security_headers" {
  name    = "${var.project_name}-spa-security-headers"
  comment = "Security headers for SPA"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = false
    }

    content_type_options {
      override = false
    }

    frame_options {
      frame_option = "DENY"
      override     = false
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = false
    }
  }

  custom_headers_config {
    items {
      header   = "X-Content-Security-Policy"
      value    = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com"
      override = false
    }
  }
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "web" {
  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
    origin_id                = "S3-${aws_s3_bucket.web.bucket}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "FedRag Frontend Distribution"
  default_root_object = "index.html"

  # Cache behavior for static assets (JS, CSS, images)
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.web.bucket}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    cache_policy_id            = aws_cloudfront_cache_policy.spa_cache_policy.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa_security_headers.id
  }

  # Default cache behavior for SPA routing
  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.web.bucket}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    # Use managed cache policy for SPA
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingDisabled

    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa_security_headers.id

    # Function association for SPA routing
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  # Price class for cost optimization
  price_class = "PriceClass_100" # US, Canada, Europe

  # Geographic restrictions
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # SSL/TLS configuration
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  # Custom error pages for SPA routing
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  tags = {
    Name        = "${var.project_name}-web-distribution"
    Environment = var.environment
    Purpose     = "Frontend Distribution"
  }
}

# CloudFront Function for SPA Routing
resource "aws_cloudfront_function" "spa_routing" {
  name    = "${var.project_name}-spa-routing"
  runtime = "cloudfront-js-1.0"
  comment = "Function to handle SPA routing by rewriting requests to index.html"
  publish = true
  code    = <<-EOT
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // Check whether the URI is missing a file name
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    // Check whether the URI is missing a file extension
    else if (!uri.includes('.')) {
        request.uri = '/index.html';
    }
    
    return request;
}
EOT
}

# S3 Bucket Policy for CloudFront OAC
resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.web.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
          }
        }
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.web]
}

# CloudWatch Log Group for CloudFront (optional, for future logging)
resource "aws_cloudwatch_log_group" "cloudfront_logs" {
  name              = "/aws/cloudfront/${var.project_name}-web"
  retention_in_days = 14

  tags = {
    Name        = "${var.project_name}-cloudfront-logs"
    Environment = var.environment
  }
}