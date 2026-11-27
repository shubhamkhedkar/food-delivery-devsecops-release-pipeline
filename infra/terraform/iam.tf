# One instance role per CI host. All three get Session Manager (no SSH keys, no bastion);
# each may read only its own SecureString parameters, and only the build agent may push,
# and only to this project's ECR repository.
locals {
  roles = toset(["controller", "agent", "sonarqube"])
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ci" {
  for_each = local.roles

  name_prefix        = "${var.name}-${each.key}-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  for_each = local.roles

  role       = aws_iam_role.ci[each.key].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "read_own_parameters" {
  for_each = local.roles

  statement {
    sid       = "ReadOwnParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["${local.ssm_path_arn}/${each.key}", "${local.ssm_path_arn}/${each.key}/*"]
  }

  statement {
    sid       = "DecryptViaSsmOnly"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.ci.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "read_own_parameters" {
  for_each = local.roles

  name   = "read-own-ci-parameters"
  role   = aws_iam_role.ci[each.key].id
  policy = data.aws_iam_policy_document.read_own_parameters[each.key].json
}

data "aws_iam_policy_document" "ecr_push" {
  statement {
    sid = "AuthToken"
    #checkov:skip=CKV_AWS_356:ecr:GetAuthorizationToken does not support resource-level permissions.
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushThisRepositoryOnly"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    sid       = "UseRepositoryKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.ci.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ecr.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "agent_ecr_push" {
  name   = "push-platewise-image"
  role   = aws_iam_role.ci["agent"].id
  policy = data.aws_iam_policy_document.ecr_push.json
}

resource "aws_iam_instance_profile" "ci" {
  for_each = local.roles

  name_prefix = "${var.name}-${each.key}-"
  role        = aws_iam_role.ci[each.key].name
}
