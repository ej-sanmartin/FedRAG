# Bedrock Guardrails Configuration
# This file creates the Bedrock Guardrail with harm categories, PII protection,
# denied topics, and custom messaging for compliance requirements

# Bedrock Guardrail Resource
resource "aws_bedrock_guardrail" "main" {
  name                      = "${var.project_name}-guardrail"
  description              = "FedRag Privacy-First RAG Assistant Guardrail with PII protection and content filtering"
  blocked_input_messaging  = "I cannot process this request as it contains content that violates our usage policies. Please rephrase your question without sensitive information or prohibited topics."
  blocked_outputs_messaging = "I cannot provide this response as it may contain sensitive information or violate our content policies. Please try rephrasing your question."

  # Content Policy Configuration - Harm Categories with HIGH threshold
  content_policy_config {
    # Hate Speech Filter
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type           = "HATE"
    }

    # Violence Filter
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type           = "VIOLENCE"
    }

    # Self-Harm Filter
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type           = "SELF_HARM"
    }

    # Sexual Content Filter
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type           = "SEXUAL"
    }

    # Misconduct Filter
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type           = "MISCONDUCT"
    }

    # Prompt Attack Filter
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type           = "PROMPT_ATTACK"
    }
  }

  # Sensitive Information Policy Configuration - PII Protection
  sensitive_information_policy_config {
    # Email Address PII
    pii_entities_config {
      action = "MASK"
      type   = "EMAIL"
    }

    # Phone Number PII
    pii_entities_config {
      action = "MASK"
      type   = "PHONE"
    }

    # Social Security Number PII
    pii_entities_config {
      action = "MASK"
      type   = "US_SOCIAL_SECURITY_NUMBER"
    }

    # Credit Card Number PII
    pii_entities_config {
      action = "MASK"
      type   = "CREDIT_DEBIT_CARD_NUMBER"
    }

    # Driver's License PII
    pii_entities_config {
      action = "MASK"
      type   = "US_DRIVER_LICENSE"
    }

    # Passport Number PII
    pii_entities_config {
      action = "MASK"
      type   = "US_PASSPORT_NUMBER"
    }

    # Bank Account Number PII
    pii_entities_config {
      action = "MASK"
      type   = "US_BANK_ACCOUNT_NUMBER"
    }

    # Bank Routing Number PII
    pii_entities_config {
      action = "MASK"
      type   = "US_BANK_ROUTING_NUMBER"
    }

    # Address PII
    pii_entities_config {
      action = "MASK"
      type   = "ADDRESS"
    }

    # Name PII
    pii_entities_config {
      action = "MASK"
      type   = "NAME"
    }

    # Age PII
    pii_entities_config {
      action = "MASK"
      type   = "AGE"
    }

    # Username PII
    pii_entities_config {
      action = "MASK"
      type   = "USERNAME"
    }

    # Password PII
    pii_entities_config {
      action = "MASK"
      type   = "PASSWORD"
    }

    # IP Address PII
    pii_entities_config {
      action = "MASK"
      type   = "IP_ADDRESS"
    }

    # MAC Address PII
    pii_entities_config {
      action = "MASK"
      type   = "MAC_ADDRESS"
    }

    # URL PII
    pii_entities_config {
      action = "MASK"
      type   = "URL"
    }
  }

  # Topic Policy Configuration - Denied Topics for Compliance
  topic_policy_config {
    # Financial Advice Topic
    topics_config {
      name       = "financial-advice"
      definition = "Investment advice, financial planning recommendations, or specific financial product endorsements"
      examples = [
        "Should I invest in cryptocurrency?",
        "What stocks should I buy?",
        "How should I manage my retirement portfolio?"
      ]
      type = "DENY"
    }

    # Legal Advice Topic
    topics_config {
      name       = "legal-advice"
      definition = "Specific legal counsel, interpretation of laws, or recommendations for legal action"
      examples = [
        "Should I sue my employer?",
        "What are my rights in this contract dispute?",
        "How should I handle this legal matter?"
      ]
      type = "DENY"
    }

    # Medical Advice Topic
    topics_config {
      name       = "medical-advice"
      definition = "Diagnosis, treatment recommendations, or specific medical counsel"
      examples = [
        "What medication should I take for this condition?",
        "Do I have a serious illness based on these symptoms?",
        "Should I stop taking my prescribed medication?"
      ]
      type = "DENY"
    }

    # Personal Information Requests Topic
    topics_config {
      name       = "personal-information-requests"
      definition = "Requests for personal, private, or confidential information about individuals"
      examples = [
        "What is John Smith's home address?",
        "Can you provide employee salary information?",
        "What are the personal details of this person?"
      ]
      type = "DENY"
    }

    # Harmful Instructions Topic
    topics_config {
      name       = "harmful-instructions"
      definition = "Instructions for illegal activities, harmful actions, or dangerous behaviors"
      examples = [
        "How to create dangerous substances",
        "Instructions for illegal activities",
        "Ways to harm others or property"
      ]
      type = "DENY"
    }

    # Confidential Business Information Topic
    topics_config {
      name       = "confidential-business-information"
      definition = "Requests for proprietary, confidential, or sensitive business information not intended for public disclosure"
      examples = [
        "What are the company's trade secrets?",
        "Can you share internal financial projections?",
        "What are the details of confidential business strategies?"
      ]
      type = "DENY"
    }
  }

  # Word Policy Configuration - Additional Content Filtering
  word_policy_config {
    # Profanity and Offensive Language
    words_config {
      text = "profanity"
    }
    
    words_config {
      text = "offensive"
    }

    # Managed Word Lists (if available in the region)
    managed_word_lists_config {
      type = "PROFANITY"
    }
  }

  tags = {
    Name        = "${var.project_name}-guardrail"
    Environment = var.environment
    Purpose     = "Content filtering and PII protection"
  }
}

# Guardrail Version (for production use)
resource "aws_bedrock_guardrail_version" "main" {
  guardrail_arn = aws_bedrock_guardrail.main.guardrail_arn
  description   = "Production version of FedRag guardrail configuration"

  tags = {
    Name        = "${var.project_name}-guardrail-version"
    Environment = var.environment
    Version     = "1.0"
  }
}