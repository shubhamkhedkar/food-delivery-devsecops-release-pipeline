# Fake values for the mocked AWS provider. Nothing in `terraform test` talks to AWS.
# The provider still validates ARN-shaped arguments, so ARNs that feed other resources are well formed.

mock_data "aws_caller_identity" {
  defaults = {
    account_id = "111122223333"
  }
}

mock_data "aws_partition" {
  defaults = {
    partition = "aws"
  }
}

mock_data "aws_ssm_parameter" {
  defaults = {
    value = "ami-0123456789abcdef0"
  }
}

mock_data "aws_iam_policy_document" {
  defaults = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

mock_resource "aws_kms_key" {
  defaults = {
    arn    = "arn:aws:kms:ap-south-1:111122223333:key/00000000-0000-0000-0000-000000000000"
    key_id = "00000000-0000-0000-0000-000000000000"
  }
}

mock_resource "aws_iam_role" {
  defaults = {
    arn  = "arn:aws:iam::111122223333:role/mock-role"
    name = "mock-role"
  }
}

mock_resource "aws_cloudwatch_log_group" {
  defaults = {
    arn = "arn:aws:logs:ap-south-1:111122223333:log-group:mock"
  }
}

mock_resource "aws_ecr_repository" {
  defaults = {
    arn            = "arn:aws:ecr:ap-south-1:111122223333:repository/food/platewise"
    repository_url = "111122223333.dkr.ecr.ap-south-1.amazonaws.com/food/platewise"
  }
}

mock_resource "aws_instance" {
  defaults = {
    id = "i-0123456789abcdef0"
  }
}
