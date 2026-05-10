#[tokio::main]
async fn main() -> anyhow::Result<()> {
    khone_runtime_api_proxy::extension::run().await
}
