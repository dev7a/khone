import copy
import json
import logging
import os
import re
from typing import Any, Mapping, MutableMapping


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

KHONE_GATEWAY_RESOURCE_TYPE = "Khone::Gateway::Service"
EXPORT_CONFIG_BUCKET_NAME = "KhoneConfigBucketName"
EXPORT_CONFIG_PUBLISHER_SERVICE_TOKEN = "KhoneConfigPublisherServiceToken"

GATEWAY_CODE_BUCKET_ENV_VAR = "KHONE_GATEWAY_CODE_S3_BUCKET"
GATEWAY_CODE_KEY_ENV_VAR = "KHONE_GATEWAY_CODE_S3_KEY"
GATEWAY_CODE_OBJECT_VERSION_ENV_VAR = "KHONE_GATEWAY_CODE_S3_OBJECT_VERSION"

KHONE_CONFIG_URI_ENV_VAR = "KHONE_CONFIG_URI"

ALLOWED_PROPERTIES = {
    "CapacityProviderArn",
    "ConfigPrefix",
    "Description",
    "Environment",
    "ExecutionEnvironmentMemoryGiBPerVCpu",
    "FunctionName",
    "FunctionUrlAuthType",
    "GatewayConfig",
    "LogRetentionInDays",
    "LoggingConfig",
    "MaxExecutionEnvironments",
    "MemorySize",
    "MinExecutionEnvironments",
    "PerExecutionEnvironmentMaxConcurrency",
    "Spec",
    "Timeout",
    "TracingConfig",
}
REMOVED_APP_RUNNER_PROPERTIES = {
    "AutoDeploymentsEnabled",
    "AutoScalingConfiguration",
    "AutoScalingConfigurationArn",
    "EmfMetrics",
    "EnvironmentSecrets",
    "ImageIdentifier",
    "InstanceConfiguration",
    "InstanceRoleArn",
    "ObservabilityConfiguration",
    "ObservabilityConfigurationArn",
    "Port",
    "ServiceName",
}
REMOVED_APP_RUNNER_PROPERTY_PREFIXES = (
    "AutoScalingConfiguration",
    "ObservabilityConfiguration",
)
PRESERVED_TOP_LEVEL_ATTRIBUTES = {
    "Condition",
    "DeletionPolicy",
    "DependsOn",
    "Metadata",
    "UpdateReplacePolicy",
}
GENERATED_RESOURCE_TOP_LEVEL_ATTRIBUTES = PRESERVED_TOP_LEVEL_ATTRIBUTES
LAMBDA_FUNCTION_ARN_RE = re.compile(
    r"^arn:[A-Za-z0-9-]+:lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9-_]+(?::[A-Za-z0-9-_$]+)?$"
)


def _default_prefix_for(logical_id: str) -> Any:
    # Macro transforms can't receive parameters through the Transform section, so use a deterministic
    # per-stack/per-resource prefix unless the resource provides ConfigPrefix.
    return {"Fn::Sub": f"khone/${{AWS::StackName}}/{logical_id}/"}


def _import_value(name: str) -> dict[str, Any]:
    return {"Fn::ImportValue": name}


def _get_att(logical_id: str, attr: str) -> dict[str, Any]:
    return {"Fn::GetAtt": [logical_id, attr]}


def _sub(template: str, variables: dict[str, Any] | None = None) -> Any:
    if variables is None:
        return {"Fn::Sub": template}
    return {"Fn::Sub": [template, variables]}


def _ref(logical_id: str) -> dict[str, str]:
    return {"Ref": logical_id}


def _read_required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"Macro is missing environment variable {name}.")
    return value


