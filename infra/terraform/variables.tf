variable "name" {
  description = "Name prefix for every resource (also the ECR namespace and SSM parameter path)."
  type        = string
  default     = "platewise"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.name))
    error_message = "name must be 3-21 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Environment tag value."
  type        = string
  default     = "ci"
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "ap-south-1"
}

variable "availability_zones" {
  description = "Two AZs: the CI hosts live in the first, the second keeps the subnet layout ready for an ALB."
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "Exactly two availability zones are expected."
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR block (a /16 to /20)."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) >= 16 && tonumber(split("/", var.vpc_cidr)[1]) <= 20
    error_message = "vpc_cidr must be a valid IPv4 CIDR between /16 and /20."
  }
}

variable "controller_instance_type" {
  description = "Jenkins controller instance type."
  type        = string
  default     = "t3.medium"
}

variable "agent_instance_type" {
  description = "Jenkins build agent instance type (Docker builds, Trivy, Dependency-Check)."
  type        = string
  default     = "t3.large"
}

variable "sonarqube_instance_type" {
  description = "SonarQube instance type (needs at least 4 GiB of memory)."
  type        = string
  default     = "t3.large"

  validation {
    condition     = !contains(["t3.micro", "t3.small", "t3a.micro", "t3a.small", "t2.micro", "t2.small"], var.sonarqube_instance_type)
    error_message = "SonarQube needs at least 4 GiB of memory; pick t3.medium or larger."
  }
}

variable "root_volume_gib" {
  description = "Root volume size per role."
  type        = object({ controller = number, agent = number, sonarqube = number })
  default     = { controller = 30, agent = 60, sonarqube = 40 }
}

variable "repository_url" {
  description = "Git URL the controller clones to build its configuration-as-code image (ci/jenkins)."
  type        = string
  default     = "https://github.com/shubhamkhedkar/food-delivery-devsecops-release-pipeline.git"

  validation {
    condition     = startswith(var.repository_url, "https://")
    error_message = "repository_url must be an https:// URL."
  }
}

variable "repository_ref" {
  description = "Branch, tag or commit of repository_url to bootstrap from."
  type        = string
  default     = "main"
}

variable "sonarqube_image" {
  description = "SonarQube Community image (pinned version)."
  type        = string
  default     = "sonarqube:26.11.0.134175-community"

  validation {
    condition     = !endswith(var.sonarqube_image, ":latest") && length(split(":", var.sonarqube_image)) == 2
    error_message = "Pin sonarqube_image to an explicit version tag."
  }
}

variable "postgres_image" {
  description = "PostgreSQL image for SonarQube (pinned version)."
  type        = string
  default     = "postgres:17.12-alpine"
}

variable "agent_tool_versions" {
  description = "Pinned versions of the tools the build agent installs (match the versions the repo is checked with)."
  type        = map(string)
  default = {
    checkov     = "3.4.11"
    compose     = "5.8.0"
    conftest    = "0.71.1"
    gitleaks    = "8.30.1"
    hadolint    = "2.12.0"
    kubeconform = "0.8.0"
    kubectl     = "1.37.3"
    kustomize   = "5.8.3"
    prometheus  = "3.16.0"
    ruff        = "0.17.6"
    terraform   = "1.17.2"
    tflint      = "0.66.0"
    trivy       = "0.76.2"
    yamllint    = "1.38.0"
  }

  validation {
    condition     = alltrue([for k in ["checkov", "compose", "conftest", "gitleaks", "hadolint", "kubeconform", "kubectl", "kustomize", "prometheus", "ruff", "terraform", "tflint", "trivy", "yamllint"] : can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.agent_tool_versions[k]))])
    error_message = "agent_tool_versions needs an x.y.z version for every tool."
  }
}

variable "log_retention_days" {
  description = "CloudWatch retention for VPC flow logs."
  type        = number
  default     = 365

  validation {
    condition     = contains([365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "Keep logs for at least a year (a CloudWatch-supported value of 365 days or more)."
  }
}

variable "ecr_keep_tagged_images" {
  description = "How many tagged images the ECR lifecycle policy keeps."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Extra tags merged into the provider default tags."
  type        = map(string)
  default     = {}
}
