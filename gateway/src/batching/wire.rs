use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BatchItem {
    /// Gateway-generated request identifier (used for correlating batch responses).
    ///
    /// This is serialized into the request event as `requestContext.requestId`.
    #[serde(skip_serializing)]
    pub(super) id: String,
    pub(super) version: &'static str,
    pub(super) route_key: String,
    pub(super) raw_path: String,
    pub(super) raw_query_string: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) cookies: Option<Vec<String>>,
    pub(super) headers: HashMap<String, String>,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub(super) query_string_parameters: HashMap<String, String>,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub(super) path_parameters: HashMap<String, String>,
    pub(super) request_context: ApiGatewayV2RequestContext,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub(super) stage_variables: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) body: Option<String>,
    #[serde(rename = "isBase64Encoded")]
    pub(super) is_base64_encoded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApiGatewayV2RequestContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) api_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) domain_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) domain_prefix: Option<String>,
    pub(super) route_key: String,
    pub(super) stage: &'static str,
    pub(super) request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) time: Option<String>,
    pub(super) time_epoch: i64,
    pub(super) http: ApiGatewayV2HttpDescription,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApiGatewayV2HttpDescription {
    pub(super) method: String,
    pub(super) path: String,
    pub(super) protocol: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) source_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct BatchResponse {
    pub(super) v: u8,
    pub(super) responses: Vec<BatchResponseItem>,
}

#[derive(Debug, Deserialize)]
pub(super) struct BatchResponseItem {
    pub(super) id: String,
    #[serde(rename = "statusCode")]
    pub(super) status_code: u16,
    #[serde(default)]
    pub(super) headers: HashMap<String, String>,
    #[serde(default)]
    pub(super) cookies: Vec<String>,
    #[serde(default)]
    pub(super) body: String,
    #[serde(rename = "isBase64Encoded", default)]
    pub(super) is_base64_encoded: bool,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(super) enum StreamResponseRecord {
    Legacy(StreamResponseRecordLegacy),
    Interleaved(StreamResponseRecordInterleaved),
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamResponseRecordLegacy {
    pub(super) v: u8,
    pub(super) id: String,
    #[serde(rename = "statusCode")]
    pub(super) status_code: u16,
    #[serde(default)]
    pub(super) headers: HashMap<String, String>,
    #[serde(default)]
    pub(super) cookies: Vec<String>,
    #[serde(default)]
    pub(super) body: String,
    #[serde(rename = "isBase64Encoded", default)]
    pub(super) is_base64_encoded: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum StreamRecordType {
    Head,
    Chunk,
    End,
    Error,
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamResponseRecordInterleaved {
    pub(super) v: u8,
    pub(super) id: String,
    #[serde(rename = "type")]
    pub(super) record_type: StreamRecordType,
    #[serde(rename = "statusCode", default)]
    pub(super) status_code: Option<u16>,
    #[serde(default)]
    pub(super) headers: HashMap<String, String>,
    #[serde(default)]
    pub(super) cookies: Vec<String>,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(rename = "isBase64Encoded", default)]
    pub(super) is_base64_encoded: bool,
    #[serde(default)]
    pub(super) message: Option<String>,
}
