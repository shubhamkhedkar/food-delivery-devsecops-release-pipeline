.PHONY: help check check-config test lint image scan compose-smoke kind-smoke jenkins-lint smoke-all up down render prometheusrule tf-test clean

DOCKER ?= docker
IMAGE ?= platewise:local

help:              ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-17s %s\n", $$1, $$2}'

check:             ## every offline gate (app, config, policy, Terraform, Checkov, Trivy FS, gitleaks)
	./scripts/check-all.sh

check-config:      ## only the non-app checks (what the Jenkins "Config, policy and Terraform" stage runs)
	./scripts/check-config.sh

test:              ## app unit tests with the coverage gate
	cd app && npm test

lint:              ## ESLint
	cd app && npm run lint

tf-test:           ## Terraform fmt/validate/TFLint and the mocked terraform test suite
	cd infra/terraform && terraform fmt -check -recursive && terraform init -backend=false -input=false >/dev/null && terraform validate && tflint && terraform test

image:             ## build the distroless runtime image (lint + tests + build run inside)
	$(DOCKER) build --build-arg GIT_COMMIT=$$(git rev-parse HEAD 2>/dev/null || echo unknown) -t $(IMAGE) .

scan: image        ## Trivy: fail on fixable HIGH/CRITICAL vulnerabilities in the image
	trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed $(IMAGE)

compose-smoke:     ## app + Prometheus + Grafana: order flow, metrics, dashboards, then torn down
	./scripts/compose-smoke.sh

kind-smoke: image  ## rehearse the rollout on a throwaway 2-node kind cluster
	IMAGE=$(IMAGE) ./scripts/kind-smoke.sh

jenkins-lint:      ## boot the JCasC Jenkins image locally and validate the Jenkinsfile
	./scripts/jenkins-lint.sh

smoke-all: compose-smoke kind-smoke jenkins-lint ## every Docker-based rehearsal

up:                ## start the local demo stack (needs .env, see .env.example)
	$(DOCKER) compose up -d --build

down:              ## stop the local demo stack and delete its volumes
	ORDER_SIGNING_KEY=$${ORDER_SIGNING_KEY:-unused} GRAFANA_ADMIN_PASSWORD=$${GRAFANA_ADMIN_PASSWORD:-unused} $(DOCKER) compose down -v --remove-orphans

render:            ## render the kind and production overlays into rendered/ and validate them
	./scripts/render-manifests.sh

prometheusrule:    ## regenerate the PrometheusRule from the promtool-tested rule file
	python3 scripts/sync-prometheusrule.py

clean:             ## remove generated output
	rm -rf rendered reports app/node_modules app/dist app/coverage app/reports infra/terraform/.terraform
