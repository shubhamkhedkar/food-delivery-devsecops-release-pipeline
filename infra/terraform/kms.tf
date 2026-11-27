# One customer managed key for EBS volumes, VPC flow logs, the ECR repository and the CI
# SecureString parameters. Rotated yearly. Key policy "*" resources mean "this key".
data "aws_iam_policy_document" "kms" {
  #checkov:skip=CKV_AWS_109:Key policy resource "*" is scoped to this key by definition.
  #checkov:skip=CKV_AWS_111:Key policy resource "*" is scoped to this key by definition.
  #checkov:skip=CKV_AWS_356:Key policy resource "*" is scoped to this key by definition.

  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid = "CloudWatchLogs"
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_key" "ci" {
  description             = "${var.name} CI toolchain: EBS, flow logs, ECR and SSM SecureString parameters"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json
}

resource "aws_kms_alias" "ci" {
  name          = "alias/${var.name}-ci"
  target_key_id = aws_kms_key.ci.key_id
}
