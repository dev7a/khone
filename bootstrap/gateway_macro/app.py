import copy
import logging
from typing import Any, Mapping, MutableMapping


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

KHONE_GATEWAY_RESOURCE_TYPE = "Khone::Gateway::Service"
EXPORT_CONFIG_PUBLISHER_SERVICE_TOKEN = "KhoneConfigPublisherServiceToken"

ALLOWED_PROPERTIES = {"ConfigPrefix", "GatewayConfig", "Spec"}
REMOVED_APP_RUNNER_PROPERTIES = {
    "AutoDeploymentsEnabled",
    "AutoScalingConfiguration",
    "AutoScalingConfigurationArn",
    "EmfMetrics",
    "Environment",
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


def _default_prefix_for(logical_id: str) -> Any:
    # Macro transforms can't receive parameters through the Transform section, so use a deterministic
    # per-stack/per-resource prefix unless the resource provides ConfigPrefix.
    return {"Fn::Sub": f"khone/${{AWS::StackName}}/{logical_id}/"}


def _import_value(name: str) -> dict[str, Any]:
    return {"Fn::ImportValue": name}


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
            f"supported by {KHONE_GATEWAY_RESOURCE_TYPE}: {joined}. Define the gateway as an "
            "AWS::Serverless::Function and set KHONE_CONFIG_URI from this resource's ConfigS3Uri."
        )

    joined = ", ".join(unsupported)
    allowed = ", ".join(sorted(ALLOWED_PROPERTIES))
    raise ValueError(
        f"{logical_id}.Properties contains unsupported keys: {joined}. Supported keys: {allowed}."
    )


def _copy_preserved_top_level_attributes(original: Mapping[str, Any]) -> dict[str, Any]:
    return {k: copy.deepcopy(v) for k, v in original.items() if k in PRESERVED_TOP_LEVEL_ATTRIBUTES}


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

    gateway_config = props.get("GatewayConfig")
    if not isinstance(gateway_config, dict):
        raise ValueError(f"{logical_id}.Properties.GatewayConfig is required and must be an object.")

    spec = props.get("Spec")
    if not isinstance(spec, dict):
        raise ValueError(f"{logical_id}.Properties.Spec is required and must be an object.")

    config_prefix = props.get("ConfigPrefix", _default_prefix_for(logical_id))
    if not isinstance(config_prefix, (str, dict)):
        raise ValueError(
            f"{logical_id}.Properties.ConfigPrefix must be a string or intrinsic function object."
        )

    transformed = _copy_preserved_top_level_attributes(original)
    transformed.update(
        {
            "Type": "Custom::KhoneConfigPublisher",
            "Properties": {
                "ServiceToken": _import_value(EXPORT_CONFIG_PUBLISHER_SERVICE_TOKEN),
                "Prefix": config_prefix,
                "GatewayConfig": gateway_config,
                "Spec": spec,
            },
        }
    )
    resources[logical_id] = transformed


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
            logger.info("Expanding %s %s to Custom::KhoneConfigPublisher", KHONE_GATEWAY_RESOURCE_TYPE, logical_id)
            _expand_gateway_service(resources=resources, logical_id=logical_id, original=resource)

        return {"requestId": request_id, "status": "success", "fragment": out}
    except Exception as exc:
        logger.exception("Macro expansion failed")
        return {"requestId": request_id, "status": "failed", "errorMessage": str(exc)}
