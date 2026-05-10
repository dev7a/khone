import importlib.util
import unittest
from pathlib import Path
from unittest import mock


BOOTSTRAP_DIR = Path(__file__).resolve().parents[1]

_APP_PATH = BOOTSTRAP_DIR / "config_publisher" / "app.py"
_SPEC = importlib.util.spec_from_file_location("config_publisher_app", _APP_PATH)
assert _SPEC and _SPEC.loader
app = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(app)  # type: ignore[union-attr]


class _FakeS3:
    def __init__(self) -> None:
        self.put_calls = []

    def put_object(self, **kwargs):
        self.put_calls.append(kwargs)


class _FakeBoto3:
    def __init__(self, s3: _FakeS3) -> None:
        self._s3 = s3

    def client(self, service_name: str):
        assert service_name == "s3"
        return self._s3


class ConfigPublisherTests(unittest.TestCase):
    def test_normalize_prefix(self) -> None:
        self.assertEqual(app._normalize_prefix(""), "")
        self.assertEqual(app._normalize_prefix("khone"), "khone/")
        self.assertEqual(app._normalize_prefix("khone/"), "khone/")
        self.assertEqual(app._normalize_prefix("/khone"), "khone/")
        self.assertEqual(app._normalize_prefix(" /khone/ "), "khone/")

    def test_publish_uses_hashed_key(self) -> None:
        fake_s3 = _FakeS3()
        fake_boto3 = _FakeBoto3(fake_s3)

        gateway_config = {"MaxInflightInvocations": 1}
        spec = {"openapi": "3.0.0", "paths": {}}

        with mock.patch.object(app, "boto3", fake_boto3):
            data, physical_id = app._publish(
                bucket="my-bucket",
                prefix="khone",
                gateway_config=gateway_config,
                spec=spec,
            )

        self.assertEqual(physical_id, "khone-config-publisher:my-bucket:khone/")
        self.assertEqual(data["BucketName"], "my-bucket")
        self.assertTrue(data["ConfigKey"].startswith("khone/config/"))
        self.assertTrue(data["ConfigKey"].endswith(".json"))
        self.assertEqual(data["ConfigS3Uri"], f"s3://my-bucket/{data['ConfigKey']}")

        self.assertEqual(len(fake_s3.put_calls), 1)
        config_call = fake_s3.put_calls[0]
        self.assertEqual(config_call["Bucket"], "my-bucket")
        self.assertEqual(config_call["Key"], data["ConfigKey"])
        self.assertEqual(config_call["ContentType"], "application/json")
        self.assertEqual(config_call["Metadata"]["khone-name"], "config")

        config_doc = app.json.loads(config_call["Body"].decode("utf-8"))
        self.assertIn("Spec", config_doc)
        self.assertNotIn("ListenAddr", config_doc)
        self.assertNotIn("spec_path", config_doc)
        self.assertNotIn("listen_addr", config_doc)
        self.assertEqual(config_doc["Spec"], spec)

    def test_handler_delete_success(self) -> None:
        event = {
            "RequestType": "Delete",
            "ResponseURL": "https://example.com/cfn-response",
            "StackId": "stack",
            "RequestId": "req",
            "LogicalResourceId": "MyResource",
        }

        with mock.patch.object(app, "_cfn_send_response") as send:
            app.handler(event, context=None)

        send.assert_called_once()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["status"], "SUCCESS")
        self.assertEqual(kwargs["data"], {})

    def test_handler_missing_bucket_fails(self) -> None:
        event = {
            "RequestType": "Create",
            "ResponseURL": "https://example.com/cfn-response",
            "StackId": "stack",
            "RequestId": "req",
            "LogicalResourceId": "MyResource",
            "ResourceProperties": {"GatewayConfig": {}, "Spec": {}},
        }

        with mock.patch.object(app, "_cfn_send_response") as send:
            with mock.patch.dict(app.os.environ, {}, clear=True):
                app.handler(event, context=None)

        send.assert_called_once()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["status"], "FAILED")

    def test_handler_requires_gateway_config_and_spec_objects(self) -> None:
        for props, expected in [
            ({"BucketName": "my-bucket", "Spec": {}}, "GatewayConfig is required"),
            ({"BucketName": "my-bucket", "GatewayConfig": {}}, "Spec is required"),
            ({"BucketName": "my-bucket", "GatewayConfig": [], "Spec": {}}, "GatewayConfig is required"),
            ({"BucketName": "my-bucket", "GatewayConfig": {}, "Spec": []}, "Spec is required"),
        ]:
            event = {
                "RequestType": "Create",
                "ResponseURL": "https://example.com/cfn-response",
                "StackId": "stack",
                "RequestId": "req",
                "LogicalResourceId": "MyResource",
                "ResourceProperties": props,
            }

            with mock.patch.object(app, "_publish") as publish:
                with mock.patch.object(app, "_cfn_send_response") as send:
                    app.handler(event, context=None)

            publish.assert_not_called()
            send.assert_called_once()
            kwargs = send.call_args.kwargs
            self.assertEqual(kwargs["status"], "FAILED")
            self.assertIn(expected, kwargs["reason"])

    def test_handler_publish_success(self) -> None:
        event = {
            "RequestType": "Create",
            "ResponseURL": "https://example.com/cfn-response",
            "StackId": "stack",
            "RequestId": "req",
            "LogicalResourceId": "MyResource",
            "ResourceProperties": {
                "BucketName": "my-bucket",
                "Prefix": "khone/",
                "GatewayConfig": {},
                "Spec": {},
            },
        }

        with mock.patch.object(
            app,
            "_publish",
            return_value=(
                {"ConfigS3Uri": "s3://my-bucket/khone/config/abc.json"},
                "khone-config-publisher:my-bucket:khone/",
            ),
        ) as publish:
            with mock.patch.object(app, "_cfn_send_response") as send:
                app.handler(event, context=None)

        publish.assert_called_once_with(
            bucket="my-bucket",
            prefix="khone/",
            gateway_config={},
            spec={},
        )
        send.assert_called_once()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["status"], "SUCCESS")
        self.assertEqual(kwargs["data"], {"ConfigS3Uri": "s3://my-bucket/khone/config/abc.json"})


if __name__ == "__main__":
    unittest.main()
