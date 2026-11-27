# Three CI hosts in the private subnet of the first AZ, all Amazon Linux 2023:
#   controller  Jenkins controller built from ci/jenkins (configuration-as-code)
#   agent       Docker build agent with the scanners the Jenkinsfile calls
#   sonarqube   SonarQube Community + PostgreSQL in containers
# Hardening on every host: IMDSv2 only (hop limit 1 for the controller and SonarQube, 2 on the
# agent so build containers can use the instance role), encrypted gp3 root volumes with the
# CI key, detailed monitoring, no public IP, no SSH key pair (Session Manager only).
locals {
  # Fixed private addresses so each host's bootstrap can find the others without DNS.
  host_ips = {
    controller = cidrhost(local.private_subnet_cidrs[local.ci_az], 10)
    agent      = cidrhost(local.private_subnet_cidrs[local.ci_az], 11)
    sonarqube  = cidrhost(local.private_subnet_cidrs[local.ci_az], 12)
  }

  hosts = {
    controller = {
      instance_type = var.controller_instance_type
      volume_gib    = var.root_volume_gib.controller
      sg            = aws_security_group.controller.id
      hop_limit     = 1
      user_data = templatefile("${path.module}/templates/jenkins-controller.sh.tftpl", {
        region         = var.region
        ssm_path       = "${local.ssm_path}/controller"
        repository_url = var.repository_url
        repository_ref = var.repository_ref
        controller_ip  = local.host_ips.controller
        sonar_url      = "http://${local.host_ips.sonarqube}:9000"
      })
    }
    agent = {
      instance_type = var.agent_instance_type
      volume_gib    = var.root_volume_gib.agent
      sg            = aws_security_group.agent.id
      hop_limit     = 2
      user_data = templatefile("${path.module}/templates/jenkins-agent.sh.tftpl", {
        region        = var.region
        ssm_path      = "${local.ssm_path}/agent"
        ecr_registry  = local.ecr_registry
        controller_ip = local.host_ips.controller
        versions      = var.agent_tool_versions
      })
    }
    sonarqube = {
      instance_type = var.sonarqube_instance_type
      volume_gib    = var.root_volume_gib.sonarqube
      sg            = aws_security_group.sonarqube.id
      hop_limit     = 1
      user_data = templatefile("${path.module}/templates/sonarqube.sh.tftpl", {
        region          = var.region
        ssm_path        = "${local.ssm_path}/sonarqube"
        sonarqube_ip    = local.host_ips.sonarqube
        sonarqube_image = var.sonarqube_image
        postgres_image  = var.postgres_image
      })
    }
  }
}

resource "aws_instance" "ci" {
  for_each = local.hosts

  ami                         = nonsensitive(data.aws_ssm_parameter.al2023.value)
  instance_type               = each.value.instance_type
  subnet_id                   = aws_subnet.private[local.ci_az].id
  private_ip                  = local.host_ips[each.key]
  vpc_security_group_ids      = [each.value.sg]
  iam_instance_profile        = aws_iam_instance_profile.ci[each.key].name
  associate_public_ip_address = false
  monitoring                  = true
  ebs_optimized               = true
  user_data_base64            = base64gzip(each.value.user_data)
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = each.value.hop_limit
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = each.value.volume_gib
    encrypted             = true
    kms_key_id            = aws_kms_key.ci.arn
    delete_on_termination = true
  }

  tags = { Name = "${var.name}-${each.key}", Role = each.key }

  lifecycle {
    ignore_changes = [ami]
  }
}
