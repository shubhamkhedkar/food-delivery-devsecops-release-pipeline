output "ecr_registry" {
  description = "Set as ECR_REGISTRY on the Jenkins agent (the Jenkinsfile pushes to <registry>/food/platewise)."
  value       = local.ecr_registry
}

output "ecr_repository_url" {
  description = "Image repository URL."
  value       = aws_ecr_repository.app.repository_url
}

output "instance_ids" {
  description = "CI host instance IDs by role."
  value       = { for role, i in aws_instance.ci : role => i.id }
}

output "private_ips" {
  description = "CI host private IPs by role."
  value       = { for role, i in aws_instance.ci : role => i.private_ip }
}

output "ssm_parameter_path" {
  description = "Create the CI secrets under this path as SecureString parameters with the CI KMS key."
  value       = local.ssm_path
}

output "kms_key_alias" {
  description = "Use this key for the SecureString parameters (--key-id)."
  value       = aws_kms_alias.ci.name
}

output "open_jenkins" {
  description = "Port-forward the Jenkins UI to http://localhost:8080 through Session Manager."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.ci["controller"].id} --document-name AWS-StartPortForwardingSession --parameters portNumber=8080,localPortNumber=8080"
}

output "open_sonarqube" {
  description = "Port-forward the SonarQube UI to http://localhost:9000 through Session Manager."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.ci["sonarqube"].id} --document-name AWS-StartPortForwardingSession --parameters portNumber=9000,localPortNumber=9000"
}
