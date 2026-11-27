provider "aws" {
  region = var.region

  default_tags {
    tags = merge(
      {
        Project     = var.name
        Environment = var.environment
        ManagedBy   = "terraform"
        Repository  = "github.com/shubhamkhedkar/food-delivery-devsecops-release-pipeline"
      },
      var.tags,
    )
  }
}
