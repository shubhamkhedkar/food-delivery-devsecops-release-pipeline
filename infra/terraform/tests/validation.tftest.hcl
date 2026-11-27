mock_provider "aws" {
  source = "./tests/mocks"
}

run "rejects_bad_name" {
  command = plan
  variables {
    name = "Platewise_CI"
  }
  expect_failures = [var.name]
}

run "rejects_three_azs" {
  command = plan
  variables {
    availability_zones = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
  }
  expect_failures = [var.availability_zones]
}

run "rejects_tiny_vpc" {
  command = plan
  variables {
    vpc_cidr = "10.40.0.0/24"
  }
  expect_failures = [var.vpc_cidr]
}

run "rejects_undersized_sonarqube" {
  command = plan
  variables {
    sonarqube_instance_type = "t3.small"
  }
  expect_failures = [var.sonarqube_instance_type]
}

run "rejects_unpinned_sonarqube" {
  command = plan
  variables {
    sonarqube_image = "sonarqube:latest"
  }
  expect_failures = [var.sonarqube_image]
}

run "rejects_http_repository" {
  command = plan
  variables {
    repository_url = "http://example.com/repo.git"
  }
  expect_failures = [var.repository_url]
}

run "rejects_short_log_retention" {
  command = plan
  variables {
    log_retention_days = 30
  }
  expect_failures = [var.log_retention_days]
}

run "rejects_unpinned_tool" {
  command = plan
  variables {
    agent_tool_versions = {
      checkov     = "3.4.11", compose = "5.8.0", conftest = "0.71.1", gitleaks = "8.30.1", hadolint = "2.12.0",
      kubeconform = "0.8.0", kubectl = "1.37.3", kustomize = "5.8.3", prometheus = "3.16.0", ruff = "0.17.6",
      terraform   = "1.17.2", tflint = "0.66.0", trivy = "latest", yamllint = "1.38.0"
    }
  }
  expect_failures = [var.agent_tool_versions]
}
