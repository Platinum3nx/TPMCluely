use std::env;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::time::sleep;

const LINEAR_TIMEOUT_SECS: u64 = 12;
const MAX_LOOKUP_ISSUES: usize = 25;
const DEFAULT_LINEAR_BASE_URL: &str = "https://api.linear.app/graphql";

const ISSUE_CREATE_MUTATION: &str = r#"
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        url
      }
    }
  }
"#;

const ISSUE_LOOKUP_QUERY: &str = r#"
  query CluelyIssueLookup($teamId: String!, $marker: String!) {
    team(id: $teamId) {
      issues(
        first: 25
        includeArchived: true
        filter: { description: { contains: $marker } }
      ) {
        nodes {
          id
          identifier
          title
          url
          createdAt
        }
      }
    }
  }
"#;

const TEAM_LOOKUP_QUERY: &str = r#"
  query CluelyTeamLookup($teamId: String!) {
    team(id: $teamId) {
      id
      name
    }
  }
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssueRequest {
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    pub idempotency_key: Option<String>,
    pub linear_dedupe_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinearIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinearIssueMatch {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub url: String,
    pub created_at: String,
}

pub trait LinearProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;
}

#[derive(Debug, Error)]
pub enum LinearProviderError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("linear returned {0}: {1}")]
    HttpStatus(u16, String),
    #[error("linear graphql error: {0}")]
    Graphql(String),
    #[error("linear issue was not created")]
    MissingIssue,
}

fn should_retry(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

fn normalize_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn build_legacy_marker(idempotency_key: &str) -> String {
    format!("<!-- cluely-idempotency:{idempotency_key} -->")
}

pub fn build_linear_dedupe_key(session_id: &str, idempotency_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{session_id}|{idempotency_key}").as_bytes());
    hex::encode(hasher.finalize())[..24].to_string()
}

pub fn build_linear_dedupe_marker(linear_dedupe_key: &str) -> String {
    format!("<!-- cluely-linear-dedupe:{linear_dedupe_key} -->")
}

pub fn build_linear_description(
    description: &str,
    acceptance_criteria: &[String],
    idempotency_key: Option<&str>,
    linear_dedupe_key: Option<&str>,
) -> String {
    let mut full_description = normalize_line(description);

    if !acceptance_criteria.is_empty() {
        let checklist = acceptance_criteria
            .iter()
            .map(|criterion| format!("- [ ] {}", normalize_line(criterion)))
            .collect::<Vec<_>>()
            .join("\n");
        full_description.push_str("\n\n**Acceptance Criteria**\n");
        full_description.push_str(&checklist);
    }

    if let Some(key) = idempotency_key {
        full_description.push_str("\n\n");
        full_description.push_str(&build_legacy_marker(key));
    }

    if let Some(key) = linear_dedupe_key {
        full_description.push_str("\n\n");
        full_description.push_str(&build_linear_dedupe_marker(key));
    }

    full_description
}

fn select_canonical_issue(matches: &[LinearIssueMatch]) -> Option<LinearIssueMatch> {
    matches.iter().cloned().min_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    })
}

fn linear_graphql_endpoint() -> String {
    env::var("TPMCLUELY_LINEAR_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_LINEAR_BASE_URL.to_string())
}

async fn linear_graphql_request(
    api_key: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<serde_json::Value, LinearProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(LINEAR_TIMEOUT_SECS))
        .build()?;

    for attempt in 0..3 {
        let response = client
            .post(linear_graphql_endpoint())
            .header("Content-Type", "application/json")
            .header("Authorization", api_key)
            .json(&json!({
                "query": query,
                "variables": variables,
            }))
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            if should_retry(status) && attempt < 2 {
                sleep(Duration::from_millis((attempt + 1) as u64 * 350)).await;
                continue;
            }

            return Err(LinearProviderError::HttpStatus(
                status.as_u16(),
                body.chars().take(240).collect(),
            ));
        }

        let value: serde_json::Value = response.json().await?;
        if let Some(errors) = value.get("errors").and_then(|errors| errors.as_array()) {
            if !errors.is_empty() {
                let message = errors
                    .iter()
                    .filter_map(|error| error.get("message").and_then(|message| message.as_str()))
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(LinearProviderError::Graphql(message));
            }
        }

        return Ok(value);
    }

    Err(LinearProviderError::MissingIssue)
}

pub async fn find_issues_by_marker(
    api_key: &str,
    team_id: &str,
    marker: &str,
) -> Result<Vec<LinearIssueMatch>, LinearProviderError> {
    let value = linear_graphql_request(
        api_key,
        ISSUE_LOOKUP_QUERY,
        json!({
            "teamId": team_id,
            "marker": marker,
        }),
    )
    .await?;

    let nodes = value
        .get("data")
        .and_then(|data| data.get("team"))
        .and_then(|team| team.get("issues"))
        .and_then(|issues| issues.get("nodes"))
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));

    let mut matches = serde_json::from_value::<Vec<LinearIssueMatch>>(nodes)
        .map_err(|_| LinearProviderError::MissingIssue)?;
    matches.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    matches.truncate(MAX_LOOKUP_ISSUES);
    Ok(matches)
}

pub async fn check_connectivity(api_key: &str, team_id: &str) -> Result<(), LinearProviderError> {
    let value = linear_graphql_request(
        api_key,
        TEAM_LOOKUP_QUERY,
        json!({
            "teamId": team_id,
        }),
    )
    .await?;

    let has_team = value
        .get("data")
        .and_then(|data| data.get("team"))
        .and_then(|team| team.get("id"))
        .and_then(|id| id.as_str())
        .is_some();

    if has_team {
        Ok(())
    } else {
        Err(LinearProviderError::Graphql(
            "Linear team lookup returned no team.".to_string(),
        ))
    }
}

