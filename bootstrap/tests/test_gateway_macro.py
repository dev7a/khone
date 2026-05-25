import importlib.util
import os
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


def _gateway_props(**overrides):
    props = {
        "CapacityProviderArn": "arn:aws:lambda:us-east-1:123456789012:capacity-provider:test",
        "GatewayConfig": {"DefaultTimeoutMs": 2000},
        "Spec": {
            "openapi": "3.0.0",
            "paths": {
                "/hello": {
                    "get": {
                        "x-target-lambda": {"Fn::GetAtt": ["HelloFunction", "Arn"]},
                        "x-khone": {"maxWaitMs": 25, "maxBatchSize": 4},
                    }
                },
                "/hello-again": {
                    "get": {
                        "x-target-lambda": {"Fn::GetAtt": ["HelloFunction", "Arn"]},
                        "x-khone": {"maxWaitMs": 25, "maxBatchSize": 4},
                    }
                },
                "/stream": {
                    "get": {
                        "x-target-lambda": "arn:aws:lambda:us-east-1:123456789012:function:stream",
                        "x-khone": {"maxWaitMs": 10, "maxBatchSize": 2},
                    }
                },
            },
        },
    }
    props.update(overrides)
    return props


class GatewayMacroTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_env = {
            name: os.environ.get(name)
            for name in (
                "KHONE_GATEWAY_CODE_S3_BUCKET",
                "KHONE_GATEWAY_CODE_S3_KEY",
                "KHONE_GATEWAY_CODE_S3_OBJECT_VERSION",
            )
        }
        os.environ["KHONE_GATEWAY_CODE_S3_BUCKET"] = "khone-artifacts"
        os.environ["KHONE_GATEWAY_CODE_S3_KEY"] = "khone/releases/0.1.0/gateway.zip"
        os.environ.pop("KHONE_GATEWAY_CODE_S3_OBJECT_VERSION", None)

    def tearDown(self) -> None:
        for name, old in self._old_env.items():
            if old is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = old

    def test_expands_gateway_service_to_lambda_gateway_resources(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(
                            ConfigPrefix="khone/demo/",
                            FunctionName={"Fn::Sub": "${AWS::StackName}-gateway"},
                            Description="Khone gateway",
                            MemorySize=4096,
                            Timeout=90,
                            ExecutionEnvironmentMemoryGiBPerVCpu=4.0,
                            PerExecutionEnvironmentMaxConcurrency=128,
                            MinExecutionEnvironments=4,
                            MaxExecutionEnvironments=4,
                            Environment={"RUST_LOG": "debug", "KHONE_EMF_METRICS": "1"},
                            TracingConfig={"Mode": "Active"},
                            LoggingConfig={"LogFormat": "JSON", "ApplicationLogLevel": "INFO"},
                            LogRetentionInDays=7,
                        ),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        resources = out["fragment"]["Resources"]
        self.assertEqual(resources["Gateway"]["Type"], "AWS::Lambda::Function")
        self.assertEqual(resources["GatewayKhoneConfigPublisher"]["Type"], "Custom::KhoneConfigPublisher")
        self.assertEqual(resources["GatewayKhoneExecutionRole"]["Type"], "AWS::IAM::Role")
        self.assertEqual(resources["GatewayKhoneFunctionUrl"]["Type"], "AWS::Lambda::Url")
        self.assertEqual(resources["GatewayKhoneFunctionUrlPermission"]["Type"], "AWS::Lambda::Permission")
        self.assertEqual(resources["GatewayKhoneLogGroup"]["Type"], "AWS::Logs::LogGroup")

        publisher = resources["GatewayKhoneConfigPublisher"]
        self.assertEqual(
            publisher["Properties"]["ServiceToken"],
            {"Fn::ImportValue": "KhoneConfigPublisherServiceToken"},
        )
        self.assertEqual(publisher["Properties"]["Prefix"], "khone/demo/")

        function_props = resources["Gateway"]["Properties"]
        self.assertEqual(function_props["Code"], {
            "S3Bucket": "khone-artifacts",
            "S3Key": "khone/releases/0.1.0/gateway.zip",
        })
        self.assertEqual(function_props["FunctionName"], {"Fn::Sub": "${AWS::StackName}-gateway"})
        self.assertEqual(function_props["Description"], "Khone gateway")
        self.assertEqual(function_props["Architectures"], ["arm64"])
        self.assertEqual(function_props["Runtime"], "provided.al2023")
        self.assertEqual(function_props["Handler"], "bootstrap")
        self.assertEqual(function_props["MemorySize"], 4096)
        self.assertEqual(function_props["Timeout"], 90)
        self.assertEqual(
            function_props["CapacityProviderConfig"],
            {
                "LambdaManagedInstancesCapacityProviderConfig": {
                    "CapacityProviderArn": "arn:aws:lambda:us-east-1:123456789012:capacity-provider:test",
                    "ExecutionEnvironmentMemoryGiBPerVCpu": 4.0,
                    "PerExecutionEnvironmentMaxConcurrency": 128,
                }
            },
        )
        self.assertEqual(
            function_props["FunctionScalingConfig"],
            {"MinExecutionEnvironments": 4, "MaxExecutionEnvironments": 4},
        )
        env = function_props["Environment"]["Variables"]
        self.assertEqual(env["RUST_LOG"], "debug")
        self.assertEqual(env["KHONE_EMF_METRICS"], "1")
        self.assertEqual(env["KHONE_CONFIG_URI"], {"Fn::GetAtt": ["GatewayKhoneConfigPublisher", "ConfigS3Uri"]})

        policy_doc = resources["GatewayKhoneExecutionRole"]["Properties"]["Policies"][0]["PolicyDocument"]
        create_log_stmt = next(s for s in policy_doc["Statement"] if s["Sid"] == "CreateLogGroup")
        write_log_stmt = next(s for s in policy_doc["Statement"] if s["Sid"] == "WriteLogs")
        invoke_stmt = next(s for s in policy_doc["Statement"] if s["Sid"] == "InvokeTargetLambdas")
        self.assertEqual(
            create_log_stmt["Resource"],
            {
                "Fn::Sub": [
                    "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:"
                    "log-group:/aws/lambda/${FunctionName}",
                    {"FunctionName": {"Fn::Sub": "${AWS::StackName}-gateway"}},
                ]
            },
        )
        self.assertEqual(
            write_log_stmt["Resource"],
            {
                "Fn::Sub": [
                    "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:"
                    "log-group:/aws/lambda/${FunctionName}:*",
                    {"FunctionName": {"Fn::Sub": "${AWS::StackName}-gateway"}},
                ]
            },
        )
        self.assertEqual(invoke_stmt["Action"], ["lambda:InvokeFunction", "lambda:InvokeWithResponseStream"])
        self.assertEqual(
            invoke_stmt["Resource"],
            [
                {"Fn::GetAtt": ["HelloFunction", "Arn"]},
                "arn:aws:lambda:us-east-1:123456789012:function:stream",
            ],
        )

        self.assertEqual(
            resources["GatewayKhoneFunctionUrl"]["Properties"],
            {
                "AuthType": "NONE",
                "InvokeMode": "RESPONSE_STREAM",
                "TargetFunctionArn": {"Fn::GetAtt": ["Gateway", "Arn"]},
            },
        )
        self.assertEqual(
            resources["GatewayKhoneFunctionUrlPermission"]["Properties"],
            {
                "Action": "lambda:InvokeFunctionUrl",
                "FunctionName": {"Ref": "Gateway"},
                "FunctionUrlAuthType": "NONE",
                "Principal": "*",
            },
        )

    def test_default_prefix_and_lambda_defaults_are_deterministic(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(Spec={"paths": {}}),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        resources = out["fragment"]["Resources"]
        self.assertEqual(
            resources["GatewayKhoneConfigPublisher"]["Properties"]["Prefix"],
            {"Fn::Sub": "khone/${AWS::StackName}/Gateway/"},
        )
        function_props = resources["Gateway"]["Properties"]
        self.assertEqual(function_props["MemorySize"], 2048)
        self.assertEqual(function_props["Timeout"], 30)
        self.assertEqual(
            function_props["FunctionScalingConfig"],
            {"MinExecutionEnvironments": 1, "MaxExecutionEnvironments": 4},
        )
        self.assertEqual(function_props["Environment"]["Variables"]["RUST_LOG"], "info")
        policy_doc = resources["GatewayKhoneExecutionRole"]["Properties"]["Policies"][0]["PolicyDocument"]
        write_log_stmt = next(s for s in policy_doc["Statement"] if s["Sid"] == "WriteLogs")
        self.assertEqual(
            write_log_stmt["Resource"],
            {
                "Fn::Sub": (
                    "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:"
                    "log-group:/aws/lambda/${AWS::StackName}-Gateway-*:*"
                )
            },
        )

    def test_includes_code_object_version_when_macro_env_is_set(self) -> None:
        os.environ["KHONE_GATEWAY_CODE_S3_OBJECT_VERSION"] = "object-version"
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(Spec={"paths": {}}),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        self.assertEqual(
            out["fragment"]["Resources"]["Gateway"]["Properties"]["Code"],
            {
                "S3Bucket": "khone-artifacts",
                "S3Key": "khone/releases/0.1.0/gateway.zip",
                "S3ObjectVersion": "object-version",
            },
        )

    def test_aws_iam_function_url_does_not_generate_public_permission(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(FunctionUrlAuthType="AWS_IAM", Spec={"paths": {}}),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        resources = out["fragment"]["Resources"]
        self.assertEqual(resources["GatewayKhoneFunctionUrl"]["Properties"]["AuthType"], "AWS_IAM")
        self.assertNotIn("GatewayKhoneFunctionUrlPermission", resources)

    def test_preserves_safe_top_level_resource_attributes(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Condition": "UseGateway",
                        "DeletionPolicy": "Retain",
                        "DependsOn": ["ConfigBucket"],
                        "Metadata": {"Comment": "kept"},
                        "UpdateReplacePolicy": "Retain",
                        "Properties": _gateway_props(Spec={"paths": {}}),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        gateway = out["fragment"]["Resources"]["Gateway"]
        self.assertEqual(gateway["Condition"], "UseGateway")
        self.assertEqual(gateway["DeletionPolicy"], "Retain")
        self.assertEqual(gateway["DependsOn"], ["ConfigBucket"])
        self.assertEqual(gateway["Metadata"], {"Comment": "kept"})
        self.assertEqual(gateway["UpdateReplacePolicy"], "Retain")
        for generated_id in (
            "GatewayKhoneConfigPublisher",
            "GatewayKhoneExecutionRole",
            "GatewayKhoneFunctionUrl",
            "GatewayKhoneFunctionUrlPermission",
        ):
            generated = out["fragment"]["Resources"][generated_id]
            self.assertEqual(generated["Condition"], "UseGateway")
            self.assertEqual(generated["DeletionPolicy"], "Retain")
            self.assertEqual(generated["DependsOn"], ["ConfigBucket"])
            self.assertEqual(generated["Metadata"], {"Comment": "kept"})
            self.assertEqual(generated["UpdateReplacePolicy"], "Retain")

    def test_rejects_removed_app_runner_properties(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(ImageIdentifier="public.ecr.aws/example/gateway:1"),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("App Runner-era properties", out["errorMessage"])
        self.assertIn("ImageIdentifier", out["errorMessage"])

    def test_rejects_unknown_properties(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(Unknown=True),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("unsupported keys: Unknown", out["errorMessage"])

    def test_requires_capacity_provider_gateway_config_and_spec_objects(self) -> None:
        for props, expected in [
            ({"GatewayConfig": {}, "Spec": {"paths": {}}}, "CapacityProviderArn is required"),
            ({"CapacityProviderArn": "arn", "Spec": {"paths": {}}}, "GatewayConfig is required"),
            ({"CapacityProviderArn": "arn", "GatewayConfig": {}}, "Spec is required"),
            ({"CapacityProviderArn": "arn", "GatewayConfig": [], "Spec": {"paths": {}}}, "GatewayConfig must be an object"),
            ({"CapacityProviderArn": "arn", "GatewayConfig": {}, "Spec": []}, "Spec must be an object"),
        ]:
            out = app.handler(
                _event({"Gateway": {"Type": "Khone::Gateway::Service", "Properties": props}}),
                context=None,
            )
            self.assertEqual(out["status"], "failed")
            self.assertIn(expected, out["errorMessage"])

    def test_rejects_environment_override_of_config_uri(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(
                            Environment={"KHONE_CONFIG_URI": "s3://elsewhere"},
                            Spec={"paths": {}},
                        ),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("cannot define KHONE_CONFIG_URI", out["errorMessage"])

    def test_detects_generated_resource_collision(self) -> None:
        out = app.handler(
            _event(
                {
                    "GatewayKhoneExecutionRole": {"Type": "AWS::IAM::Role"},
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(Spec={"paths": {}}),
                    },
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("GatewayKhoneExecutionRole", out["errorMessage"])

    def test_reports_path_in_x_target_lambda_validation_error(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(
                            Spec={
                                "paths": {
                                    "/hello": {
                                        "get": {
                                            "x-target-lambda": "not-an-arn",
                                            "x-khone": {"maxWaitMs": 1, "maxBatchSize": 1},
                                        }
                                    }
                                }
                            }
                        ),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("Spec.paths['/hello'].get.x-target-lambda", out["errorMessage"])

    def test_rejects_non_lambda_target_arn(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(
                            Spec={
                                "paths": {
                                    "/hello": {
                                        "get": {
                                            "x-target-lambda": "arn:aws:s3:::not-a-lambda",
                                            "x-khone": {"maxWaitMs": 1, "maxBatchSize": 1},
                                        }
                                    }
                                }
                            }
                        ),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("Spec.paths['/hello'].get.x-target-lambda", out["errorMessage"])

    def test_accepts_qualified_lambda_target_arn(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(
                            Spec={
                                "paths": {
                                    "/hello": {
                                        "get": {
                                            "x-target-lambda": (
                                                "arn:aws-us-gov:lambda:us-gov-west-1:123456789012:"
                                                "function:hello:prod"
                                            ),
                                            "x-khone": {"maxWaitMs": 1, "maxBatchSize": 1},
                                        }
                                    }
                                }
                            }
                        ),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")

    def test_accepts_string_route_numeric_settings(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(
                            Spec={
                                "paths": {
                                    "/hello": {
                                        "get": {
                                            "x-target-lambda": "arn:aws:lambda:us-east-1:123456789012:function:hello",
                                            "x-khone": {"maxWaitMs": "25", "maxBatchSize": "4"},
                                        }
                                    }
                                }
                            }
                        ),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "success")
        spec = out["fragment"]["Resources"]["GatewayKhoneConfigPublisher"]["Properties"]["Spec"]
        x_khone = spec["paths"]["/hello"]["get"]["x-khone"]
        self.assertEqual(x_khone["maxWaitMs"], "25")
        self.assertEqual(x_khone["maxBatchSize"], "4")

    def test_rejects_invalid_string_route_numeric_settings(self) -> None:
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(
                            Spec={
                                "paths": {
                                    "/hello": {
                                        "get": {
                                            "x-target-lambda": "arn:aws:lambda:us-east-1:123456789012:function:hello",
                                            "x-khone": {"maxWaitMs": "soon", "maxBatchSize": "4"},
                                        }
                                    }
                                }
                            }
                        ),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("Spec.paths['/hello'].get.x-khone.maxWaitMs", out["errorMessage"])

    def test_missing_gateway_artifact_env_fails(self) -> None:
        os.environ.pop("KHONE_GATEWAY_CODE_S3_BUCKET", None)
        out = app.handler(
            _event(
                {
                    "Gateway": {
                        "Type": "Khone::Gateway::Service",
                        "Properties": _gateway_props(Spec={"paths": {}}),
                    }
                }
            ),
            context=None,
        )

        self.assertEqual(out["status"], "failed")
        self.assertIn("KHONE_GATEWAY_CODE_S3_BUCKET", out["errorMessage"])

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
