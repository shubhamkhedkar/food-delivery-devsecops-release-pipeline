# Remote state in S3 with native lock files. Supply bucket/key/region at init time:
#   terraform init -backend-config=backend.hcl   (see backend.hcl.example)
# Local checks run with `terraform init -backend=false`.
terraform {
  backend "s3" {}
}
