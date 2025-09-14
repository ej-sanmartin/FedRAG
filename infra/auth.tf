# Cognito Authentication Infrastructure

# Cognito User Pool
resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-${var.environment}-user-pool"

  # Password policy
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  # Account recovery settings
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # User pool add-ons
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  # Auto-verified attributes
  auto_verified_attributes = ["email"]

  # Username configuration
  username_configuration {
    case_sensitive = false
  }

  # Email configuration
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Schema for required attributes
  schema {
    attribute_data_type = "String"
    name                = "email"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    attribute_data_type = "String"
    name                = "name"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Use email as username
  username_attributes = ["email"]

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-${var.environment}-user-pool"
  })
}

# Cognito User Pool Client (for OAuth code flow without client secret)
resource "aws_cognito_user_pool_client" "main" {
  name         = "${var.project_name}-${var.environment}-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # OAuth configuration for code flow without client secret
  generate_secret = false

  # Allowed OAuth flows
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true

  # Allowed OAuth scopes
  allowed_oauth_scopes = ["email", "openid", "profile"]

  # Writable attributes (allows users to update these during signup/profile editing)
  write_attributes = ["email", "name"]

  # Readable attributes
  read_attributes = ["email", "name"]

  # Callback URLs (includes CloudFront domain and localhost for development)
  callback_urls = [
    "http://localhost:3000/callback",
    "http://localhost:5173/callback",
    "https://${aws_cloudfront_distribution.web.domain_name}/callback"
  ]

  # Logout URLs
  logout_urls = [
    "http://localhost:3000/",
    "http://localhost:5173/",
    "https://${aws_cloudfront_distribution.web.domain_name}/"
  ]

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # Token validity periods
  access_token_validity  = 60 # 1 hour
  id_token_validity      = 60 # 1 hour
  refresh_token_validity = 30 # 30 days

  # Token validity units
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Prevent user existence errors
  prevent_user_existence_errors = "ENABLED"

  # Enable SRP authentication
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
}

# Cognito User Pool Domain for Hosted UI
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-${var.environment}-auth"
  user_pool_id = aws_cognito_user_pool.main.id
}