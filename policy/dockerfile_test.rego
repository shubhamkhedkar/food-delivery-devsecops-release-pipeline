package dockerfile_test

import data.dockerfile

i(cmd, value) := {"Cmd": cmd, "Value": value}

good := [
	i("from", ["node:24@sha256:abc", "AS", "build"]),
	i("from", ["build"]),
	i("env", ["PORT", "8080"]),
	i("user", ["65532:65532"]),
	i("healthcheck", ["CMD", "true"]),
]

test_pinned_nonroot_passes if {
	count(dockerfile.deny) == 0 with input as good
}

test_unpinned_base_denied if {
	count(dockerfile.deny) == 1 with input as [i("from", ["node:24"]), i("user", ["app"]), i("healthcheck", ["CMD", "true"])]
}

test_root_user_and_missing_healthcheck_denied if {
	count(dockerfile.deny) == 2 with input as [i("from", ["node@sha256:abc"]), i("user", ["root"])]
}

test_no_user_denied if {
	some msg in dockerfile.deny with input as [i("from", ["node@sha256:abc"]), i("healthcheck", ["CMD", "true"])]
	contains(msg, "non-root USER")
}

test_add_url_and_baked_secret_denied if {
	bad := [
		i("from", ["node@sha256:abc"]),
		i("add", ["https://example.com/tool.tgz", "/tmp/"]),
		i("env", ["PAYMENT_API_KEY", "x"]),
		i("user", ["1000"]),
		i("healthcheck", ["CMD", "true"]),
	]
	count(dockerfile.deny) == 2 with input as bad
}
