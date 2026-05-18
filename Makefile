SHELL := bash

.DEFAULT_GOAL := help

AWS_REGION ?= $(shell aws configure get region)
AWS_ACCOUNT_ID ?= $(shell aws sts get-caller-identity --query Account --output text)

GATEWAY_VERSION ?= $(shell tr -d '\n' < VERSION)
GATEWAY_CAPACITY_PROVIDER_ARN ?=
CFN_GATEWAY_CAPACITY_PROVIDER_ARN := $(subst :capacity-provider/,:capacity-provider:,$(GATEWAY_CAPACITY_PROVIDER_ARN))
BENCHMARK_HANDLER_MEMORY_SIZE ?= 256
EXAMPLE_TEMPLATE ?= adapter-node
EXAMPLE_TEMPLATE_DIR := examples/sam/templates/$(EXAMPLE_TEMPLATE)

SAM_DEPLOY_FLAGS ?= --resolve-s3 --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset

BOOTSTRAP_STACK_NAME ?= khone-bootstrap
BOOTSTRAP_TEMPLATE ?= bootstrap/template.yaml
BOOTSTRAP_BUCKET ?=

.PHONY: help
help:
	@printf '%s\n' \
		'Targets:' \
		'  make deploy               Deploy bootstrap + deploy examples stack' \
		'  make deploy-benchmark     Deploy bootstrap + deploy benchmark stack' \
		'  make bootstrap-build      sam build in bootstrap (builds shared layer artifacts)' \
		'  make bootstrap-deploy     Deploy the bootstrap stack (macro + shared config bucket)' \
		'  make examples-sam-build   sam build for EXAMPLE_TEMPLATE (default: adapter-node)' \
		'  make examples-sam-deploy  sam deploy for EXAMPLE_TEMPLATE (default: adapter-node)' \
		'  make benchmark-sam-build  sam build in benchmark/sam' \
		'  make benchmark-sam-deploy sam deploy for benchmark/sam' \
		'  make print-vars           Show computed variables' \
			'' \
			'Common overrides:' \
			'  make deploy BOOTSTRAP_BUCKET=my-existing-bucket' \
			'  make deploy GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...' \
			'  make examples-sam-deploy EXAMPLE_TEMPLATE=layer-proxy-python GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...' \
			'  make benchmark-sam-deploy BENCHMARK_HANDLER_MEMORY_SIZE=512 GATEWAY_CAPACITY_PROVIDER_ARN=arn:aws:lambda:...'

.PHONY: check
check:
	@if [[ -z "$(AWS_REGION)" ]]; then echo "AWS_REGION is empty (set AWS_REGION or configure a default region)"; exit 1; fi
	@if [[ -z "$(AWS_ACCOUNT_ID)" ]]; then echo "Failed to resolve AWS_ACCOUNT_ID (check AWS credentials)"; exit 1; fi

.PHONY: check-capacity-provider
check-capacity-provider:
	@if [[ -z "$(GATEWAY_CAPACITY_PROVIDER_ARN)" ]]; then echo "GATEWAY_CAPACITY_PROVIDER_ARN is required for LMI gateway deploys"; exit 1; fi

.PHONY: print-vars
print-vars: check
	@printf '%s\n' \
		"AWS_REGION=$(AWS_REGION)" \
		"AWS_ACCOUNT_ID=$(AWS_ACCOUNT_ID)" \
			"GATEWAY_VERSION=$(GATEWAY_VERSION)" \
			"GATEWAY_CAPACITY_PROVIDER_ARN=$(GATEWAY_CAPACITY_PROVIDER_ARN)" \
			"CFN_GATEWAY_CAPACITY_PROVIDER_ARN=$(CFN_GATEWAY_CAPACITY_PROVIDER_ARN)" \
			"BENCHMARK_HANDLER_MEMORY_SIZE=$(BENCHMARK_HANDLER_MEMORY_SIZE)" \
			"EXAMPLE_TEMPLATE=$(EXAMPLE_TEMPLATE)" \
			"EXAMPLE_TEMPLATE_DIR=$(EXAMPLE_TEMPLATE_DIR)" \
			"BOOTSTRAP_STACK_NAME=$(BOOTSTRAP_STACK_NAME)" \
			"BOOTSTRAP_TEMPLATE=$(BOOTSTRAP_TEMPLATE)" \
			"BOOTSTRAP_BUCKET=$(BOOTSTRAP_BUCKET)"

