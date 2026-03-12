use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Preparing,
    Active,
    Paused,
    Finishing,
    Completed,
    PermissionBlocked,
    CaptureError,
    ProviderDegraded,
    FinalizationFailed,
}

#[derive(Debug, Clone)]
pub struct SessionStateMachine {
    current: Option<SessionStatus>,
}

impl Default for SessionStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionStateMachine {
    pub fn new() -> Self {
        Self {
            current: Some(SessionStatus::Idle),
        }
    }

    pub fn current(&self) -> Option<SessionStatus> {
        self.current
    }

    pub fn transition(&mut self, next: SessionStatus) -> Result<SessionStatus, &'static str> {
        let current = self.current.unwrap_or(SessionStatus::Idle);
        let allowed = matches!(
            (current, next),
            (SessionStatus::Idle, SessionStatus::Preparing)
                | (SessionStatus::Preparing, SessionStatus::Active)
                | (SessionStatus::Preparing, SessionStatus::PermissionBlocked)
                | (SessionStatus::Preparing, SessionStatus::CaptureError)
                | (SessionStatus::Preparing, SessionStatus::ProviderDegraded)
                | (SessionStatus::Active, SessionStatus::Paused)
                | (SessionStatus::Active, SessionStatus::Finishing)
                | (SessionStatus::Active, SessionStatus::CaptureError)
                | (SessionStatus::Active, SessionStatus::ProviderDegraded)
                | (SessionStatus::Paused, SessionStatus::Active)
                | (SessionStatus::Paused, SessionStatus::Finishing)
                | (SessionStatus::ProviderDegraded, SessionStatus::Active)
                | (SessionStatus::ProviderDegraded, SessionStatus::Finishing)
                | (SessionStatus::CaptureError, SessionStatus::Finishing)
                | (SessionStatus::Finishing, SessionStatus::Completed)
                | (SessionStatus::Finishing, SessionStatus::FinalizationFailed)
                | (SessionStatus::FinalizationFailed, SessionStatus::Finishing)
        );

        if !allowed {
            return Err("invalid state transition");
        }

        self.current = Some(next);
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::{SessionStateMachine, SessionStatus};

    #[test]
    fn starts_in_idle() {
        let machine = SessionStateMachine::new();
        assert_eq!(machine.current(), Some(SessionStatus::Idle));
    }

    #[test]
    fn accepts_valid_happy_path() {
        let mut machine = SessionStateMachine::new();
        assert!(machine.transition(SessionStatus::Preparing).is_ok());
        assert!(machine.transition(SessionStatus::Active).is_ok());
        assert!(machine.transition(SessionStatus::Finishing).is_ok());
        assert!(machine.transition(SessionStatus::Completed).is_ok());
    }

    #[test]
    fn rejects_invalid_skip() {
        let mut machine = SessionStateMachine::new();
        let error = machine.transition(SessionStatus::Completed).unwrap_err();
        assert_eq!(error, "invalid state transition");
    }
}