def _reject_unsupported_properties(logical_id: str, props: Mapping[str, Any]) -> None:
    unsupported = sorted(set(props.keys()) - ALLOWED_PROPERTIES)
    if not unsupported:
        return

    removed = [
        name
        for name in unsupported
        if name in REMOVED_APP_RUNNER_PROPERTIES
        or name.startswith(REMOVED_APP_RUNNER_PROPERTY_PREFIXES)
    ]
    if removed:
        joined = ", ".join(removed)
        raise ValueError(
            f"{logical_id}.Properties contains App Runner-era properties that are no longer "
            f"supported by {KHONE_GATEWAY_RESOURCE_TYPE}: {joined}. Use the Lambda/LMI gateway "
            "properties on Khone::Gateway::Service instead."
        )

    joined = ", ".join(unsupported)
    allowed = ", ".join(sorted(ALLOWED_PROPERTIES))
    raise ValueError(
        f"{logical_id}.Properties contains unsupported keys: {joined}. Supported keys: {allowed}."
    )


def _copy_preserved_top_level_attributes(original: Mapping[str, Any]) -> dict[str, Any]:
    return {k: copy.deepcopy(v) for k, v in original.items() if k in PRESERVED_TOP_LEVEL_ATTRIBUTES}


def _copy_generated_top_level_attributes(original: Mapping[str, Any]) -> dict[str, Any]:
    return {k: copy.deepcopy(v) for k, v in original.items() if k in GENERATED_RESOURCE_TOP_LEVEL_ATTRIBUTES}


def _generated_resource(original: Mapping[str, Any], resource: dict[str, Any]) -> dict[str, Any]:
    out = _copy_generated_top_level_attributes(original)
    out.update(resource)
    return out


def _ensure_no_collision(resources: Mapping[str, Any], logical_id: str) -> None:
    if logical_id in resources:
        raise ValueError(f"Macro expansion would overwrite an existing resource '{logical_id}'.")


def _validate_object_prop(
    *,
    logical_id: str,
    props: Mapping[str, Any],
    name: str,
    required: bool = False,
) -> dict[str, Any] | None:
    value = props.get(name)
    if value is None:
        if required:
            raise ValueError(f"{logical_id}.Properties.{name} is required and must be an object.")
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{logical_id}.Properties.{name} must be an object.")
    return value


def _validate_string_or_intrinsic(
    *,
    logical_id: str,
    props: Mapping[str, Any],
    name: str,
    required: bool = False,
    default: Any = None,
) -> Any:
    value = props.get(name, default)
    if value is None:
        if required:
            raise ValueError(
                f"{logical_id}.Properties.{name} is required and must be a string or intrinsic function object."
            )
        return None
    if not isinstance(value, (str, dict)):
        raise ValueError(
            f"{logical_id}.Properties.{name} must be a string or intrinsic function object."
        )
    if isinstance(value, str) and required and not value:
        raise ValueError(f"{logical_id}.Properties.{name} must not be empty.")
    return value


def _validate_int_or_intrinsic(
    *,
    logical_id: str,
    props: Mapping[str, Any],
    name: str,
    default: int | None = None,
    minimum: int | None = None,
) -> Any:
    value = props.get(name, default)
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{logical_id}.Properties.{name} must be an integer or intrinsic function object.")
    if minimum is not None and value < minimum:
        raise ValueError(f"{logical_id}.Properties.{name} must be >= {minimum}.")
    return value


def _validate_number_or_intrinsic(
    *,
    logical_id: str,
    props: Mapping[str, Any],
    name: str,
    default: int | float | None = None,
    minimum: int | float | None = None,
) -> Any:
    value = props.get(name, default)
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{logical_id}.Properties.{name} must be a number or intrinsic function object.")
    if minimum is not None and value < minimum:
        raise ValueError(f"{logical_id}.Properties.{name} must be >= {minimum}.")
    return value


def _validate_environment(logical_id: str, props: Mapping[str, Any]) -> dict[str, Any]:
    env = props.get("Environment") or {}
    if not isinstance(env, dict):
        raise ValueError(f"{logical_id}.Properties.Environment must be an object.")
    out: dict[str, Any] = {}
    for key, value in env.items():
        if not isinstance(key, str) or not key:
            raise ValueError("Environment keys must be non-empty strings.")
        if key == KHONE_CONFIG_URI_ENV_VAR:
            raise ValueError(f"{logical_id}.Properties.Environment cannot define {KHONE_CONFIG_URI_ENV_VAR}.")
        if not isinstance(value, (str, dict)):
            raise ValueError(f"{logical_id}.Properties.Environment.{key} must be a string or intrinsic function object.")
        out[key] = value
    return out


