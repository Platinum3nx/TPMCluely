use base64::Engine as _;
use reqwest::{Client, Url};
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GithubError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("github error HTTP {0}: {1}")]
    HttpStatus(u16, String),
    #[error("missing pat")]
    MissingPat,
    #[error("github response was invalid: {0}")]
    InvalidResponse(String),
}

#[derive(Debug, Clone)]
pub struct RepoTree {
    pub sha: String,
    pub truncated: bool,
    pub entries: Vec<RepoTreeEntry>,
}

#[derive(Debug, Clone)]
pub struct BranchHead {
    pub commit_sha: String,
    pub tree_sha: String,
}

#[derive(Debug, Clone)]
pub struct RepoTreeEntry {
    pub path: String,
    pub sha: String,
    pub size: Option<u64>,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct CodeSearchHit {
    pub path: String,
    pub sha: String,
}

#[derive(Debug, Deserialize)]
struct BranchResponse {
    commit: BranchCommit,
}

#[derive(Debug, Deserialize)]
struct BranchCommit {
    sha: String,
    commit: NestedCommit,
}

#[derive(Debug, Deserialize)]
struct NestedCommit {
    tree: CommitTree,
}

#[derive(Debug, Deserialize)]
struct CommitTree {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct TreeResponse {
    sha: String,
    truncated: bool,
    tree: Vec<TreeEntryResponse>,
}

#[derive(Debug, Deserialize)]
struct TreeEntryResponse {
    path: String,
    sha: String,
    size: Option<u64>,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct BlobResponse {
    content: String,
    encoding: String,
}

#[derive(Debug, Deserialize)]
struct ContentsResponse {
    content: String,
    encoding: String,
}

#[derive(Debug, Deserialize)]
struct CodeSearchResponse {
    items: Vec<CodeSearchItemResponse>,
}

#[derive(Debug, Deserialize)]
struct CodeSearchItemResponse {
    path: String,
    sha: String,
}

fn github_client() -> Result<Client, GithubError> {
    Client::builder()
        .user_agent("TPMCluely-Desktop")
        .build()
        .map_err(Into::into)
}

async fn send_json<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: Url,
    pat: &str,
) -> Result<T, GithubError> {
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(GithubError::HttpStatus(status.as_u16(), text));
    }

    response
        .json::<T>()
        .await
        .map_err(GithubError::from)
}

async fn send_bytes(client: &Client, url: Url, pat: &str) -> Result<Vec<u8>, GithubError> {
    let response = client
        .get(url)
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

fn require_pat(pat: &str) -> Result<(), GithubError> {
    if pat.trim().is_empty() {
        Err(GithubError::MissingPat)
    } else {
        Ok(())
    }
}

fn decode_base64_content(content: &str, encoding: &str) -> Result<Vec<u8>, GithubError> {
    if encoding != "base64" {
        return Err(GithubError::InvalidResponse(format!(
            "unsupported GitHub encoding: {encoding}"
        )));
    }

    let normalized = content.lines().collect::<String>();
    base64::engine::general_purpose::STANDARD
        .decode(normalized.as_bytes())
        .map_err(|error| GithubError::InvalidResponse(error.to_string()))
}

pub async fn resolve_branch_head(
    owner_repo: &str,
    branch: &str,
    pat: &str,
) -> Result<BranchHead, GithubError> {
    require_pat(pat)?;
    let client = github_client()?;
    let url = Url::parse(&format!(
        "https://api.github.com/repos/{owner_repo}/branches/{branch}"
    ))
    .map_err(|error| GithubError::InvalidResponse(error.to_string()))?;
    let response: BranchResponse = send_json(&client, url, pat).await?;
    Ok(BranchHead {
        commit_sha: response.commit.sha,
        tree_sha: response.commit.commit.tree.sha,
    })
}

pub async fn list_tree_recursive(
    owner_repo: &str,
    tree_sha: &str,
    pat: &str,
) -> Result<RepoTree, GithubError> {
    require_pat(pat)?;
    let client = github_client()?;
    let url = Url::parse_with_params(
        &format!("https://api.github.com/repos/{owner_repo}/git/trees/{tree_sha}"),
        &[("recursive", "1")],
    )
    .map_err(|error| GithubError::InvalidResponse(error.to_string()))?;
    let response: TreeResponse = send_json(&client, url, pat).await?;
    Ok(RepoTree {
        sha: response.sha,
        truncated: response.truncated,
        entries: response
            .tree
            .into_iter()
            .map(|entry| RepoTreeEntry {
                path: entry.path,
                sha: entry.sha,
                size: entry.size,
                kind: entry.kind,
            })
            .collect(),
    })
}

pub async fn fetch_blob(
    owner_repo: &str,
    blob_sha: &str,
    pat: &str,
) -> Result<Vec<u8>, GithubError> {
    require_pat(pat)?;
    let client = github_client()?;
    let url = Url::parse(&format!(
        "https://api.github.com/repos/{owner_repo}/git/blobs/{blob_sha}"
    ))
    .map_err(|error| GithubError::InvalidResponse(error.to_string()))?;
    let response: BlobResponse = send_json(&client, url, pat).await?;
    decode_base64_content(&response.content, &response.encoding)
}

pub async fn fetch_file(
    owner_repo: &str,
    path: &str,
    commit: &str,
    pat: &str,
) -> Result<Vec<u8>, GithubError> {
    require_pat(pat)?;
    let client = github_client()?;
    let url = Url::parse_with_params(
        &format!("https://api.github.com/repos/{owner_repo}/contents/{path}"),
        &[("ref", commit)],
    )
    .map_err(|error| GithubError::InvalidResponse(error.to_string()))?;
    let response: ContentsResponse = send_json(&client, url, pat).await?;
    decode_base64_content(&response.content, &response.encoding)
}

pub async fn search_code(
    owner_repo: &str,
    branch: &str,
    query: &str,
    pat: &str,
) -> Result<Vec<CodeSearchHit>, GithubError> {
    require_pat(pat)?;
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let client = github_client()?;
    let q = format!("{trimmed_query} repo:{owner_repo} ref:{branch}");
    let url = Url::parse_with_params(
        "https://api.github.com/search/code",
        &[("q", q.as_str()), ("per_page", "5")],
    )
    .map_err(|error| GithubError::InvalidResponse(error.to_string()))?;
    let response: CodeSearchResponse = send_json(&client, url, pat).await?;
    Ok(response
        .items
        .into_iter()
        .map(|item| CodeSearchHit {
            path: item.path,
            sha: item.sha,
        })
        .collect())
}

pub async fn download_tarball(
    owner_repo: &str,
    branch: &str,
    pat: &str,
) -> Result<Vec<u8>, GithubError> {
    require_pat(pat)?;
    let client = github_client()?;
    let url = Url::parse(&format!("https://api.github.com/repos/{owner_repo}/tarball/{branch}"))
        .map_err(|error| GithubError::InvalidResponse(error.to_string()))?;
    send_bytes(&client, url, pat).await
}
