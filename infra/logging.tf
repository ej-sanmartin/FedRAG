# Logging and Monitoring Infrastructure
# This file creates CloudWatch log groups, metrics, alarms, and cost monitoring
# for the FedRag Privacy-First RAG Assistant

# Note: Data sources aws_caller_identity and aws_region are defined in kb.tf

# ============================================================================
# CloudWatch Log Groups with Retention Policies
# ============================================================================

# Extended Lambda Log Group (already exists in api.tf, but we'll reference it)
# The Lambda log group is created in api.tf with 14-day retention

# API Gateway Access Logs (already exists in api.tf)
# The API Gateway log group is created in api.tf with 14-day retention

# Additional Application Log Groups for structured logging
resource "aws_cloudwatch_log_group" "application_metrics" {
  name              = "/aws/lambda/${var.project_name}-api/metrics"
  retention_in_days = 30

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-application-metrics"
    Environment = var.environment
    LogType     = "ApplicationMetrics"
  })
}

resource "aws_cloudwatch_log_group" "security_events" {
  name              = "/aws/lambda/${var.project_name}-api/security"
  retention_in_days = 90

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-security-events"
    Environment = var.environment
    LogType     = "SecurityEvents"
  })
}

resource "aws_cloudwatch_log_group" "pii_detection" {
  name              = "/aws/lambda/${var.project_name}-api/pii"
  retention_in_days = 60

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-pii-detection"
    Environment = var.environment
    LogType     = "PIIDetection"
  })
}

# ============================================================================
# CloudWatch Custom Metrics
# ============================================================================

# Custom metric filters for structured logging
resource "aws_cloudwatch_log_metric_filter" "lambda_errors" {
  name           = "${var.project_name}-lambda-errors"
  log_group_name = "/aws/lambda/${var.project_name}-api"
  pattern        = "[timestamp, request_id, level=\"ERROR\", ...]"

  metric_transformation {
    name          = "LambdaErrors"
    namespace     = "FedRag/API"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "pii_detections" {
  name           = "${var.project_name}-pii-detections"
  log_group_name = aws_cloudwatch_log_group.pii_detection.name
  pattern        = "[timestamp, request_id, level, message=\"PII_DETECTED\", ...]"

  metric_transformation {
    name          = "PIIDetections"
    namespace     = "FedRag/Security"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "guardrail_interventions" {
  name           = "${var.project_name}-guardrail-interventions"
  log_group_name = aws_cloudwatch_log_group.security_events.name
  pattern        = "[timestamp, request_id, level, message=\"GUARDRAIL_INTERVENTION\", ...]"

  metric_transformation {
    name          = "GuardrailInterventions"
    namespace     = "FedRag/Security"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "bedrock_errors" {
  name           = "${var.project_name}-bedrock-errors"
  log_group_name = "/aws/lambda/${var.project_name}-api"
  pattern        = "[timestamp, request_id, level=\"ERROR\", message=\"BEDROCK_ERROR\", ...]"

  metric_transformation {
    name          = "BedrockErrors"
    namespace     = "FedRag/API"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "comprehend_errors" {
  name           = "${var.project_name}-comprehend-errors"
  log_group_name = "/aws/lambda/${var.project_name}-api"
  pattern        = "[timestamp, request_id, level=\"ERROR\", message=\"COMPREHEND_ERROR\", ...]"

  metric_transformation {
    name          = "ComprehendErrors"
    namespace     = "FedRag/API"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "response_latency" {
  name           = "${var.project_name}-response-latency"
  log_group_name = aws_cloudwatch_log_group.application_metrics.name
  pattern        = "[timestamp, request_id, level=\"INFO\", message=\"REQUEST_COMPLETED\", latency_ms]"

  metric_transformation {
    name          = "ResponseLatency"
    namespace     = "FedRag/Performance"
    value         = "$latency_ms"
    default_value = "0"
  }
}

# ============================================================================
# CloudWatch Alarms for Error Rates and Performance
# ============================================================================

# Lambda Error Rate Alarm
resource "aws_cloudwatch_metric_alarm" "lambda_error_rate" {
  alarm_name          = "${var.project_name}-lambda-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "300"
  statistic           = "Sum"
  threshold           = "5"
  alarm_description   = "This metric monitors lambda error rate"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = "${var.project_name}-api"
  }

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-lambda-error-rate-alarm"
    Environment = var.environment
  })
}

# Lambda Duration Alarm
resource "aws_cloudwatch_metric_alarm" "lambda_duration" {
  alarm_name          = "${var.project_name}-lambda-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = "300"
  statistic           = "Average"
  threshold           = "25000" # 25 seconds (close to 30s timeout)
  alarm_description   = "This metric monitors lambda execution duration"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = "${var.project_name}-api"
  }

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-lambda-duration-alarm"
    Environment = var.environment
  })
}

# API Gateway 4XX Error Rate Alarm
resource "aws_cloudwatch_metric_alarm" "api_gateway_4xx_errors" {
  alarm_name          = "${var.project_name}-api-4xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "4XXError"
  namespace           = "AWS/ApiGateway"
  period              = "300"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "This metric monitors API Gateway 4XX errors"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiName = "${var.project_name}-api"
  }

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-api-4xx-errors-alarm"
    Environment = var.environment
  })
}

# API Gateway 5XX Error Rate Alarm
resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx_errors" {
  alarm_name          = "${var.project_name}-api-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = "300"
  statistic           = "Sum"
  threshold           = "1"
  alarm_description   = "This metric monitors API Gateway 5XX errors"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiName = "${var.project_name}-api"
  }

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-api-5xx-errors-alarm"
    Environment = var.environment
  })
}