def _is_positive_integer_literal(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value > 0
    if isinstance(value, str):
        stripped = value.strip()
        return stripped.isdigit() and int(stripped) > 0
    return False


def _is_lambda_function_arn(value: str) -> bool:
    return bool(LAMBDA_FUNCTION_ARN_RE.fullmatch(value))


def _collect_target_lambda_arns(spec: Mapping[str, Any]) -> list[Any]:
    paths = spec.get("paths") or {}
    if not isinstance(paths, dict):
        raise ValueError("Spec.paths must be an object.")

    found: list[Any] = []
    for path_name, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method_name, op in path_item.items():
            if not isinstance(op, dict):
                continue
            operation_path = f"Spec.paths[{path_name!r}].{method_name}"

            x_khone = op.get("x-khone")
            if x_khone is not None:
                if not isinstance(x_khone, dict):
                    raise ValueError(f"{operation_path}.x-khone must be an object.")
                for field in ("maxWaitMs", "maxBatchSize"):
                    if field not in x_khone:
                        continue
                    field_value = x_khone[field]
                    if isinstance(field_value, dict):
                        continue
                    if not _is_positive_integer_literal(field_value):
                        raise ValueError(
                            f"{operation_path}.x-khone.{field} must be a positive integer, positive integer string, "
                            "or intrinsic function object."
                        )

            if "x-target-lambda" not in op:
                continue
            target = op["x-target-lambda"]
            if not isinstance(target, (str, dict)):
                raise ValueError(
                    f"{operation_path}.x-target-lambda must be a string or an intrinsic function object."
                )
            if isinstance(target, str) and not _is_lambda_function_arn(target):
                raise ValueError(
                    f"{operation_path}.x-target-lambda must be a Lambda function ARN (got: {target!r})."
                )
            found.append(target)

    out: list[Any] = []
    seen: set[str] = set()
    for value in found:
        key = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def _gateway_code() -> dict[str, Any]:
    code: dict[str, Any] = {
        "S3Bucket": _read_required_env(GATEWAY_CODE_BUCKET_ENV_VAR),
        "S3Key": _read_required_env(GATEWAY_CODE_KEY_ENV_VAR),
    }
    object_version = os.environ.get(GATEWAY_CODE_OBJECT_VERSION_ENV_VAR, "").strip()
    if object_version:
        code["S3ObjectVersion"] = object_version
    return code


def _gateway_log_group_arn(logical_id: str, function_name: Any, suffix: str = "") -> Any:
    if function_name is None:
        return _sub(
            f"arn:${{AWS::Partition}}:logs:${{AWS::Region}}:${{AWS::AccountId}}:"
            f"log-group:/aws/lambda/${{AWS::StackName}}-{logical_id}-*{suffix}"
        )
    return _sub(
        f"arn:${{AWS::Partition}}:logs:${{AWS::Region}}:${{AWS::AccountId}}:"
        f"log-group:/aws/lambda/${{FunctionName}}{suffix}",
        {"FunctionName": function_name},
    )


def _expand_gateway_service(
    *,
    resources: MutableMapping[str, Any],
    logical_id: str,
    original: Mapping[str, Any],
) -> None:
    props = original.get("Properties") or {}
    if not isinstance(props, dict):
        raise ValueError(f"{logical_id}.Properties must be an object.")

    _reject_unsupported_properties(logical_id, props)

    capacity_provider_arn = _validate_string_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="CapacityProviderArn",
        required=True,
    )
    gateway_config = _validate_object_prop(
        logical_id=logical_id,
        props=props,
        name="GatewayConfig",
        required=True,
    )
    spec = _validate_object_prop(logical_id=logical_id, props=props, name="Spec", required=True)
    assert gateway_config is not None
    assert spec is not None

    config_prefix = _validate_string_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="ConfigPrefix",
        default=_default_prefix_for(logical_id),
    )
    function_name = _validate_string_or_intrinsic(logical_id=logical_id, props=props, name="FunctionName")
    description = _validate_string_or_intrinsic(logical_id=logical_id, props=props, name="Description")
    memory_size = _validate_int_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="MemorySize",
        default=2048,
        minimum=128,
    )
    timeout = _validate_int_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="Timeout",
        default=30,
        minimum=1,
    )
    execution_environment_memory = _validate_number_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="ExecutionEnvironmentMemoryGiBPerVCpu",
        default=2.0,
        minimum=2,
    )
    per_environment_concurrency = _validate_int_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="PerExecutionEnvironmentMaxConcurrency",
        default=64,
        minimum=1,
    )
    min_execution_environments = _validate_int_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="MinExecutionEnvironments",
        default=1,
        minimum=0,
    )
    max_execution_environments = _validate_int_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="MaxExecutionEnvironments",
        default=4,
        minimum=0,
    )
    log_retention = _validate_int_or_intrinsic(
        logical_id=logical_id,
        props=props,
        name="LogRetentionInDays",
        minimum=1,
    )
    tracing_config = _validate_object_prop(logical_id=logical_id, props=props, name="TracingConfig")
    logging_config = _validate_object_prop(logical_id=logical_id, props=props, name="LoggingConfig")
    environment = _validate_environment(logical_id, props)

    function_url_auth_type = props.get("FunctionUrlAuthType", "NONE")
    if function_url_auth_type not in ("NONE", "AWS_IAM"):
        raise ValueError(
            f"{logical_id}.Properties.FunctionUrlAuthType must be NONE or AWS_IAM."
        )

    target_lambda_arns = _collect_target_lambda_arns(spec)

    config_publisher_id = f"{logical_id}KhoneConfigPublisher"
    execution_role_id = f"{logical_id}KhoneExecutionRole"
    function_url_id = f"{logical_id}KhoneFunctionUrl"
    function_url_permission_id = f"{logical_id}KhoneFunctionUrlPermission"
    log_group_id = f"{logical_id}KhoneLogGroup"

    generated_ids = [config_publisher_id, execution_role_id, function_url_id]
    if function_url_auth_type == "NONE":
        generated_ids.append(function_url_permission_id)
    if log_retention is not None:
        generated_ids.append(log_group_id)
    for generated_id in generated_ids:
        _ensure_no_collision(resources, generated_id)

    resources[config_publisher_id] = _generated_resource(
        original,
        {
            "Type": "Custom::KhoneConfigPublisher",
            "Properties": {
                "ServiceToken": _import_value(EXPORT_CONFIG_PUBLISHER_SERVICE_TOKEN),
                "Prefix": config_prefix,
                "GatewayConfig": gateway_config,
                "Spec": spec,
            },
        },
    )

    config_object_arn = _sub(
        "arn:${AWS::Partition}:s3:::${Bucket}/${Prefix}*",
        {"Bucket": _import_value(EXPORT_CONFIG_BUCKET_NAME), "Prefix": config_prefix},
    )
    log_group_arn = _gateway_log_group_arn(logical_id, function_name)
    log_stream_arn = _gateway_log_group_arn(logical_id, function_name, ":*")
    policy_statements: list[dict[str, Any]] = [
        {
            "Sid": "CreateLogGroup",
            "Effect": "Allow",
            "Action": ["logs:CreateLogGroup"],
            "Resource": log_group_arn,
        },
        {
            "Sid": "WriteLogs",
            "Effect": "Allow",
            "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
            "Resource": log_stream_arn,
        },
        {
            "Sid": "ReadGatewayConfig",
            "Effect": "Allow",
            "Action": ["s3:GetObject"],
            "Resource": [config_object_arn],
        },
    ]
    if target_lambda_arns:
        policy_statements.append(
            {
                "Sid": "InvokeTargetLambdas",
                "Effect": "Allow",
                "Action": ["lambda:InvokeFunction", "lambda:InvokeWithResponseStream"],
                "Resource": target_lambda_arns,
            }
        )

    resources[execution_role_id] = _generated_resource(
        original,
        {
            "Type": "AWS::IAM::Role",
            "Properties": {
                "AssumeRolePolicyDocument": {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"Service": "lambda.amazonaws.com"},
                            "Action": "sts:AssumeRole",
                        }
                    ],
                },
                "Policies": [
                    {
                        "PolicyName": "KhoneGatewayExecutionPolicy",
                        "PolicyDocument": {
                            "Version": "2012-10-17",
                            "Statement": policy_statements,
                        },
                    }
                ],
            },
        },
    )

    if log_retention is not None:
        resources[log_group_id] = _generated_resource(
            original,
            {
                "Type": "AWS::Logs::LogGroup",
                "Properties": {
                    "LogGroupName": _sub("/aws/lambda/${FunctionName}", {"FunctionName": _ref(logical_id)}),
                    "RetentionInDays": log_retention,
                },
            },
        )

    runtime_env = {"RUST_LOG": "info", **environment}
    runtime_env[KHONE_CONFIG_URI_ENV_VAR] = _get_att(config_publisher_id, "ConfigS3Uri")

    lambda_props: dict[str, Any] = {
        "Architectures": ["arm64"],
        "Code": _gateway_code(),
        "Handler": "bootstrap",
        "Role": _get_att(execution_role_id, "Arn"),
        "Runtime": "provided.al2023",
        "PackageType": "Zip",
        "MemorySize": memory_size,
        "Timeout": timeout,
        "CapacityProviderConfig": {
            "LambdaManagedInstancesCapacityProviderConfig": {
                "CapacityProviderArn": capacity_provider_arn,
                "ExecutionEnvironmentMemoryGiBPerVCpu": execution_environment_memory,
                "PerExecutionEnvironmentMaxConcurrency": per_environment_concurrency,
            }
        },
        "FunctionScalingConfig": {
            "MinExecutionEnvironments": min_execution_environments,
            "MaxExecutionEnvironments": max_execution_environments,
        },
        "Environment": {"Variables": runtime_env},
    }
    if function_name is not None:
        lambda_props["FunctionName"] = function_name
    if description is not None:
        lambda_props["Description"] = description
    if tracing_config is not None:
        lambda_props["TracingConfig"] = tracing_config
    if logging_config is not None:
        lambda_props["LoggingConfig"] = logging_config

    transformed = _copy_preserved_top_level_attributes(original)
    transformed.update({"Type": "AWS::Lambda::Function", "Properties": lambda_props})
    resources[logical_id] = transformed

    resources[function_url_id] = _generated_resource(
        original,
        {
            "Type": "AWS::Lambda::Url",
            "Properties": {
                "AuthType": function_url_auth_type,
                "InvokeMode": "RESPONSE_STREAM",
                "TargetFunctionArn": _get_att(logical_id, "Arn"),
            },
        },
    )

    if function_url_auth_type == "NONE":
        resources[function_url_permission_id] = _generated_resource(
            original,
            {
                "Type": "AWS::Lambda::Permission",
                "Properties": {
                    "Action": "lambda:InvokeFunctionUrl",
                    "FunctionName": _ref(logical_id),
                    "FunctionUrlAuthType": "NONE",
                    "Principal": "*",
                },
            },
        )


def handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    request_id = event.get("requestId")
    fragment = event.get("fragment")

    if not isinstance(fragment, dict):
        return {
            "requestId": request_id,
            "status": "failed",
            "errorMessage": "Macro event fragment must be an object.",
        }

    try:
        out = copy.deepcopy(fragment)
        resources = out.setdefault("Resources", {})
        if not isinstance(resources, dict):
            raise ValueError("Template fragment Resources must be an object.")

        for logical_id, resource in list(resources.items()):
            if not isinstance(resource, dict):
                continue
            if resource.get("Type") != KHONE_GATEWAY_RESOURCE_TYPE:
                continue
            logger.info("Expanding %s %s to Lambda gateway resources", KHONE_GATEWAY_RESOURCE_TYPE, logical_id)
            _expand_gateway_service(resources=resources, logical_id=logical_id, original=resource)

        return {"requestId": request_id, "status": "success", "fragment": out}
    except Exception as exc:
        logger.exception("Macro expansion failed")
        return {"requestId": request_id, "status": "failed", "errorMessage": str(exc)}
