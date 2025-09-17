// Set up environment variables for tests
process.env.KB_ID = 'test-kb-id'
process.env.MODEL_ARN = 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0'
process.env.GR_DEFAULT_ID = 'test-guardrail-id'
process.env.GR_DEFAULT_VERSION = 'DRAFT'
process.env.GR_COMPLIANCE_ID = 'test-compliance-guardrail'
process.env.GR_COMPLIANCE_VERSION = '1'