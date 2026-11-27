# Local demo stack guardrails: loopback-only ports, hardened containers, pinned images.
package compose

services := input.services

deny contains msg if {
	some name, svc in services
	some p in svc.ports
	not startswith(sprintf("%v", [p]), "127.0.0.1:")
	msg := sprintf("service %s: publish ports on 127.0.0.1 only (got %v)", [name, p])
}

deny contains msg if {
	some name, svc in services
	not svc.read_only
	msg := sprintf("service %s: read_only must be true", [name])
}

deny contains msg if {
	some name, svc in services
	not "ALL" in object.get(svc, "cap_drop", [])
	msg := sprintf("service %s: cap_drop must include ALL", [name])
}

deny contains msg if {
	some name, svc in services
	not "no-new-privileges:true" in object.get(svc, "security_opt", [])
	msg := sprintf("service %s: security_opt must include no-new-privileges:true", [name])
}

deny contains msg if {
	some name, svc in services
	not svc.build
	not contains(svc.image, "@sha256:")
	msg := sprintf("service %s: third-party image %s must be pinned by digest", [name, svc.image])
}

deny contains msg if {
	some name, svc in services
	svc.privileged == true
	msg := sprintf("service %s: privileged is not allowed", [name])
}
