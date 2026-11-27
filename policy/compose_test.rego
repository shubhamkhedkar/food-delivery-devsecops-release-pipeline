package compose_test

import data.compose

hardened := {"read_only": true, "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"]}

test_hardened_stack_passes if {
	svc := object.union(hardened, {"image": "prom/prometheus:v3@sha256:abc", "ports": ["127.0.0.1:9090:9090"]})
	count(compose.deny) == 0 with input as {"services": {"prometheus": svc, "app": object.union(hardened, {"build": "."})}}
}

test_public_port_and_unpinned_image_denied if {
	svc := object.union(hardened, {"image": "grafana/grafana:latest", "ports": ["3000:3000"]})
	count(compose.deny) == 2 with input as {"services": {"grafana": svc}}
}

test_unhardened_privileged_service_denied if {
	count(compose.deny) == 4 with input as {"services": {"x": {"build": ".", "privileged": true}}}
}