pub async fn create_issue(
    api_key: &str,
    team_id: &str,
    request: &LinearIssueRequest,
) -> Result<LinearIssue, LinearProviderError> {
    let value = linear_graphql_request(
        api_key,
        ISSUE_CREATE_MUTATION,
        json!({
            "input": {
                "teamId": team_id,
                "title": normalize_line(&request.title),
                "description": build_linear_description(
                    &request.description,
                    &request.acceptance_criteria,
                    request.idempotency_key.as_deref(),
                    request.linear_dedupe_key.as_deref()
                )
            }
        }),
    )
    .await?;

    if let Some(issue_value) = value
        .get("data")
        .and_then(|data| data.get("issueCreate"))
        .and_then(|issue_create| issue_create.get("issue"))
        .cloned()
    {
        let issue: LinearIssue =
            serde_json::from_value(issue_value).map_err(|_| LinearProviderError::MissingIssue)?;
        return Ok(issue);
    }

    Err(LinearProviderError::MissingIssue)
}

pub fn choose_canonical_issue(matches: &[LinearIssueMatch]) -> Option<LinearIssueMatch> {
    select_canonical_issue(matches)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;

    use super::{
        build_linear_dedupe_key, build_linear_dedupe_marker, build_linear_description,
        check_connectivity, choose_canonical_issue, LinearIssueMatch,
    };

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> String {
        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 1024];
        let mut header_end = None;
        let mut content_length = 0usize;

        loop {
            let read = stream.read(&mut chunk).expect("request should read");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);

            if header_end.is_none() {
                if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                    header_end = Some(index + 4);
                    let headers = String::from_utf8_lossy(&buffer[..index + 4]);
                    for line in headers.lines() {
                        if let Some((name, value)) = line.split_once(':') {
                            if name.eq_ignore_ascii_case("Content-Length") {
                                content_length = value.trim().parse::<usize>().unwrap_or(0);
                            }
                        }
                    }
                }
            }

            if let Some(index) = header_end {
                if buffer.len() >= index + content_length {
                    break;
                }
            }
        }

        String::from_utf8(buffer).expect("request should be utf8")
    }

    fn spawn_http_json_server(
        response_body: &'static str,
    ) -> (String, Arc<Mutex<Option<String>>>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener.local_addr().expect("listener should have address");
        let request = Arc::new(Mutex::new(None));
        let request_clone = Arc::clone(&request);

        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connection should arrive");
            let captured_request = read_http_request(&mut stream);
            *request_clone.lock().expect("request lock should hold") = Some(captured_request);

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        });

        (format!("http://{address}/graphql"), request, handle)
    }

    #[test]
    fn description_includes_both_dedupe_markers() {
        let description = build_linear_description(
            "Implement retry middleware",
            &[
                "Retries only on 429/5xx".to_string(),
                "Timeout at 12 seconds".to_string(),
            ],
            Some("abc123"),
            Some("dedupe456"),
        );

        assert!(description.contains("**Acceptance Criteria**"));
        assert!(description.contains("cluely-idempotency:abc123"));
        assert!(description.contains("cluely-linear-dedupe:dedupe456"));
    }

    #[test]
    fn dedupe_key_is_session_scoped() {
        let first = build_linear_dedupe_key("session_a", "same-ticket");
        let second = build_linear_dedupe_key("session_b", "same-ticket");

        assert_ne!(first, second);
        assert_eq!(first.len(), 24);
        assert_eq!(
            build_linear_dedupe_marker(&first),
            format!("<!-- cluely-linear-dedupe:{first} -->")
        );
    }

    #[test]
    fn chooses_earliest_issue_when_multiple_matches_exist() {
        let matches = vec![
            LinearIssueMatch {
                id: "issue_2".to_string(),
                identifier: "ENG-2".to_string(),
                title: "Second".to_string(),
                url: "https://linear.app/eng/issue/ENG-2".to_string(),
                created_at: "2026-03-11T10:00:00Z".to_string(),
            },
            LinearIssueMatch {
                id: "issue_1".to_string(),
                identifier: "ENG-1".to_string(),
                title: "First".to_string(),
                url: "https://linear.app/eng/issue/ENG-1".to_string(),
                created_at: "2026-03-10T10:00:00Z".to_string(),
            },
        ];

        let chosen = choose_canonical_issue(&matches).expect("canonical issue should exist");
        assert_eq!(chosen.identifier, "ENG-1");
    }

    #[tokio::test]
    async fn connectivity_check_uses_base_url_override_against_stub_server() {
        let _guard = env_lock().lock().expect("env lock should hold");
        let (base_url, request, handle) =
            spawn_http_json_server(r#"{"data":{"team":{"id":"team_123","name":"Platform"}}}"#);
        unsafe {
            std::env::set_var("TPMCLUELY_LINEAR_BASE_URL", &base_url);
        }

        check_connectivity("linear-api-key", "team_123")
            .await
            .expect("stub connectivity should succeed");

        unsafe {
            std::env::remove_var("TPMCLUELY_LINEAR_BASE_URL");
        }
        handle.join().expect("server should finish");

        let captured_request = request
            .lock()
            .expect("request lock should hold")
            .clone()
            .expect("request should be captured");
        let normalized_request = captured_request.to_ascii_lowercase();
        assert!(captured_request.starts_with("POST /graphql HTTP/1.1"));
        assert!(normalized_request.contains("authorization: linear-api-key"));
        assert!(captured_request.contains("CluelyTeamLookup"));
        assert!(captured_request.contains("\"teamId\":\"team_123\""));
    }
}