.PHONY: check-example-template
check-example-template:
	@if [[ ! -f "$(EXAMPLE_TEMPLATE_DIR)/template.yaml" ]]; then \
		echo "Unknown EXAMPLE_TEMPLATE=$(EXAMPLE_TEMPLATE). Expected one of:"; \
		find examples/sam/templates -mindepth 1 -maxdepth 1 -type d -print | sed 's#examples/sam/templates/#  #'; \
		exit 1; \
	fi

.PHONY: examples-sam-build
examples-sam-build: check-example-template
	cd "$(EXAMPLE_TEMPLATE_DIR)" && SAM_CLI_BETA_RUST_CARGO_LAMBDA=1 sam build

.PHONY: examples-sam-deploy
examples-sam-deploy: check check-capacity-provider examples-sam-build
	@set -euo pipefail; \
	deploy_params=(GatewayCapacityProviderArn="$(CFN_GATEWAY_CAPACITY_PROVIDER_ARN)"); \
	if grep -q '^  KhoneLayerArm64Arn:' "$(EXAMPLE_TEMPLATE_DIR)/template.yaml"; then \
		layer_arn="$$(aws cloudformation list-exports --region "$(AWS_REGION)" --query "Exports[?Name=='KhoneLayerArm64Arn'].Value | [0]" --output text)"; \
		if [[ -z "$$layer_arn" || "$$layer_arn" == "None" ]]; then \
			echo "Failed to resolve KhoneLayerArm64Arn export. Run make bootstrap-deploy first."; \
			exit 1; \
		fi; \
		deploy_params+=(KhoneLayerArm64Arn=$$layer_arn); \
	fi; \
	cd "$(EXAMPLE_TEMPLATE_DIR)" && sam deploy --parameter-overrides "$${deploy_params[@]}"

.PHONY: benchmark-sam-build
benchmark-sam-build:
	cd benchmark/sam && SAM_CLI_BETA_RUST_CARGO_LAMBDA=1 sam build

.PHONY: benchmark-sam-deploy
benchmark-sam-deploy: check check-capacity-provider benchmark-sam-build
	@set -euo pipefail; \
	layer_arn="$$(aws cloudformation list-exports --region "$(AWS_REGION)" --query "Exports[?Name=='KhoneLayerArm64Arn'].Value | [0]" --output text)"; \
	if [[ -z "$$layer_arn" || "$$layer_arn" == "None" ]]; then \
		echo "Failed to resolve KhoneLayerArm64Arn export. Run make bootstrap-deploy first."; \
		exit 1; \
		fi; \
		cd benchmark/sam && sam deploy --parameter-overrides \
			KhoneLayerArm64Arn=$$layer_arn \
			GatewayCapacityProviderArn="$(CFN_GATEWAY_CAPACITY_PROVIDER_ARN)" \
			BenchmarkHandlerMemorySize="$(BENCHMARK_HANDLER_MEMORY_SIZE)"

.PHONY: bootstrap-build
bootstrap-build:
	cd bootstrap && sam build --template template.yaml

.PHONY: bootstrap-deploy
bootstrap-deploy: check bootstrap-build
	@set -euo pipefail; \
	export AWS_REGION="$(AWS_REGION)" AWS_DEFAULT_REGION="$(AWS_REGION)"; \
		params=(); \
		if [[ -n "$(BOOTSTRAP_BUCKET)" ]]; then params+=("UseExistingBucket=$(BOOTSTRAP_BUCKET)"); fi; \
		deploy_args=( \
			--stack-name "$(BOOTSTRAP_STACK_NAME)" \
			--template-file bootstrap/.aws-sam/build/template.yaml \
			$(SAM_DEPLOY_FLAGS) \
		); \
		if (( $${#params[@]} > 0 )); then deploy_args+=(--parameter-overrides "$${params[@]}"); fi; \
		sam deploy "$${deploy_args[@]}"

.PHONY: deploy
deploy: check
	@set -euo pipefail; \
	$(MAKE) bootstrap-deploy; \
	$(MAKE) examples-sam-deploy

.PHONY: deploy-benchmark
deploy-benchmark: check
	@set -euo pipefail; \
	$(MAKE) bootstrap-deploy; \
	$(MAKE) benchmark-sam-deploy
