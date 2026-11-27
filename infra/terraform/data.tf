data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

# Latest Amazon Linux 2023 AMI, resolved at plan time from the public SSM parameter.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  public_subnet_cidrs  = { for i, az in var.availability_zones : az => cidrsubnet(var.vpc_cidr, 8, i) }
  private_subnet_cidrs = { for i, az in var.availability_zones : az => cidrsubnet(var.vpc_cidr, 4, i + 1) }
  ci_az                = var.availability_zones[0]

  # Secrets for the CI hosts live under this SecureString path. They are created out of band
  # (aws ssm put-parameter, see README) so they never enter Terraform state.
  ssm_path     = "/${var.name}/ci"
  ssm_path_arn = "arn:${local.partition}:ssm:${var.region}:${local.account_id}:parameter${local.ssm_path}"

  ecr_registry = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}
