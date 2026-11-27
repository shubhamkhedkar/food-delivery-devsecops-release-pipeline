# Jenkins controller image for this pipeline: pinned LTS, the exact plugin set the Jenkinsfile
# needs, configuration-as-code, no setup wizard. scripts/jenkins-lint.sh boots it locally to
# prove the JCasC loads and to run the declarative linter against the Jenkinsfile.
FROM jenkins/jenkins:2.580.2-lts-jdk21@sha256:74401de6a6f92e1afe1b02d1c8e3d0c33f263bfb5275dd8813f9150355f2367b

ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false" \
    CASC_JENKINS_CONFIG=/usr/share/jenkins/casc/jenkins.yaml

COPY --chown=root:root plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY --chown=root:root casc/jenkins.yaml /usr/share/jenkins/casc/jenkins.yaml

USER 1000:1000
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=10 \
  CMD ["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:8080/login"]
