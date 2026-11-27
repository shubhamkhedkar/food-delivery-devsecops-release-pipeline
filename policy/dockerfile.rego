# Dockerfile guardrails. conftest hands the policy a flat list of parsed instructions
# ({Cmd, Value, Stage, ...}), one entry per line of the Dockerfile.
package dockerfile

instructions := input

froms := [i | some i in instructions; i.Cmd == "from"]

deny contains msg if {
	some f in froms
	image := f.Value[0]
	not contains(image, "@sha256:")
	not f.Value[0] in stage_names
	msg := sprintf("FROM %s: base images must be pinned by digest", [image])
}

stage_names contains lower(f.Value[2]) if {
	some f in froms
	count(f.Value) == 3
}

deny contains msg if {
	users := [i | some i in instructions; i.Cmd == "user"]
	count(users) == 0
	msg := "the final image must set a non-root USER"
}

deny contains msg if {
	users := [i | some i in instructions; i.Cmd == "user"]
	last := users[count(users) - 1]
	regex.match(`^(root|0)(:|$)`, last.Value[0])
	msg := "the final USER must not be root"
}

deny contains msg if {
	some i in instructions
	i.Cmd == "add"
	regex.match(`^https?://`, i.Value[0])
	msg := sprintf("ADD %s: download with a verified checksum instead of ADD <url>", [i.Value[0]])
}

deny contains msg if {
	some i in instructions
	i.Cmd in {"env", "arg"}
	some v in i.Value
	regex.match(`(?i)(api_?key|token|password|secret)`, v)
	msg := sprintf("%s %s: never bake credentials into the image", [upper(i.Cmd), v])
}

deny contains msg if {
	not any_healthcheck
	msg := "add a HEALTHCHECK"
}

any_healthcheck if {
	some i in instructions
	i.Cmd == "healthcheck"
}
