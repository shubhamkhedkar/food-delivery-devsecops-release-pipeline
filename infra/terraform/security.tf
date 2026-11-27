# Least-privilege security groups. Nothing accepts traffic from the internet:
#   agent      -> controller :8080 (inbound agent over WebSocket)
#   controller -> sonarqube  :9000 (quality gate webhook polling)
#   agent      -> sonarqube  :9000 (scanner upload)
#   sonarqube  -> controller :8080 (quality gate webhook)
# Egress to the internet is HTTPS only (packages, plugins, GitHub, ECR, SSM, NVD).
resource "aws_security_group" "controller" {
  name_prefix = "${var.name}-jenkins-controller-"
  description = "Jenkins controller: reachable only from the build agent and SonarQube"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name}-jenkins-controller" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "agent" {
  name_prefix = "${var.name}-jenkins-agent-"
  description = "Jenkins build agent: no inbound traffic at all"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name}-jenkins-agent" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "sonarqube" {
  name_prefix = "${var.name}-sonarqube-"
  description = "SonarQube: reachable only from the Jenkins controller and agent"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name}-sonarqube" }

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  internal_rules = {
    agent_to_controller = { from = aws_security_group.agent.id, to = aws_security_group.controller.id, port = 8080, what = "Jenkins inbound agent (WebSocket)" }
    sonar_to_controller = { from = aws_security_group.sonarqube.id, to = aws_security_group.controller.id, port = 8080, what = "SonarQube quality gate webhook" }
    controller_to_sonar = { from = aws_security_group.controller.id, to = aws_security_group.sonarqube.id, port = 9000, what = "Jenkins to SonarQube API" }
    agent_to_sonar      = { from = aws_security_group.agent.id, to = aws_security_group.sonarqube.id, port = 9000, what = "Sonar scanner upload" }
  }
  https_egress = {
    controller = aws_security_group.controller.id
    agent      = aws_security_group.agent.id
    sonarqube  = aws_security_group.sonarqube.id
  }
}

resource "aws_vpc_security_group_ingress_rule" "internal" {
  for_each = local.internal_rules

  security_group_id            = each.value.to
  referenced_security_group_id = each.value.from
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  description                  = each.value.what
}

resource "aws_vpc_security_group_egress_rule" "internal" {
  for_each = local.internal_rules

  security_group_id            = each.value.from
  referenced_security_group_id = each.value.to
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  description                  = each.value.what
}

resource "aws_vpc_security_group_egress_rule" "https" {
  for_each = local.https_egress

  security_group_id = each.value
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to package mirrors, GitHub, AWS APIs and vulnerability feeds"
}
