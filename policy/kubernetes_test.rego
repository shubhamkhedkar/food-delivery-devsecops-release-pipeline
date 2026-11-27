package kubernetes_test

import data.kubernetes

good := {
	"kind": "Deployment",
	"metadata": {"name": "web"},
	"spec": {"template": {"spec": {
		"automountServiceAccountToken": false,
		"securityContext": {"runAsNonRoot": true},
		"containers": [{
			"name": "web",
			"image": "registry.example.com/web:1.0.0",
			"securityContext": {"readOnlyRootFilesystem": true, "allowPrivilegeEscalation": false, "capabilities": {"drop": ["ALL"]}},
			"resources": {"requests": {"cpu": "10m", "memory": "32Mi"}, "limits": {"memory": "64Mi"}},
			"readinessProbe": {"httpGet": {"path": "/", "port": 8080}},
			"livenessProbe": {"httpGet": {"path": "/", "port": 8080}},
			"env": [{"name": "ORDER_SIGNING_KEY_FILE", "value": "/var/run/secrets/platewise/signing-key"}],
		}],
	}}},
}

test_hardened_deployment_passes if {
	count(kubernetes.deny) == 0 with input as good
}

test_root_and_writable_fs_denied if {
	bad := json.patch(good, [
		{"op": "replace", "path": "/spec/template/spec/securityContext/runAsNonRoot", "value": false},
		{"op": "replace", "path": "/spec/template/spec/containers/0/securityContext/readOnlyRootFilesystem", "value": false},
	])
	count(kubernetes.deny) == 2 with input as bad
}

test_latest_tag_denied if {
	bad := json.patch(good, [{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value": "web:latest"}])
	some msg in kubernetes.deny with input as bad
	contains(msg, ":latest")
}

test_untagged_image_denied if {
	bad := json.patch(good, [{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value": "web"}])
	some msg in kubernetes.deny with input as bad
	contains(msg, "no tag or digest")
}

test_literal_credential_denied if {
	bad := json.patch(good, [{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "PAYMENT_API_KEY", "value": "abc"}}])
	some msg in kubernetes.deny with input as bad
	contains(msg, "literal credential")
}

test_missing_probe_and_limits_denied if {
	bad := json.patch(good, [
		{"op": "remove", "path": "/spec/template/spec/containers/0/readinessProbe"},
		{"op": "remove", "path": "/spec/template/spec/containers/0/resources/limits"},
	])
	count(kubernetes.deny) == 2 with input as bad
}

test_host_namespaces_and_hostpath_denied if {
	bad := json.patch(good, [
		{"op": "add", "path": "/spec/template/spec/hostNetwork", "value": true},
		{"op": "add", "path": "/spec/template/spec/volumes", "value": [{"name": "root", "hostPath": {"path": "/"}}]},
	])
	count(kubernetes.deny) == 2 with input as bad
}

test_capabilities_and_escalation_denied if {
	bad := json.patch(good, [{"op": "replace", "path": "/spec/template/spec/containers/0/securityContext", "value": {"readOnlyRootFilesystem": true}}])
	count(kubernetes.deny) == 2 with input as bad
}

test_ingress_without_tls_denied if {
	some msg in kubernetes.deny with input as {"kind": "Ingress", "metadata": {"name": "x"}, "spec": {}}
	contains(msg, "TLS")
}

test_secret_and_nodeport_denied if {
	count(kubernetes.deny) == 1 with input as {"kind": "Secret", "metadata": {"name": "s"}}
	count(kubernetes.deny) == 1 with input as {"kind": "Service", "metadata": {"name": "s"}, "spec": {"type": "NodePort"}}
}

test_namespace_must_be_restricted if {
	count(kubernetes.deny) == 1 with input as {"kind": "Namespace", "metadata": {"name": "n", "labels": {"pod-security.kubernetes.io/enforce": "baseline"}}}
}

test_token_automount_must_be_disabled if {
	bad := json.patch(good, [{"op": "remove", "path": "/spec/template/spec/automountServiceAccountToken"}])
	some msg in kubernetes.deny with input as bad
	contains(msg, "automountServiceAccountToken")
}
