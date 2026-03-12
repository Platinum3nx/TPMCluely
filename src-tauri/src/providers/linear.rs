use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use tokio::time::sleep;

const LINEAR_TIMEOUT_SECS: u64 = 12;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssueRequest {
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub url: String,
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

pub fn build_linear_description(
    description: &str,
    acceptance_criteria: &[String],
    idempotency_key: Option<&str>,
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
        full_description.push_str(&format!("\n\n<!-- cluely-idempotency:{key} -->"));
    }

    full_description
}

pub async fn create_issue(
    api_key: &str,
    team_id: &str,
    request: &LinearIssueRequest,
) -> Result<LinearIssue, LinearProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(LINEAR_TIMEOUT_SECS))
        .build()?;

    for attempt in 0..3 {
        let response = client
            .post("https://api.linear.app/graphql")
            .header("Content-Type", "application/json")
            .header("Authorization", api_key)
            .json(&json!({
                "query": ISSUE_CREATE_MUTATION,
                "variables": {
                    "input": {
                        "teamId": team_id,
                        "title": normalize_line(&request.title),
                        "description": build_linear_description(
                            &request.description,
                            &request.acceptance_criteria,
                            request.idempotency_key.as_deref()
                        )
                    }
                }
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
    }

    Err(LinearProviderError::MissingIssue)
}
