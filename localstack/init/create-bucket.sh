#!/bin/bash
set -e

BUCKET="pionero-ste-strapi-dev"
REGION="ap-northeast-1"

echo ">>> Ensuring S3 bucket exists: $BUCKET"

awslocal s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1 || \
awslocal s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

echo ">>> S3 bucket ready"