use reqwest::Client;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GithubError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("github error HTTP {0}: {1}")]
    HttpStatus(u16, String),
    #[error("missing pat")]
    MissingPat,
}

pub async fn download_tarball(
    owner_repo: &str,
    branch: &str,
    pat: &str,
) -> Result<Vec<u8>, GithubError> {
    if pat.trim().is_empty() {
        return Err(GithubError::MissingPat);
    }

    let client = Client::builder()
        .user_agent("TPMCluely-Desktop")
        .build()?;

    let url = format!("https://api.github.com/repos/{}/tarball/{}", owner_repo, branch);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(GithubError::HttpStatus(status.as_u16(), text));
    }

    let bytes = response.bytes().await?;
    Ok(bytes.to_vec())
}
