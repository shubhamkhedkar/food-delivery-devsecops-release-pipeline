// Platewise DevSecOps release pipeline (declarative).
//
// Gates, in order:
//   lint + unit tests (coverage gate) + config/policy/Terraform checks
//   -> SonarQube analysis + quality gate
//   -> supply chain: OWASP Dependency-Check, npm audit, Trivy filesystem/IaC, gitleaks
//   -> image build -> Trivy image scan + CycloneDX SBOM -> compose smoke test of the real image
//   -> (main + PUBLISH) push to ECR by digest -> pin the production overlay to that digest
//   -> (main + DEPLOY, after a human approves) kubectl apply with automatic rollback.
//
// No long-lived cloud keys: the agent pushes to ECR with its EC2 instance role (infra/terraform).
// Every other credential is a Jenkins credential ID; none live in this repository, and secrets
// are expanded by the shell from environment variables, never interpolated by Groovy.

pipeline {
  agent { label 'docker' }

  options {
    timestamps()
    timeout(time: 75, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
    disableConcurrentBuilds(abortPrevious: true)
    skipDefaultCheckout()
  }

  parameters {
    booleanParam(name: 'PUBLISH', defaultValue: false,
      description: 'On main: push the image to ECR and pin deploy/k8s/overlays/production to its digest')
    booleanParam(name: 'DEPLOY', defaultValue: false,
      description: 'On main, after PUBLISH: roll the pinned overlay out to the cluster (asks for approval)')
  }

  tools {
    nodejs 'node24'
  }

  environment {
    APP = 'platewise'
    AWS_REGION = 'ap-south-1'
    // Set ECR_REGISTRY on the agent (terraform output ecr_registry); a placeholder keeps PR builds offline.
    REGISTRY = "${env.ECR_REGISTRY ?: 'registry.example.com'}"
    IMAGE = "${REGISTRY}/food/platewise"
    REPORTS = 'reports'
    TRIVY_CACHE_DIR = "${WORKSPACE}/.trivy-cache"
    NPM_CONFIG_CACHE = "${WORKSPACE}/.npm"
  }

  stages {
    stage('Checkout') {
      steps {
        cleanWs()
        checkout scm
        script {
          env.GIT_SHORT = sh(returnStdout: true, script: 'git rev-parse --short=12 HEAD').trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_SHORT}"
          // Commits made by the release-bump stage must not start another release cycle.
          env.BOT_COMMIT = sh(returnStatus: true, script: 'git log -1 --pretty=%B | grep -q "\\[release-bump\\]"') == 0 ? 'true' : 'false'
        }
        sh 'mkdir -p "$REPORTS"'
      }
    }

    stage('Release') {
      when {
        beforeAgent true
        environment name: 'BOT_COMMIT', value: 'false'
      }
      stages {
        stage('Install') {
          steps {
            dir('app') {
              sh 'npm ci --ignore-scripts --no-audit --no-fund'
            }
          }
        }

        stage('Quality') {
          parallel {
            stage('Lint') {
              steps {
                dir('app') {
                  sh 'npm run lint'
                }
              }
            }
            stage('Unit tests') {
              steps {
                dir('app') {
                  sh 'npm test'
                }
              }
              post {
                always {
                  junit allowEmptyResults: false, testResults: 'app/reports/junit.xml'
                  recordCoverage(tools: [[parser: 'COBERTURA', pattern: 'app/coverage/cobertura-coverage.xml']],
                    sourceCodeRetention: 'NEVER')
                }
              }
            }
            stage('Config, policy and Terraform') {
              steps {
                sh './scripts/check-config.sh'
              }
            }
          }
        }

        stage('SonarQube analysis') {
          environment {
            SCANNER_HOME = tool 'sonar-scanner'
          }
          steps {
            withSonarQubeEnv('sonarqube') {
              sh '"$SCANNER_HOME/bin/sonar-scanner" -Dsonar.projectVersion="$IMAGE_TAG"'
            }
          }
        }

        stage('Quality gate') {
          steps {
            timeout(time: 10, unit: 'MINUTES') {
              waitForQualityGate abortPipeline: true
            }
          }
        }

        stage('Supply chain') {
          parallel {
            stage('OWASP Dependency-Check') {
              environment {
                ODC_HOME = tool 'dependency-check'
              }
              steps {
                withCredentials([string(credentialsId: 'nvd-api-key', variable: 'NVD_API_KEY')]) {
                  sh '''
                    "$ODC_HOME/bin/dependency-check.sh" --project platewise \
                      --scan app/package-lock.json --nvdApiKey "$NVD_API_KEY" \
                      --format XML --format HTML --out "$REPORTS/dependency-check" \
                      --disableYarnAudit --disablePnpmAudit --failOnCVSS 7
                  '''
                }
              }
              post {
                always {
                  dependencyCheckPublisher pattern: 'reports/dependency-check/dependency-check-report.xml',
                    failedTotalCritical: 1, failedTotalHigh: 1, stopBuild: true
                }
              }
            }
            stage('npm audit') {
              steps {
                dir('app') {
                  sh 'npm audit --audit-level=moderate'
                }
              }
            }
            stage('Trivy filesystem and IaC') {
              steps {
                sh '''
                  trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed \
                    --exit-code 1 --skip-dirs app/node_modules --format table \
                    --output "$REPORTS/trivy-fs.txt" .
                '''
              }
            }
            stage('Secret scan') {
              steps {
                sh 'gitleaks git --no-banner --redact --report-format sarif --report-path "$REPORTS/gitleaks.sarif" .'
              }
            }
          }
        }

        stage('Build image') {
          steps {
            sh '''
              docker build --pull \
                --build-arg APP_VERSION="$IMAGE_TAG" --build-arg GIT_COMMIT="$GIT_COMMIT" \
                -t "$IMAGE:$IMAGE_TAG" -t platewise:local .
            '''
          }
        }

        stage('Scan image') {
          steps {
            sh '''
              trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
                --format table --output "$REPORTS/trivy-image.txt" "$IMAGE:$IMAGE_TAG"
              trivy image --format cyclonedx --output "$REPORTS/sbom.cdx.json" "$IMAGE:$IMAGE_TAG"
            '''
          }
        }

        stage('Smoke test') {
          steps {
            sh './scripts/compose-smoke.sh'
          }
        }

        stage('Publish image') {
          when {
            allOf {
              branch 'main'
              expression { return params.PUBLISH }
            }
          }
          steps {
            sh '''
              aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
              docker push "$IMAGE:$IMAGE_TAG"
              docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE:$IMAGE_TAG" | cut -d@ -f2 > "$REPORTS/image-digest.txt"
              docker logout "$REGISTRY"
            '''
          }
        }

        stage('Release manifest') {
          when {
            allOf {
              branch 'main'
              expression { return params.PUBLISH }
            }
          }
          steps {
            withCredentials([gitUsernamePassword(credentialsId: 'github-push', gitToolName: 'Default')]) {
              sh './scripts/release-bump.sh "$IMAGE" "$IMAGE_TAG" "$(cat "$REPORTS/image-digest.txt")"'
            }
          }
        }

        stage('Deploy') {
          when {
            beforeInput true
            allOf {
              branch 'main'
              expression { return params.PUBLISH && params.DEPLOY }
            }
          }
          input {
            message 'Roll the pinned image out to production?'
            ok 'Deploy'
            submitter 'admin,release-approver'
          }
          steps {
            withCredentials([file(credentialsId: 'platewise-kubeconfig', variable: 'KUBECONFIG')]) {
              sh '''
                kubectl kustomize deploy/k8s/overlays/production > "$REPORTS/release.yaml"
                kubectl diff -f "$REPORTS/release.yaml" > "$REPORTS/release.diff" || [ $? -eq 1 ]
                kubectl apply --server-side --field-manager=jenkins -f "$REPORTS/release.yaml"
                if ! kubectl -n platewise rollout status deploy/platewise --timeout=300s; then
                  kubectl -n platewise rollout undo deploy/platewise
                  kubectl -n platewise rollout status deploy/platewise --timeout=300s
                  echo "rollout failed: rolled back to the previous ReplicaSet" >&2
                  exit 1
                fi
              '''
            }
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true, fingerprint: true
    }
    cleanup {
      sh 'docker image rm "$IMAGE:$IMAGE_TAG" platewise:local >/dev/null 2>&1 || true'
      cleanWs(deleteDirs: true, disableDeferredWipeout: true)
    }
  }
}
