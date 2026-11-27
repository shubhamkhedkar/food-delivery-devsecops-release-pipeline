mock_provider "aws" {
  source = "./tests/mocks"
}

run "two_az_layout_with_private_ci_hosts" {
  command = apply

  assert {
    condition     = length(aws_subnet.private) == 2 && length(aws_subnet.public) == 2
    error_message = "Expected one public and one private subnet per AZ."
  }

  assert {
    condition     = sort([for s in aws_subnet.private : s.cidr_block]) == tolist(["10.40.16.0/20", "10.40.32.0/20"])
    error_message = "Private subnets changed unexpectedly."
  }

  assert {
    condition     = alltrue([for s in aws_subnet.public : s.map_public_ip_on_launch == false])
    error_message = "Public subnets must not auto-assign public IPs."
  }

  assert {
    condition     = aws_nat_gateway.this.subnet_id == aws_subnet.public["ap-south-1a"].id && aws_route.private_nat.nat_gateway_id == aws_nat_gateway.this.id
    error_message = "Private subnets must egress through the single NAT gateway in the first AZ."
  }

  assert {
    condition     = aws_flow_log.vpc.traffic_type == "ALL" && aws_cloudwatch_log_group.flow_logs.kms_key_id == aws_kms_key.ci.arn && aws_cloudwatch_log_group.flow_logs.retention_in_days == 365
    error_message = "Flow logs must capture ALL traffic into a KMS-encrypted group kept for a year."
  }

  assert {
    condition     = length(aws_default_security_group.this.ingress) == 0 && length(aws_default_security_group.this.egress) == 0
    error_message = "The default security group must have no rules."
  }
}

run "security_groups_never_open_to_the_internet" {
  command = apply

  assert {
    condition     = alltrue([for r in aws_vpc_security_group_ingress_rule.internal : r.cidr_ipv4 == null && r.referenced_security_group_id != null])
    error_message = "Ingress may only reference other CI security groups, never a CIDR."
  }

  assert {
    condition     = toset([for r in aws_vpc_security_group_ingress_rule.internal : r.from_port]) == toset([8080, 9000])
    error_message = "Only Jenkins (8080) and SonarQube (9000) ports may be opened internally."
  }

  assert {
    condition     = alltrue([for r in aws_vpc_security_group_egress_rule.https : r.from_port == 443 && r.to_port == 443 && r.ip_protocol == "tcp"])
    error_message = "Internet egress must be HTTPS only."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.internal["agent_to_controller"].security_group_id == aws_security_group.controller.id && aws_vpc_security_group_ingress_rule.internal["agent_to_controller"].referenced_security_group_id == aws_security_group.agent.id
    error_message = "The agent must be able to reach the controller."
  }
}
