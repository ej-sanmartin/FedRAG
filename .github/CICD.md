# CI/CD Configuration

This directory contains GitHub Actions workflows and environment configurations for the FedRag Privacy RAG Assistant.

## Workflows

### Pull Request Validation (`pr.yml`)

Runs on every pull request to `main` or `develop` branches:

- **Lint and Test**: ESLint, TypeScript type checking, unit tests
- **Build**: Compiles both API and web applications
- **Terraform Plan**: Validates infrastructure changes and posts plan to PR
- **Security Scan**: Trivy vulnerability scanning and tfsec security analysis

### Production Deployment (`deploy.yml`)

Runs on pushes to `main` branch or manual dispatch:

- **Build and Test**: Full test suite and application builds
- **Terraform Plan**: Infrastructure change planning
- **Manual Approval**: Required approval gate for production deployments
- **Terraform Apply**: Infrastructure deployment
- **Frontend Deploy**: S3 sync and CloudFront invalidation
- **Validation**: Post-deployment health checks
- **Rollback**: Automatic rollback on deployment failures

## Environment Configuration

### Production Environment

- **Manual approval required** for all deployments
- **Code owner review required** for protection
- **Restricted to `main` branch** deployments only

### Staging Environment

- **No approval required** for faster iteration
- **Available for `main` and `develop`** branch deployments
- **Automatic deployment** on successful builds

## Required Secrets

Configure these secrets in your GitHub repository settings:

### AWS Configuration
```
AWS_ROLE_ARN=arn:aws:iam::ACCOUNT-ID:role/GitHubActionsRole
```

### Terraform Variables
```
TF_VAR_PROJECT_NAME=fedrag
TF_VAR_ENVIRONMENT=production|staging
TF_VAR_COGNITO_DOMAIN_PREFIX=fedrag-prod
TF_VAR_WEB_CALLBACK_URLS=["https://your-domain.com/callback"]
TF_VAR_WEB_LOGOUT_URLS=["https://your-domain.com/login"]
```

> ℹ️ **AWS Region:** Workflows use the region defined in your Terraform configuration (default `us-east-1`) or an override passed
> through workflow inputs, so it does not need to be stored as a secret.

## AWS IAM Role Setup

Create an IAM role for GitHub Actions OIDC with the following trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT-ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR-ORG/YOUR-REPO:*"
        }
      }
    }
  ]
}
```

Attach the following managed policies:
- `PowerUserAccess` (or create custom policy with required permissions)
- Custom policy for Terraform state management (if using remote state)

## Deployment Process

### Automatic Deployment (Main Branch)
1. Push to `main` branch
2. Automated build and test
3. Terraform plan generation
4. **Manual approval required**
5. Infrastructure deployment
6. Frontend deployment
7. Validation and health checks

### Manual Deployment
1. Go to Actions tab in GitHub
2. Select "Deploy to Production" workflow
3. Click "Run workflow"
4. Choose environment (production/staging)
5. (Optional) Override AWS region if different from your Terraform defaults
6. Optionally skip tests for hotfixes
7. **Manual approval required for production**

### Pull Request Process
1. Create pull request
2. Automated validation runs
3. Terraform plan posted as comment
4. Security scan results available
5. All checks must pass before merge

## Monitoring and Alerts

The workflows include:
- **Build artifacts** uploaded for 30 days (production) or 7 days (PR)
- **Terraform plans** stored as artifacts
- **Deployment summaries** in GitHub Actions summary
- **Failure notifications** with rollback procedures

## Troubleshooting

### Common Issues

**Terraform Plan Fails**
- Check AWS credentials and permissions
- Verify terraform.tfvars configuration
- Review Terraform state consistency

**Build Failures**
- Check Node.js and pnpm versions
- Verify package.json scripts
- Review TypeScript compilation errors

**Deployment Failures**
- Check AWS service limits
- Verify IAM permissions
- Review CloudWatch logs

**Security Scan Failures**
- Review Trivy vulnerability report
- Check tfsec security recommendations
- Update dependencies if needed

### Manual Intervention

If automatic rollback fails:
1. Check AWS Console for resource states
2. Review Terraform state file
3. Use `terraform destroy` if necessary
4. Restore from backup if available

## Best Practices

1. **Always test in staging first**
2. **Review Terraform plans carefully**
3. **Monitor deployment logs**
4. **Keep secrets up to date**
5. **Use feature branches for development**
6. **Tag releases for tracking**

## Support

For issues with CI/CD:
1. Check GitHub Actions logs
2. Review AWS CloudWatch logs
3. Verify environment configuration
4. Contact DevOps team if needed