# Custom Metric Alarms
resource "aws_cloudwatch_metric_alarm" "high_pii_detection_rate" {
  alarm_name          = "${var.project_name}-high-pii-detection-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "PIIDetections"
  namespace           = "FedRag/Security"
  period              = "300"
  statistic           = "Sum"
  threshold           = "20"
  alarm_description   = "This metric monitors high PII detection rates"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-high-pii-detection-alarm"
    Environment = var.environment
  })
}

resource "aws_cloudwatch_metric_alarm" "guardrail_interventions" {
  alarm_name          = "${var.project_name}-guardrail-interventions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "GuardrailInterventions"
  namespace           = "FedRag/Security"
  period              = "300"
  statistic           = "Sum"
  threshold           = "5"
  alarm_description   = "This metric monitors guardrail interventions"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-guardrail-interventions-alarm"
    Environment = var.environment
  })
}

# ============================================================================
# SNS Topics for Alerting
# ============================================================================

# General alerts topic
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-alerts"
    Environment = var.environment
  })
}

# Security-specific alerts topic
resource "aws_sns_topic" "security_alerts" {
  name = "${var.project_name}-security-alerts"

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-security-alerts"
    Environment = var.environment
  })
}

# Cost alerts topic
resource "aws_sns_topic" "cost_alerts" {
  name = "${var.project_name}-cost-alerts"

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-cost-alerts"
    Environment = var.environment
  })
}

# ============================================================================
# Cost Monitoring and Budget Alerts
# ============================================================================

# Budget for overall project costs
resource "aws_budgets_budget" "project_budget" {
  name              = "${var.project_name}-monthly-budget"
  budget_type       = "COST"
  limit_amount      = var.environment == "prod" ? "100" : "50"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2024-01-01_00:00"

  cost_filter {
    name   = "TagKeyValue"
    values = ["Project$FedRag"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = []
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = []
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }

  depends_on = [aws_sns_topic.cost_alerts]

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-monthly-budget"
    Environment = var.environment
  })
}

# Budget specifically for Bedrock costs (can be expensive)
resource "aws_budgets_budget" "bedrock_budget" {
  name              = "${var.project_name}-bedrock-budget"
  budget_type       = "COST"
  limit_amount      = var.environment == "prod" ? "50" : "25"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2024-01-01_00:00"

  cost_filter {
    name   = "Service"
    values = ["Amazon Bedrock"]
  }

  cost_filter {
    name   = "TagKeyValue"
    values = ["Project$FedRag"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 70
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = []
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 90
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = []
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }

  depends_on = [aws_sns_topic.cost_alerts]

  tags = merge(var.common_tags, {
    Name        = "${var.project_name}-bedrock-budget"
    Environment = var.environment
  })
}

# ============================================================================
# CloudWatch Dashboard
# ============================================================================

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project_name}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", "${var.project_name}-api"],
            [".", "Errors", ".", "."],
            [".", "Invocations", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "Lambda Performance"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiName", "${var.project_name}-api"],
            [".", "4XXError", ".", "."],
            [".", "5XXError", ".", "."],
            [".", "Latency", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "API Gateway Metrics"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["FedRag/Security", "PIIDetections"],
            [".", "GuardrailInterventions"]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "Security Metrics"
          period  = 300
        }
      }
    ]
  })


}