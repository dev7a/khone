use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use http::{HeaderMap, HeaderName, HeaderValue, StatusCode};

use super::GatewayResponse;

pub(crate) fn build_gateway_response_parts(
    status_code: u16,
    headers_in: HashMap<String, String>,
    cookies: Vec<String>,
    body: String,
    is_base64_encoded: bool,
) -> anyhow::Result<GatewayResponse> {
    let status = StatusCode::from_u16(status_code)?;

    let mut headers = headers_from_map(headers_in)?;
    append_cookies(&mut headers, cookies)?;

    let body_bytes = decode_body_bytes(&body, is_base64_encoded)?;

    Ok(GatewayResponse {
        status,
        headers,
        body: body_bytes,
        meta: None,
    })
}

pub(super) fn headers_from_map(headers_in: HashMap<String, String>) -> anyhow::Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    for (k, v) in headers_in {
        let name = HeaderName::from_bytes(k.as_bytes())?;
        let value = HeaderValue::from_str(&v)?;
        headers.insert(name, value);
    }
    Ok(headers)
}

pub(super) fn append_cookies(headers: &mut HeaderMap, cookies: Vec<String>) -> anyhow::Result<()> {
    for cookie in cookies {
        let cookie = cookie.trim();
        if cookie.is_empty() {
            continue;
        }
        let value = HeaderValue::from_str(cookie)?;
        headers.append(http::header::SET_COOKIE, value);
    }
    Ok(())
}

pub(super) fn decode_body_bytes(body: &str, is_base64_encoded: bool) -> anyhow::Result<Bytes> {
    if is_base64_encoded {
        Ok(Bytes::from(STANDARD.decode(body.as_bytes())?))
    } else {
        Ok(Bytes::from(body.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_parts_append_set_cookie_headers() {
        let resp = build_gateway_response_parts(
            200,
            HashMap::from([("content-type".to_string(), "text/plain".to_string())]),
            vec!["a=b; Path=/".to_string(), "c=d; HttpOnly".to_string()],
            "ok".to_string(),
            false,
        )
        .unwrap();
        assert_eq!(resp.status, StatusCode::OK);
        assert_eq!(
            resp.headers
                .get_all(http::header::SET_COOKIE)
                .iter()
                .count(),
            2
        );
    }

    #[test]
    fn response_parts_decode_base64_body() {
        let raw = b"hello";
        let b64 = STANDARD.encode(raw);
        let bytes = decode_body_bytes(&b64, true).unwrap();
        assert_eq!(bytes, Bytes::from_static(raw));
    }
}
