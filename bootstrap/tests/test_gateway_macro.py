import importlib.util
import unittest
from pathlib import Path


BOOTSTRAP_DIR = Path(__file__).resolve().parents[1]

_APP_PATH = BOOTSTRAP_DIR / "gateway_macro" / "app.py"
_SPEC = importlib.util.spec_from_file_location("gateway_macro_app", _APP_PATH)
assert _SPEC and _SPEC.loader
app = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(app)  # type: ignore[union-attr]


def _event(resources):
    return {
        "requestId": "req-1",
        "fragment": {
            "AWSTemplateFormatVersion": "2010-09-09",
            "Resources": resources,
        },
    }


class GatewayMacroTests(unittest.TestCase):
    def test_expands_gateway_service_to_config_publisher_with_same_logical_id(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": {
                            "ConfigPrefix": "khone/demo/",
                            "GatewayConfig": {"DefaultTimeoutMs": 2000},
                            "Spec": {"openapi": "3.0.0", "paths": {}},
                        },
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        resources = out["fragment"]["Resources"]
        self.assertEqual(set(resources.keys()), {"Gateway"})
        gateway = resources["Gateway"]
        self.assertEqual(gateway["Type"], "Custom::KhoneConfigPublisher")
        self.assertEqual(
            gateway["Properties"]["ServiceToken"],
            {"Fn::ImportValue": "KhoneConfigPublisherServiceToken"},
        )
        self.assertEqual(gateway["Properties"]["Prefix"], "khone/demo/")
        self.assertEqual(gateway["Properties"]["GatewayConfig"], {"DefaultTimeoutMs": 2000})
        self.assertEqual(gateway["Properties"]["Spec"], {"openapi": "3.0.0", "paths": {}})

    def test_default_prefix_is_deterministic(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": {
                            "GatewayConfig": {},
                            "Spec": {"paths": {}},
                        },
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        self.assertEqual(
            out["fragment"]["Resources"]["Gateway"]["Properties"]["Prefix"],
            {"Fn::Sub": "khone/${AWS::StackName}/Gateway/"},
        )

    def test_preserves_safe_top_level_resource_attributes(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Condition": "UseGateway",
                        "DependsOn": ["ConfigBucket"],
                        "Metadata": {"Comment": "kept"},
                        "Properties": {
                            "GatewayConfig": {},
                            "Spec": {"paths": {}},
                        },
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        gateway = out["fragment"]["Resources"]["Gateway"]
        self.assertEqual(gateway["Condition"], "UseGateway")
        self.assertEqual(gateway["DependsOn"], ["ConfigBucket"])
        self.assertEqual(gateway["Metadata"], {"Comment": "kept"})

    def test_rejects_removed_app_runner_properties(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": {
                            "ImageIdentifier": "public.ecr.aws/example/gateway:1",
                            "GatewayConfig": {},
                            "Spec": {"paths": {}},
                        },
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("App Runner-era properties", out["errorMessage"])
        self.assertIn("ImageIdentifier", out["errorMessage"])

    def test_rejects_app_runner_property_prefixes(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": {
                            "GatewayConfig": {},
                            "Spec": {"paths": {}},
                            "AutoScalingConfigurationRevision": 3,
                            "ObservabilityConfigurationArn": (
                                "arn:aws:apprunner:us-east-1:123456789012:"
                                "observabilityconfiguration/example/1/hash"
                            ),
                        },
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("App Runner-era properties", out["errorMessage"])
        self.assertIn("AutoScalingConfigurationRevision", out["errorMessage"])
        self.assertIn("ObservabilityConfigurationArn", out["errorMessage"])

    def test_rejects_unknown_properties(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": {
                            "GatewayConfig": {},
                            "Spec": {"paths": {}},
                            "Unknown": True,
                        },
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("unsupported keys: Unknown", out["errorMessage"])

    def test_requires_gateway_config_and_spec_objects(self) -> None:
        for props, expected in [
            ({"Spec": {"paths": {}}}, "GatewayConfig is required"),
            ({"GatewayConfig": {}}, "Spec is required"),
            ({"GatewayConfig": [], "Spec": {"paths": {}}}, "GatewayConfig is required"),
            ({"GatewayConfig": {}, "Spec": []}, "Spec is required"),
        ]:
            out = app.handler(
                _event({"Gateway": {"Type": "Khone::Gateway::Service", "Properties": props}}),
                context=None,
            )
            self.assertEqual(out["status"], "failed")
            self.assertIn(expected, out["errorMessage"])

    def test_leaves_other_resources_untouched(self) -> None:
        original = {"Type": "AWS::S3::Bucket", "Properties": {"BucketName": "example"}}
        out = app.handler(_event({"Bucket": original}), context=None)

        self.assertEqual(out["status"], "success")
        self.assertEqual(out["fragment"]["Resources"]["Bucket"], original)

    def test_invalid_fragment_fails(self) -> None:
        out = app.handler({"requestId": "req-1", "fragment": []}, context=None)

        self.assertEqual(out["status"], "failed")
        self.assertIn("fragment must be an object", out["errorMessage"])


if __name__ == "__main__":
    unittest.main()
