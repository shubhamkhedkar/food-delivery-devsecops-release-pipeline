mock_provider "aws" {
  source = "./tests/mocks"
}

run "hardened_private_hosts" {
  command = apply

  assert {
    condition     = toset(keys(aws_instance.ci)) == toset(["controller", "agent", "sonarqube"])
    error_message = "Expected controller, agent and sonarqube hosts."
  }

  assert {
    condition     = alltrue([for i in aws_instance.ci : i.associate_public_ip_address == false && i.subnet_id == aws_subnet.private["ap-south-1a"].id])
    error_message = "CI hosts must sit in the private subnet without public IPs."
  }

  assert {
    condition     = alltrue([for i in aws_instance.ci : i.metadata_options[0].http_tokens == "required"])
    error_message = "IMDSv2 must be required on every host."
  }

  assert {
    condition     = aws_instance.ci["controller"].metadata_options[0].http_put_response_hop_limit == 1 && aws_instance.ci["sonarqube"].metadata_options[0].http_put_response_hop_limit == 1 && aws_instance.ci["agent"].metadata_options[0].http_put_response_hop_limit == 2
    error_message = "Only the build agent may expose instance credentials to containers (hop limit 2)."
  }

  assert {
    condition     = alltrue([for i in aws_instance.ci : i.root_block_device[0].encrypted && i.root_block_device[0].kms_key_id == aws_kms_key.ci.arn && i.root_block_device[0].volume_type == "gp3"])
    error_message = "Root volumes must be gp3, encrypted with the CI key."
  }

  assert {
    condition     = alltrue([for i in aws_instance.ci : i.monitoring && i.ebs_optimized])
    error_message = "Hosts need detailed monitoring and EBS optimisation."
  }

  assert {
    condition     = { for k, i in aws_instance.ci : k => i.private_ip } == { controller = "10.40.16.10", agent = "10.40.16.11", sonarqube = "10.40.16.12" }
    error_message = "Hosts must use their fixed private addresses."
  }

  assert {
    condition     = strcontains(local.hosts.controller.user_data, "SONAR_HOST_URL=http://10.40.16.12:9000") && strcontains(local.hosts.agent.user_data, "http://10.40.16.10:8080/jnlpJars/agent.jar")
    error_message = "Bootstrap scripts must point at each other's fixed addresses."
  }

  assert {
    condition     = strcontains(local.hosts.agent.user_data, "trivy_0.76.2_Linux-64bit") && strcontains(local.hosts.agent.user_data, "ECR_REGISTRY=111122223333.dkr.ecr.ap-south-1.amazonaws.com")
    error_message = "Agent bootstrap must install the pinned toolchain and export ECR_REGISTRY."
  }

  assert {
    condition     = strcontains(local.hosts.sonarqube.user_data, "sonarqube:26.11.0.134175-community") && strcontains(local.hosts.sonarqube.user_data, "vm.max_map_count=524288")
    error_message = "SonarQube bootstrap must use the pinned image and kernel limits."
  }

  assert {
    condition     = alltrue([for h in local.hosts : !strcontains(h.user_data, "PASSWORD=") || strcontains(h.user_data, "$(param")])
    error_message = "Bootstrap scripts must read secrets from SSM, never embed them."
  }
}

run "least_privilege_iam_and_registry" {
  command = apply

  assert {
    condition     = length(aws_iam_role_policy_attachment.ssm_core) == 3 && alltrue([for a in aws_iam_role_policy_attachment.ssm_core : endswith(a.policy_arn, "AmazonSSMManagedInstanceCore")])
    error_message = "Every host needs Session Manager access."
  }

  assert {
    condition     = aws_iam_role_policy.agent_ecr_push.role == aws_iam_role.ci["agent"].id
    error_message = "Only the agent role may push images."
  }

  assert {
    condition     = aws_ecr_repository.app.name == "food/platewise" && aws_ecr_repository.app.image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.app.image_scanning_configuration[0].scan_on_push
    error_message = "ECR repository must be immutable and scan on push."
  }

  assert {
    condition     = aws_ecr_repository.app.encryption_configuration[0].encryption_type == "KMS" && aws_ecr_repository.app.encryption_configuration[0].kms_key == aws_kms_key.ci.arn
    error_message = "ECR repository must be encrypted with the CI key."
  }

  assert {
    condition     = jsondecode(aws_ecr_lifecycle_policy.app.policy).rules[1].selection.countNumber == 30
    error_message = "Lifecycle policy should keep 30 tagged images."
  }

  assert {
    condition     = aws_kms_key.ci.enable_key_rotation && aws_kms_key.ci.deletion_window_in_days == 30
    error_message = "The CI key must rotate and have a 30-day deletion window."
  }

  assert {
    condition     = output.ssm_parameter_path == "/platewise/ci" && output.ecr_registry == "111122223333.dkr.ecr.ap-south-1.amazonaws.com"
    error_message = "Outputs changed unexpectedly."
  }

  assert {
    condition     = output.open_jenkins == "aws ssm start-session --region ap-south-1 --target i-0123456789abcdef0 --document-name AWS-StartPortForwardingSession --parameters portNumber=8080,localPortNumber=8080"
    error_message = "open_jenkins output is wrong."
  }
}
