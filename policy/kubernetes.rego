# Workload guardrails for the rendered Kustomize overlays (conftest test --all-namespaces).
package kubernetes

workload_kinds := {"Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"}

pod_spec := input.spec.template.spec if input.kind in {"Deployment", "StatefulSet", "DaemonSet", "Job"}

pod_spec := input.spec.jobTemplate.spec.template.spec if input.kind == "CronJob"

containers contains c if some c in pod_spec.containers

containers contains c if some c in pod_spec.initContainers

name := sprintf("%s/%s", [input.kind, input.metadata.name])

deny contains msg if {
	input.kind in workload_kinds
	not pod_spec.securityContext.runAsNonRoot
	msg := sprintf("%s: pod securityContext.runAsNonRoot must be true", [name])
}

deny contains msg if {
	input.kind in workload_kinds
	object.get(pod_spec, "automountServiceAccountToken", true) != false
	msg := sprintf("%s: automountServiceAccountToken must be false", [name])
}

deny contains msg if {
	input.kind in workload_kinds
	some field in ["hostNetwork", "hostPID", "hostIPC"]
	pod_spec[field] == true
	msg := sprintf("%s: %s is not allowed", [name, field])
}

deny contains msg if {
	input.kind in workload_kinds
	some v in pod_spec.volumes
	v.hostPath
	msg := sprintf("%s: hostPath volume %q is not allowed", [name, v.name])
}

deny contains msg if {
	some c in containers
	not c.securityContext.readOnlyRootFilesystem
	msg := sprintf("%s: container %q needs readOnlyRootFilesystem: true", [name, c.name])
}

deny contains msg if {
	some c in containers
	object.get(c, ["securityContext", "allowPrivilegeEscalation"], true) != false
	msg := sprintf("%s: container %q must set allowPrivilegeEscalation: false", [name, c.name])
}

deny contains msg if {
	some c in containers
	not "ALL" in object.get(c, ["securityContext", "capabilities", "drop"], [])
	msg := sprintf("%s: container %q must drop ALL capabilities", [name, c.name])
}

deny contains msg if {
	some c in containers
	some r in ["cpu", "memory"]
	not c.resources.requests[r]
	msg := sprintf("%s: container %q needs a %s request", [name, c.name, r])
}

deny contains msg if {
	some c in containers
	not c.resources.limits.memory
	msg := sprintf("%s: container %q needs a memory limit", [name, c.name])
}

deny contains msg if {
	some c in pod_spec.containers
	input.kind in {"Deployment", "StatefulSet", "DaemonSet"}
	some probe in ["readinessProbe", "livenessProbe"]
	not c[probe]
	msg := sprintf("%s: container %q needs a %s", [name, c.name, probe])
}

deny contains msg if {
	some c in containers
	endswith(c.image, ":latest")
	msg := sprintf("%s: container %q uses the mutable :latest tag", [name, c.name])
}

deny contains msg if {
	some c in containers
	not contains(c.image, ":")
	not contains(c.image, "@")
	msg := sprintf("%s: container %q image %q has no tag or digest", [name, c.name, c.image])
}

# Credentials must come from Secrets, never literal env values.
deny contains msg if {
	some c in containers
	some e in c.env
	regex.match(`(?i)(api_?key|token|password|secret)$`, e.name)
	e.value
	msg := sprintf("%s: env %q in container %q is a literal credential; use a Secret", [name, e.name, c.name])
}

deny contains msg if {
	input.kind == "Namespace"
	input.metadata.labels["pod-security.kubernetes.io/enforce"] != "restricted"
	msg := sprintf("Namespace/%s: must enforce the restricted Pod Security Standard", [input.metadata.name])
}

deny contains msg if {
	input.kind == "Ingress"
	not input.spec.tls
	msg := sprintf("Ingress/%s: TLS is required", [input.metadata.name])
}

deny contains msg if {
	input.kind == "Service"
	input.spec.type in {"NodePort", "LoadBalancer"}
	msg := sprintf("Service/%s: expose through the Ingress, not a %s Service", [input.metadata.name, input.spec.type])
}

deny contains msg if {
	input.kind == "Secret"
	msg := sprintf("Secret/%s: Secrets must not be committed; create them out of band", [input.metadata.name])
}
