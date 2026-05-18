use std::{collections::HashMap, convert::Infallible, time::Duration};

use aws_lambda_events::event::apigw::ApiGatewayV2httpRequest;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use khone_lambda_adapter::{batch_adapter, BatchRequestEvent, HandlerResponse};
use lambda_runtime::{service_fn, Error, LambdaEvent};
use serde_json::json;

const MAX_DELAY_MS: u64 = 10_000;

fn parse_delay_ms(event: &ApiGatewayV2httpRequest) -> u64 {
    event
        .query_string_parameters
        .first("max-delay")
        .and_then(|raw| raw.parse::<u64>().ok())
        .map(|n| n.min(MAX_DELAY_MS))
        .unwrap_or(0)
}

fn decode_body_utf8(event: &ApiGatewayV2httpRequest) -> String {
    let Some(body) = event.body.as_deref() else {
        return String::new();
    };

    if event.is_base64_encoded {
        return STANDARD
            .decode(body.as_bytes())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .unwrap_or_default();
    }

    body.to_string()
}

fn query_string_parameters(event: &ApiGatewayV2httpRequest) -> HashMap<String, String> {
    event
        .query_string_parameters
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

async fn handle_item(
    event: ApiGatewayV2httpRequest,
) -> Result<HandlerResponse, Infallible> {
    let delay_ms = parse_delay_ms(&event);
    if delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }

    let greeting = event
        .path_parameters
        .get("greeting")
        .cloned()
        .unwrap_or_default();
    let route_key = event
        .route_key
        .clone()
        .or_else(|| event.request_context.route_key.clone())
        .unwrap_or_default();
    let path = event.raw_path.clone().unwrap_or_default();
    let query = query_string_parameters(&event);
    let path_parameters = event.path_parameters.clone();
    let body_utf8 = decode_body_utf8(&event);

    let body = json!({
        "ok": true,
        "id": event.request_context.request_id.unwrap_or_default(),
        "method": event.request_context.http.method.to_string(),
        "greeting": greeting,
        "path": path,
        "routeKey": route_key,
        "query": query,
        "pathParameters": path_parameters,
        "maxDelayMs": delay_ms,
        "delayMs": delay_ms,
        "bodyUtf8": body_utf8,
    });

    let mut response = HandlerResponse::text(200, body.to_string());
    response
        .headers
        .insert("content-type".to_string(), "application/json".to_string());
    Ok(response)
}

async fn handle_batch(
    event: LambdaEvent<BatchRequestEvent<ApiGatewayV2httpRequest>>,
) -> Result<serde_json::Value, Error> {
    let (batch, _ctx) = event.into_parts();
    let response = batch_adapter(|item, _ctx: &()| handle_item(item))
        .handle(batch, &())
        .await;
    Ok(serde_json::to_value(response)?)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    lambda_runtime::run(service_fn(handle_batch)).await
}
