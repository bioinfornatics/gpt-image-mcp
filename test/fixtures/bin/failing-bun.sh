#!/usr/bin/env bash
# Test fixture: stands in for `bun` and always fails with a distinctive exit
# code so shell tests can assert that quality-gate.sh propagates it truthfully.
exit 17
