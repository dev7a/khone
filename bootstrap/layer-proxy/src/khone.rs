use bytes::Bytes;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug)]
pub struct VirtualInvocation {
    pub id: String,
    pub event_bytes: Bytes,
}

pub fn parse_outer_khone_batch(body: &[u8]) -> anyhow::Result<Option<Vec<VirtualInvocation>>> {
    let env: Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    if env.get("v").and_then(Value::as_u64) != Some(1) {
        return Ok(None);
    }

    let Some(batch_value) = env.get("batch") else {
        return Ok(None);
    };
    let Some(batch) = batch_value.as_array() else {
        anyhow::bail!("Khone batch field must be an array");
    };

    if batch.is_empty() {
        anyhow::bail!("Khone batch must contain at least one item");
    }

    let mut out = Vec::with_capacity(batch.len());
    let mut seen = HashSet::<String>::with_capacity(batch.len());
    for item in batch {
        let id = item
            .get("requestContext")
            .and_then(|v| v.get("requestId"))
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("batch item missing requestContext.requestId"))?;

        if !seen.insert(id.to_string()) {
            anyhow::bail!("duplicate requestContext.requestId in batch ({id})");
        }

        let event_bytes = serde_json::to_vec(item)?;
        out.push(VirtualInvocation {
            id: id.to_string(),
            event_bytes: Bytes::from(event_bytes),
        });
    }

    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_outer_batch_rejects_non_json() {
        let got = parse_outer_khone_batch(b"nope").unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn parse_outer_batch_rejects_wrong_version() {
        let got = parse_outer_khone_batch(br#"{"v":2,"batch":[]}"#).unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn parse_outer_batch_passes_through_v1_without_batch_field() {
        let got = parse_outer_khone_batch(br#"{"v":1}"#).unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn parse_outer_batch_rejects_invalid_or_empty_batch_field() {
        for body in [
            br#"{"v":1,"batch":null}"#.as_slice(),
            br#"{"v":1,"batch":[]}"#,
            br#"{"v":1,"batch":{}}"#,
            br#"{"v":1,"batch":"not-a-batch"}"#,
        ] {
            let err = parse_outer_khone_batch(body).unwrap_err();
            assert!(
                err.to_string().contains("Khone batch"),
                "expected Khone batch error for {}, got: {}",
                std::str::from_utf8(body).unwrap(),
                err
            );
        }
    }

    #[test]
    fn parse_outer_batch_extracts_ids() {
        let got = parse_outer_khone_batch(
            br#"{"v":1,"batch":[{"requestContext":{"requestId":"a"}},{"requestContext":{"requestId":"b"}}]}"#,
        )
        .unwrap()
        .unwrap();

        assert_eq!(got.len(), 2);
        assert_eq!(got[0].id, "a");
        assert_eq!(got[1].id, "b");
    }

    #[test]
    fn parse_outer_batch_rejects_duplicate_ids() {
        let err = parse_outer_khone_batch(
            br#"{"v":1,"batch":[{"requestContext":{"requestId":"a"}},{"requestContext":{"requestId":"a"}}]}"#,
        )
        .unwrap_err();

        assert!(err.to_string().contains("duplicate"));
    }
}
